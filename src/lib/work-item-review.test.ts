import { describe, expect, it } from "vitest";
import { createIntakeProject } from "./intake-session";
import {
  createEstimateDraftFromReviewedWorkItems,
  reviewDetectedWorkItem,
} from "./work-item-review";
import type { DetectedWorkItem, PriceBookEntry, ProjectRecord } from "./types";

const priceBook: PriceBookEntry[] = [
  {
    id: "add-new-receptacle",
    category: "Install",
    name: "Add New Receptacle",
    description: "Add receptacle from nearby existing circuit.",
    price: 209,
    cost: 40,
    sourceLabel: "Test",
  },
];

function buildDetectedItem(
  overrides: Partial<DetectedWorkItem> = {},
): DetectedWorkItem {
  return {
    id: "detected-1",
    walkthroughId: "walkthrough-1",
    sectionId: "section-kitchen",
    sectionName: "Kitchen",
    description: "Add New Receptacle on island",
    quantity: 2,
    unit: "Each",
    confidence: 0.86,
    sourceType: "photo",
    sourceAttachmentId: "photo-1",
    sourceAttachmentIds: ["photo-1"],
    sourcePath: "intake-test/kitchen.jpg",
    manualReview: false,
    requiresReview: true,
    reviewStatus: "pending",
    pricingStatus: "not_ready",
    suggestedPriceBookMatch: {
      id: "add-new-receptacle",
      name: "Add New Receptacle",
      category: "Install",
      sourceLabel: "Test",
    },
    detectedAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

function buildProject(
  detectedWorkItems: DetectedWorkItem[] = [buildDetectedItem()],
): ProjectRecord {
  return {
    ...createIntakeProject({
      id: "intake-test",
      title: "Field intake",
      customer: {
        name: "Test Customer",
        email: "test@example.com",
        address: "100 Field Lane",
      },
      propertyType: "single_family",
      projectType: "residential",
      projectSubtype: "receptacle_add",
      scopeDescription: "Walkthrough capture only.",
      blueprintIncluded: false,
      notes: [],
      attachments: [],
      transcriptSegments: [],
      requestedActions: [],
    }),
    detectedWorkItems,
  };
}

describe("work item review gate", () => {
  it("approves a detected work item and marks it ready for later pricing", () => {
    const result = reviewDetectedWorkItem(buildProject(), {
      workItemId: "detected-1",
      decision: "approve",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.item.reviewStatus).toBe("approved");
    expect(result.item.pricingStatus).toBe("ready_after_review");
    expect(result.project.estimateDraft.lineItems).toHaveLength(0);
    expect(result.project.proposalVariants).toHaveLength(0);
  });

  it("rejects detected work without letting it become an estimate line", () => {
    const review = reviewDetectedWorkItem(buildProject(), {
      workItemId: "detected-1",
      decision: "reject",
    });

    expect(review.ok).toBe(true);
    if (!review.ok) {
      throw new Error(review.message);
    }

    const draft = createEstimateDraftFromReviewedWorkItems(review.project, priceBook);

    expect(draft.ok).toBe(false);
    expect(draft.message).toContain("No approved");
    expect(draft.project.estimateDraft.lineItems).toHaveLength(0);
    expect(draft.project.proposalVariants).toHaveLength(0);
  });

  it("blocks estimate draft creation while any AI output is still pending", () => {
    const project = buildProject([
      buildDetectedItem({ id: "approved-1", reviewStatus: "approved" }),
      buildDetectedItem({ id: "pending-1", reviewStatus: "pending" }),
    ]);
    const result = createEstimateDraftFromReviewedWorkItems(project, priceBook);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Approve or reject all detected work items");
    expect(result.project.estimateDraft.lineItems).toHaveLength(0);
    expect(result.project.proposalVariants).toHaveLength(0);
  });

  it("blocks approval and estimate lines for missing route measurements", () => {
    const blockedProject = buildProject([
      buildDetectedItem({
        pricingStatus: "blocked_missing_measurement",
        missingMeasurementPrompts: [
          "Confirm route allowance or measured distance from panel to Kitchen section.",
        ],
      }),
    ]);
    const review = reviewDetectedWorkItem(blockedProject, {
      workItemId: "detected-1",
      decision: "approve",
    });

    expect(review.ok).toBe(false);
    expect(review.message).toContain("measurements");

    const draft = createEstimateDraftFromReviewedWorkItems(
      buildProject([
        buildDetectedItem({
          reviewStatus: "approved",
          pricingStatus: "blocked_missing_measurement",
        }),
      ]),
      priceBook,
    );

    expect(draft.ok).toBe(false);
    expect(draft.message).toContain("measurements");
    expect(draft.project.estimateDraft.lineItems).toHaveLength(0);
  });

  it("creates estimate draft lines only from approved or edited detected items", () => {
    const project = buildProject([
      buildDetectedItem({ id: "approved-1", reviewStatus: "approved" }),
      buildDetectedItem({ id: "rejected-1", reviewStatus: "rejected" }),
    ]);
    const result = createEstimateDraftFromReviewedWorkItems(project, priceBook);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.project.estimateDraft.lineItems).toHaveLength(1);
    expect(result.project.estimateDraft.lineItems[0]).toMatchObject({
      area: "Kitchen",
      name: "Add New Receptacle",
      quantity: 2,
      source: "price_book",
    });
    expect(result.project.proposalVariants).toHaveLength(0);
  });

  it("preserves feeder and ampacity owner review gates on reviewed estimate lines", () => {
    const project = {
      ...buildProject([
        buildDetectedItem({
          description: "Install 60A feeder to garage subpanel",
          reviewStatus: "approved",
        }),
      ]),
      routeMeasurements: [
        {
          id: "route-1",
          walkthroughId: "walkthrough-1",
          projectId: "intake-test",
          sourceLocation: "Main panel",
          destinationSectionId: "section-kitchen",
          routeClass: "home_run" as const,
          circuitAmpRating: 60,
          requiresMeasuredDistance: false,
          requiresReview: true,
          createdAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:00:00.000Z",
        },
      ],
    };
    const result = createEstimateDraftFromReviewedWorkItems(project, priceBook);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.project.estimateDraft.reviewStatus).toBe("owner_review_required");
    expect(result.project.estimateDraft.lineItems[0]?.status).toBe("review_required");
    expect(result.project.capturePrompts[0]?.severity).toBe("critical");
  });
});
