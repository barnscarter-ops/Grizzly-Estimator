import { describe, expect, it } from "vitest";
import { analyzeProject } from "./estimate-engine";
import type { PriceBookEntry, ProjectIntakeInput } from "./types";

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
  {
    id: "replace-recessed",
    category: "Install",
    name: "Replace Recessed Lighting with Slim Downlights",
    description: "Replace recessed lights with LED wafers.",
    price: 109,
    cost: 18,
    sourceLabel: "Test",
  },
  {
    id: "new-circuit",
    category: "Install",
    name: "Install New 15/20a Circuit (Up to 50')",
    description: "Install new branch circuit with breaker and receptacle.",
    price: 397,
    cost: 182,
    sourceLabel: "Test",
  },
];

function buildBaseInput(overrides: Partial<ProjectIntakeInput> = {}): ProjectIntakeInput {
  return {
    id: "test-project",
    title: "Test project",
    customer: {
      name: "Test Customer",
      address: "123 Test Street",
    },
    propertyType: "single_family",
    projectType: "residential",
    projectSubtype: "receptacle_add",
    scopeDescription: "Add two receptacles by the patio.",
    blueprintIncluded: false,
    notes: [],
    attachments: [],
    transcriptSegments: [
      {
        id: "segment-1",
        speaker: "Estimator",
        timestamp: "00:01",
        text: "Add two receptacles by the patio.",
      },
    ],
    requestedActions: [
      {
        id: "action-1",
        area: "Patio",
        label: "Add new receptacle",
        quantity: 2,
        keywords: ["Add New Receptacle"],
      },
    ],
    ...overrides,
  };
}

describe("analyzeProject", () => {
  it("uses the price book when a strong match is found", () => {
    const result = analyzeProject(buildBaseInput(), priceBook);

    expect(result.estimateDraft.lineItems[0]?.source).toBe("price_book");
    expect(result.estimateDraft.lineItems[0]?.name).toContain("Add New Receptacle");
  });

  it("creates commercial measurement prompts when dimensions are uncertain", () => {
    const result = analyzeProject(
      buildBaseInput({
        projectType: "commercial",
        projectSubtype: "lighting_install",
        propertyType: "office",
        requestedActions: [
          {
            id: "lighting",
            area: "Open Office",
            label: "Replace recessed lighting",
            quantity: 6,
            needsMeasurement: true,
            keywords: ["Replace Recessed Lighting"],
          },
        ],
      }),
      priceBook,
    );

    expect(
      result.capturePrompts.some((prompt) =>
        prompt.question.includes("Confirm field dimensions"),
      ),
    ).toBe(true);
  });

  it("forces owner review when ampacity exceeds 40A", () => {
    const result = analyzeProject(
      buildBaseInput({
        projectType: "commercial",
        projectSubtype: "circuit_add",
        propertyType: "restaurant",
        requestedActions: [
          {
            id: "high-amp",
            area: "Prep Line",
            label: "Install oven circuit",
            quantity: 1,
            amps: 60,
            feet: 80,
            needsMeasurement: true,
            keywords: ["Install New 15/20a Circuit"],
          },
        ],
      }),
      priceBook,
    );

    expect(result.estimateDraft.reviewStatus).toBe("owner_review_required");
    expect(
      result.capturePrompts.some((prompt) => prompt.severity === "critical"),
    ).toBe(true);
  });

  it("falls back to AI pricing when no price book item matches", () => {
    const result = analyzeProject(
      buildBaseInput({
        requestedActions: [
          {
            id: "unknown",
            area: "Garage",
            label: "Add specialty disconnect",
            quantity: 1,
            keywords: ["Unmatched work item"],
          },
        ],
      }),
      priceBook,
    );

    expect(result.estimateDraft.lineItems[0]?.source).toBe("ai_fallback");
  });
});
