import { buildTemplateActions } from "@/lib/project-templates";
import type {
  CapturePrompt,
  EstimateAreaGroup,
  EstimateDraft,
  EstimateLineItem,
  IntegrationSync,
  PriceBookEntry,
  ProjectIntakeInput,
  ProjectRecord,
  ProposalVariant,
  RequestedAction,
  ReviewStatus,
} from "@/lib/types";
import { slugify, sumBy } from "@/lib/utils";

const BASE_LABOR_RATE = 118;

type AnalyzedProjectRecord = Omit<
  ProjectRecord,
  "notificationStatus" | "ownerApprovalStatus" | "customerSendStatus" | "lastNotificationAttemptAt"
>;

const FALLBACK_PRICING: Record<ProjectIntakeInput["projectSubtype"], number> = {
  full_remodel: 325,
  circuit_add: 540,
  receptacle_add: 190,
  lighting_install: 145,
  fan_replace: 230,
};

function findBestMatch(priceBook: PriceBookEntry[], keywords: string[]) {
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  let bestMatch: PriceBookEntry | undefined;
  let bestScore = 0;

  for (const entry of priceBook) {
    const haystack = `${entry.name} ${entry.description} ${entry.category}`.toLowerCase();
    let score = 0;

    for (const keyword of normalizedKeywords) {
      if (haystack.includes(keyword)) {
        score += keyword.length > 12 ? 4 : 2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestScore > 0 ? bestMatch : undefined;
}

function computeLaborHours(
  project: ProjectIntakeInput,
  action: RequestedAction,
  matchedPriceBook: PriceBookEntry | undefined,
) {
  const baseHours =
    {
      full_remodel: 2.4,
      circuit_add: 3.3,
      receptacle_add: 1.2,
      lighting_install: 1.15,
      fan_replace: 1.75,
    }[project.projectSubtype] * action.quantity;

  let hours = baseHours;

  if (action.feet) {
    hours += Math.max(0.5, action.feet / 40);
  }

  if (project.projectType === "commercial") {
    hours *= 1.25;
  }

  if (action.ownerProvided) {
    hours *= 0.88;
  }

  if (action.amps && action.amps > 40) {
    hours *= 1.5;
  }

  if (matchedPriceBook?.category === "Service Entrance and Panel") {
    hours += 2.5;
  }

  return Number(hours.toFixed(1));
}

function computeConfidence(
  project: ProjectIntakeInput,
  action: RequestedAction,
  matchedPriceBook: PriceBookEntry | undefined,
) {
  let confidence = matchedPriceBook ? 0.82 : 0.6;

  if (project.blueprintIncluded) {
    confidence += 0.08;
  }

  if (project.projectType === "residential") {
    confidence += 0.04;
  }

  if (action.needsMeasurement) {
    confidence -= project.projectType === "commercial" ? 0.14 : 0.06;
  }

  if (action.amps && action.amps > 40) {
    confidence -= 0.09;
  }

  if (
    project.transcriptSegments.some((segment) =>
      (action.keywords ?? []).some((keyword) =>
        segment.text.toLowerCase().includes(keyword.toLowerCase().split(" ")[0] ?? ""),
      ),
    )
  ) {
    confidence += 0.03;
  }

  return Math.max(0.46, Math.min(0.96, Number(confidence.toFixed(2))));
}

function buildLineItem(
  project: ProjectIntakeInput,
  action: RequestedAction,
  priceBook: PriceBookEntry[],
): EstimateLineItem {
  const match = findBestMatch(priceBook, action.keywords ?? [action.label]);
  const confidence = computeConfidence(project, action, match);
  const laborHours = computeLaborHours(project, action, match);
  const fallbackPrice =
    FALLBACK_PRICING[project.projectSubtype] * Math.max(action.quantity, 1);
  const sellPrice = Number(
    ((match?.price ?? fallbackPrice) * Math.max(action.quantity, 1)).toFixed(2),
  );
  const materialCost = Number(
    ((match?.cost ?? sellPrice * 0.42) * Math.max(action.quantity, 1)).toFixed(2),
  );

  let status: EstimateLineItem["status"] = "verified";

  if (action.amps && action.amps > 40) {
    status = "review_required";
  } else if (confidence < 0.72) {
    status = "review_required";
  } else if (project.projectType === "residential" || !action.needsMeasurement) {
    status = "best_guess";
  }

  return {
    id: `${slugify(project.id)}-${slugify(action.area)}-${slugify(action.label)}`,
    area: action.area,
    name: match?.name ?? `${action.label} (AI fallback)`,
    description:
      match?.description ||
      `AI generated fallback for ${action.label.toLowerCase()} based on project type, quantity, and captured walkthrough notes.`,
    quantity: action.quantity,
    unit: "Each",
    materialCost,
    sellPrice,
    laborHours,
    confidence,
    status,
    source: match ? "price_book" : "ai_fallback",
  };
}

function buildCapturePrompts(
  project: ProjectIntakeInput,
  lineItems: EstimateLineItem[],
  actions: RequestedAction[],
) {
  const prompts: CapturePrompt[] = [];

  actions.forEach((action) => {
    if (project.projectType === "commercial" && action.needsMeasurement) {
      prompts.push({
        id: `${action.id}-measurement`,
        area: action.area,
        question: `Confirm field dimensions in ${action.area}`,
        context:
          "Commercial walkthroughs prompt for fixture spacing, run length, or mounting heights when measurements are unclear. The estimator can dismiss and keep the best-guess draft.",
        severity: "warning",
        dismissible: true,
      });
    }

    if (action.amps && action.amps > 40) {
      prompts.push({
        id: `${action.id}-ampacity`,
        area: action.area,
        question: `Review ${action.amps}A circuit scope before proposal send`,
        context:
          "Any circuit above 40A requires explicit owner review so feeder size, breaker, and material assumptions are confirmed before pricing is finalized.",
        severity: "critical",
        dismissible: false,
      });
    }
  });

  lineItems
    .filter((lineItem) => lineItem.status === "review_required")
    .forEach((lineItem) => {
      prompts.push({
        id: `${lineItem.id}-confidence`,
        area: lineItem.area,
        question: `Manual confirmation needed for ${lineItem.name}`,
        context:
          "Confidence dropped below the safe send threshold, so the owner review workspace should confirm quantity, match, or labor before sending.",
        severity: "warning",
        dismissible: true,
      });
    });

  return prompts;
}

function buildAreaGroups(lineItems: EstimateLineItem[]): EstimateAreaGroup[] {
  return Array.from(new Set(lineItems.map((lineItem) => lineItem.area))).map((area) => {
    const areaLineItems = lineItems.filter((lineItem) => lineItem.area === area);

    return {
      area,
      lineItems: areaLineItems,
      subtotal: Number(sumBy(areaLineItems, (lineItem) => lineItem.sellPrice).toFixed(2)),
      totalLaborHours: Number(
        sumBy(areaLineItems, (lineItem) => lineItem.laborHours).toFixed(1),
      ),
    };
  });
}

function buildEstimateDraft(
  lineItems: EstimateLineItem[],
  prompts: CapturePrompt[],
): EstimateDraft {
  const areaGroups = buildAreaGroups(lineItems);
  const materialTotal = Number(sumBy(lineItems, (lineItem) => lineItem.materialCost).toFixed(2));
  const totalLaborHours = Number(sumBy(lineItems, (lineItem) => lineItem.laborHours).toFixed(1));
  const averageConfidence = Number(
    (
      sumBy(lineItems, (lineItem) => lineItem.confidence) / Math.max(lineItems.length, 1)
    ).toFixed(2),
  );
  const grandTotal = Number(sumBy(lineItems, (lineItem) => lineItem.sellPrice).toFixed(2));
  const reviewStatus: ReviewStatus = prompts.some((prompt) => prompt.severity === "critical")
    ? "owner_review_required"
    : lineItems.some((lineItem) => lineItem.status === "review_required")
      ? "owner_review_required"
      : "ready_for_owner_review";

  return {
    areaGroups,
    lineItems,
    materialTotal,
    totalLaborHours,
    laborRate: BASE_LABOR_RATE,
    grandTotal,
    averageConfidence,
    reviewStatus,
  };
}

function buildProposalVariants(
  project: ProjectIntakeInput,
  estimateDraft: EstimateDraft,
): ProposalVariant[] {
  const depositRequired =
    project.projectSubtype === "full_remodel" || estimateDraft.grandTotal >= 3500;
  const depositAmount = depositRequired
    ? Math.round(estimateDraft.grandTotal * 0.25)
    : 0;

  return [
    {
      style: "hcp",
      title: `${project.customer.name} electrical proposal`,
      intro:
        "This operations-first proposal keeps the language tight and easy to approve from any phone, tablet, or desktop browser.",
      bulletHighlights: [
        `Scope organized by ${estimateDraft.areaGroups.length} work areas for clean review.`,
        `${estimateDraft.lineItems.length} mapped line items with price-book-first matching.`,
        depositRequired
          ? "Deposit is called out clearly so the team can request it after customer approval."
          : "No deposit is required before approval on this proposal.",
      ],
      depositRequired,
      depositAmount,
      sharePath: `/proposal/${project.id}?style=hcp`,
    },
    {
      style: "premium",
      title: `${project.customer.name} scope of work and investment`,
      intro:
        "This premium version uses more customer-facing language and frames the work around cleanliness, coordination, and the finished outcome.",
      bulletHighlights: [
        `Walkthrough findings combined with ${project.blueprintIncluded ? "blueprint review" : "field-only review"} to draft the estimate.`,
        `Labor modeled at ${BASE_LABOR_RATE}/hr with AI-assisted takeoff and owner review gates.`,
        "After approval, the office can schedule the work and prepare the manual Housecall Pro handoff packet.",
      ],
      depositRequired,
      depositAmount,
      sharePath: `/proposal/${project.id}?style=premium`,
    },
  ];
}

function buildAnalysisSummary(
  project: ProjectIntakeInput,
  estimateDraft: EstimateDraft,
  prompts: CapturePrompt[],
) {
  return [
    `Drafted ${estimateDraft.lineItems.length} estimate line items across ${estimateDraft.areaGroups.length} areas from walkthrough scope and optional notes.`,
    `${estimateDraft.lineItems.filter((lineItem) => lineItem.source === "price_book").length} items matched your price book first; unmatched items stayed marked as AI fallback.`,
    project.blueprintIncluded
      ? "Blueprint context boosted confidence and reduced manual clarification where available."
      : "No blueprint was required for this draft, so confidence depends more heavily on walkthrough detail and review.",
    prompts.length > 0
      ? `${prompts.length} clarification prompts are ready for capture or owner review before final send.`
      : "This draft is clean enough for owner review without additional capture prompts.",
  ];
}

function buildOpsNextSteps(project: ProjectIntakeInput, estimateDraft: EstimateDraft) {
  const steps = [
    "Owner reviews quantities, match quality, and any flagged confidence issues.",
    "Once approved internally, email the selected proposal variant to the customer for signature.",
  ];

  if (project.projectSubtype === "full_remodel" || estimateDraft.grandTotal > 3000) {
    steps.push("If approved, request the deposit before releasing materials or committing schedule dates.");
  }

  steps.push("Queue supply-house email and Home Depot cart build after approval.");
  steps.push("Prepare the final HCP upload packet after customer approval so the office can load it manually.");

  return steps;
}

export function analyzeProject(
  input: ProjectIntakeInput,
  priceBook: PriceBookEntry[],
): AnalyzedProjectRecord {
  const requestedActions =
    input.requestedActions.length > 0
      ? input.requestedActions
      : buildTemplateActions(input.projectSubtype);

  const lineItems = requestedActions.map((action) =>
    buildLineItem({ ...input, requestedActions }, action, priceBook),
  );
  const prompts = buildCapturePrompts(input, lineItems, requestedActions);
  const estimateDraft = buildEstimateDraft(lineItems, prompts);
  const proposalVariants = buildProposalVariants(input, estimateDraft);
  const integrationSyncs: IntegrationSync[] = [
    {
      system: "housecall-pro",
      status: "queued",
      message:
        "Manual Housecall Pro handoff happens after customer approval. Direct API sync is not part of this approval workflow.",
      updatedAt: new Date().toISOString(),
    },
    {
      system: "supplier-email",
      status: "queued",
      message:
        "Supplier email stays queued until approval and deposit conditions are satisfied.",
      updatedAt: new Date().toISOString(),
    },
    {
      system: "home-depot-cart",
      status: "queued",
      message:
        "Retail cart generation is queued until approval so the team only buys against a won job.",
      updatedAt: new Date().toISOString(),
    },
  ];

  return {
    ...input,
    requestedActions,
    createdAt: new Date().toISOString(),
    createdByEmail: undefined,
    estimateDraft,
    proposalVariants,
    proposalWorkflow: {
      status: "owner_review_pending",
      activeStyle: proposalVariants[0]?.style ?? "hcp",
      ownerReviewRequestedAt: new Date().toISOString(),
    },
    integrationSyncs,
    capturePrompts: prompts,
    analysisSummary: buildAnalysisSummary(input, estimateDraft, prompts),
    opsNextSteps: buildOpsNextSteps(input, estimateDraft),
  };
}
