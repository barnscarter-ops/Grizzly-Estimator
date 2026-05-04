import type {
  CapturePrompt,
  DetectedWorkItem,
  DetectedWorkItemReviewStatus,
  EstimateAreaGroup,
  EstimateDraft,
  EstimateLineItem,
  PriceBookEntry,
  ProjectRecord,
  SuggestedPriceBookMatch,
} from "@/lib/types";
import { slugify, sumBy } from "@/lib/utils";

const FALLBACK_APPROVED_ITEM_PRICE = 250;
const FALLBACK_APPROVED_ITEM_COST_RATIO = 0.42;
const BASE_LABOR_RATE = 118;

export type WorkItemReviewDecision = "approve" | "reject" | "edit";

export type WorkItemReviewInput = {
  workItemId: string;
  decision: WorkItemReviewDecision;
  description?: string;
  quantity?: number;
  unit?: string;
  suggestedPriceBookMatch?: SuggestedPriceBookMatch;
  reviewerNote?: string;
};

type ReviewResult =
  | { ok: true; project: ProjectRecord; item: DetectedWorkItem; message: string }
  | { ok: false; project: ProjectRecord; message: string };

type EstimateDraftResult =
  | { ok: true; project: ProjectRecord; message: string }
  | { ok: false; project: ProjectRecord; message: string };

function nowIso() {
  return new Date().toISOString();
}

function normalizeQuantity(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return fallback;
  }

  return Number(value.toFixed(2));
}

function reviewStatusForDecision(
  decision: WorkItemReviewDecision,
): DetectedWorkItemReviewStatus {
  return decision === "reject" ? "rejected" : decision === "edit" ? "edited" : "approved";
}

function hasAmpacityOrFeederGate(item: DetectedWorkItem, project: ProjectRecord) {
  const text = [item.description, item.sourceNoteText].filter(Boolean).join(" ");
  const mentionsFeeder = /\b(feeder|subpanel|sub-panel|service\s+entrance|panel\s+upgrade)\b/i.test(
    text,
  );
  const mentionsHighAmpCircuit = /\b([5-9]\d|[1-9]\d{2,})\s*(a|amp|amps)\b/i.test(text);
  const routeNeedsReview = (project.routeMeasurements ?? []).some(
    (measurement) =>
      measurement.walkthroughId === item.walkthroughId &&
      (!item.sectionId || measurement.destinationSectionId === item.sectionId) &&
      (measurement.requiresReview || (measurement.circuitAmpRating ?? 0) > 40),
  );

  return mentionsFeeder || mentionsHighAmpCircuit || routeNeedsReview;
}

function findPriceBookEntry(
  priceBook: PriceBookEntry[],
  match: SuggestedPriceBookMatch | undefined,
) {
  return match ? priceBook.find((entry) => entry.id === match.id) : undefined;
}

function buildLineItem(
  project: ProjectRecord,
  item: DetectedWorkItem,
  priceBook: PriceBookEntry[],
): EstimateLineItem {
  const match = findPriceBookEntry(priceBook, item.suggestedPriceBookMatch);
  const quantity = normalizeQuantity(item.quantity, 1);
  const sellPrice = Number(
    ((match?.price ?? FALLBACK_APPROVED_ITEM_PRICE) * quantity).toFixed(2),
  );
  const materialCost = Number(
    ((match?.cost ?? sellPrice * FALLBACK_APPROVED_ITEM_COST_RATIO) * quantity).toFixed(2),
  );
  const needsOwnerReview =
    item.manualReview ||
    item.requiresReview ||
    item.reviewStatus === "edited" ||
    hasAmpacityOrFeederGate(item, project);

  return {
    id: `${slugify(project.id)}-${slugify(item.sectionName ?? item.sourcePath)}-${slugify(item.id)}`,
    area: item.sectionName ?? "Walkthrough review",
    name: match?.name ?? `${item.description.slice(0, 64)} (reviewed fallback)`,
    description:
      match?.description ??
      `Human-reviewed field item from ${item.sourceType.replaceAll("_", " ")}: ${item.description}`,
    quantity,
    unit: item.unit ?? "Each",
    materialCost,
    sellPrice,
    laborHours: Number(Math.max(0.75, quantity * (match ? 1.25 : 1.75)).toFixed(1)),
    confidence: item.confidence,
    status: needsOwnerReview ? "review_required" : "verified",
    source: match ? "price_book" : "ai_fallback",
  };
}

function buildAreaGroups(lineItems: EstimateLineItem[]): EstimateAreaGroup[] {
  return Array.from(new Set(lineItems.map((lineItem) => lineItem.area))).map((area) => {
    const areaLineItems = lineItems.filter((lineItem) => lineItem.area === area);

    return {
      area,
      lineItems: areaLineItems,
      subtotal: Number(sumBy(areaLineItems, (lineItem) => lineItem.sellPrice).toFixed(2)),
      totalLaborHours: Number(sumBy(areaLineItems, (lineItem) => lineItem.laborHours).toFixed(1)),
    };
  });
}

function buildCapturePrompts(project: ProjectRecord, items: DetectedWorkItem[]) {
  const prompts: CapturePrompt[] = [];

  for (const item of items) {
    if (hasAmpacityOrFeederGate(item, project)) {
      prompts.push({
        id: `${item.id}-ampacity-feeder-review`,
        area: item.sectionName ?? "Walkthrough review",
        question: `Review feeder or ampacity assumptions for ${item.sectionName ?? item.description}`,
        context:
          "Feeder, service, subpanel, and circuit work above 40A stays under owner review before proposal send.",
        severity: "critical",
        dismissible: false,
      });
    }
  }

  return prompts;
}

function buildEstimateDraft(
  lineItems: EstimateLineItem[],
  prompts: CapturePrompt[],
): EstimateDraft {
  const areaGroups = buildAreaGroups(lineItems);
  const materialTotal = Number(sumBy(lineItems, (lineItem) => lineItem.materialCost).toFixed(2));
  const totalLaborHours = Number(sumBy(lineItems, (lineItem) => lineItem.laborHours).toFixed(1));
  const grandTotal = Number(sumBy(lineItems, (lineItem) => lineItem.sellPrice).toFixed(2));
  const averageConfidence = Number(
    (sumBy(lineItems, (lineItem) => lineItem.confidence) / Math.max(lineItems.length, 1)).toFixed(2),
  );

  return {
    areaGroups,
    lineItems,
    materialTotal,
    totalLaborHours,
    laborRate: BASE_LABOR_RATE,
    grandTotal,
    averageConfidence,
    reviewStatus:
      prompts.some((prompt) => prompt.severity === "critical") ||
      lineItems.some((lineItem) => lineItem.status === "review_required")
        ? "owner_review_required"
        : "ready_for_owner_review",
  };
}

export function reviewDetectedWorkItem(
  project: ProjectRecord,
  input: WorkItemReviewInput,
): ReviewResult {
  const currentItems = project.detectedWorkItems ?? [];
  const item = currentItems.find((current) => current.id === input.workItemId);

  if (!item) {
    return {
      ok: false,
      project,
      message: "Detected work item not found.",
    };
  }

  if (
    input.decision !== "reject" &&
    item.pricingStatus === "blocked_missing_measurement"
  ) {
    return {
      ok: false,
      project,
      message: "Add required route or home-run measurements before approving this item.",
    };
  }

  const reviewStatus = reviewStatusForDecision(input.decision);
  const updatedAt = nowIso();
  const updatedItem: DetectedWorkItem = {
    ...item,
    description:
      input.decision === "edit" && input.description?.trim()
        ? input.description.trim()
        : item.description,
    quantity:
      input.decision === "edit"
        ? normalizeQuantity(input.quantity, item.quantity)
        : item.quantity,
    unit:
      input.decision === "edit" && input.unit?.trim()
        ? input.unit.trim()
        : item.unit,
    suggestedPriceBookMatch:
      input.decision === "edit" && input.suggestedPriceBookMatch
        ? input.suggestedPriceBookMatch
        : item.suggestedPriceBookMatch,
    reviewStatus,
    pricingStatus:
      reviewStatus === "rejected"
        ? "not_ready"
        : item.pricingStatus === "blocked_missing_measurement"
          ? "blocked_missing_measurement"
          : "ready_after_review",
    requiresReview:
      reviewStatus === "rejected"
        ? item.requiresReview
        : true,
    extractionNotes: [item.extractionNotes, input.reviewerNote]
      .filter(Boolean)
      .join("\n"),
  };
  const updatedProject = {
    ...project,
    updatedAt,
    detectedWorkItems: currentItems.map((current) =>
      current.id === item.id ? updatedItem : current,
    ),
    analysisSummary: [
      `Detected work item ${updatedItem.id} was ${reviewStatus}.`,
      "Estimate draft generation remains separate and only uses approved or edited items.",
    ],
  };

  return {
    ok: true,
    project: updatedProject,
    item: updatedItem,
    message: `Detected work item ${reviewStatus}.`,
  };
}

export function createEstimateDraftFromReviewedWorkItems(
  project: ProjectRecord,
  priceBook: PriceBookEntry[],
): EstimateDraftResult {
  const detectedItems = project.detectedWorkItems ?? [];

  if (detectedItems.length === 0) {
    return {
      ok: false,
      project,
      message: "Run extraction and review detected work items before drafting estimate lines.",
    };
  }

  const pendingItem = detectedItems.find((item) => item.reviewStatus === "pending");
  if (pendingItem) {
    return {
      ok: false,
      project,
      message: "Approve or reject all detected work items before drafting estimate lines.",
    };
  }

  const blockedItem = detectedItems.find(
    (item) =>
      item.reviewStatus !== "rejected" &&
      item.pricingStatus === "blocked_missing_measurement",
  );
  if (blockedItem) {
    return {
      ok: false,
      project,
      message: "Resolve missing route or home-run measurements before drafting estimate lines.",
    };
  }

  const approvedItems = detectedItems.filter(
    (item) => item.reviewStatus === "approved" || item.reviewStatus === "edited",
  );

  if (approvedItems.length === 0) {
    return {
      ok: false,
      project,
      message: "No approved detected work items are ready for estimate drafting.",
    };
  }

  const lineItems = approvedItems.map((item) => buildLineItem(project, item, priceBook));
  const prompts = buildCapturePrompts(project, approvedItems);
  const estimateDraft = buildEstimateDraft(lineItems, prompts);
  const updatedAt = nowIso();

  return {
    ok: true,
    message: `Created ${lineItems.length} reviewed estimate draft line${lineItems.length === 1 ? "" : "s"}.`,
    project: {
      ...project,
      updatedAt,
      estimateDraft,
      proposalVariants: project.proposalVariants,
      capturePrompts: prompts,
      analysisSummary: [
        `Created ${lineItems.length} estimate draft line${lineItems.length === 1 ? "" : "s"} from human-reviewed detected work items.`,
        "Proposal generation remains blocked until the reviewed estimate workflow creates proposal variants.",
      ],
      opsNextSteps: [
        "Review owner gates and price-book matches before generating proposal variants.",
        "Keep customer notifications disabled until a reviewed proposal exists.",
      ],
    },
  };
}
