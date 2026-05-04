import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getProjectById: vi.fn(),
  upsertProject: vi.fn(),
  getPriceBookEntries: vi.fn(),
  extractDetectedWorkItems: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

vi.mock("@/lib/local-store", () => ({
  getProjectById: mocks.getProjectById,
  upsertProject: mocks.upsertProject,
}));

vi.mock("@/lib/price-book", () => ({
  getPriceBookEntries: mocks.getPriceBookEntries,
}));

vi.mock("@/lib/work-item-extraction", () => ({
  extractDetectedWorkItems: mocks.extractDetectedWorkItems,
}));

import { createIntakeProject } from "../../../lib/intake-session";
import { POST } from "./route";
import type { DetectedWorkItem, ProjectIntakeInput } from "../../../lib/types";

function buildInput(): ProjectIntakeInput {
  return {
    id: "intake-route-test",
    title: "Route test intake",
    customer: {
      name: "Route Test Customer",
      address: "100 Field Lane",
    },
    propertyType: "single_family",
    projectType: "residential",
    projectSubtype: "receptacle_add",
    scopeDescription: "Capture section data before estimating.",
    blueprintIncluded: false,
    notes: [],
    attachments: [],
    transcriptSegments: [],
    requestedActions: [],
  };
}

describe("/api/analyze", () => {
  it("saves raw extraction without creating estimate lines, proposals, or notifications", async () => {
    const project = createIntakeProject(buildInput());
    const detectedItem: DetectedWorkItem = {
      id: "detected-1",
      walkthroughId: "walkthrough-1",
      sectionId: "section-1",
      sectionName: "Living Room",
      description: "Add receptacle",
      quantity: 1,
      unit: "Each",
      confidence: 0.8,
      sourceType: "photo",
      sourceAttachmentId: "photo-1",
      sourceAttachmentIds: ["photo-1"],
      sourcePath: "intake-route-test/photo-1.jpg",
      manualReview: false,
      requiresReview: true,
      reviewStatus: "pending",
      pricingStatus: "not_ready",
      detectedAt: "2026-04-28T00:00:00.000Z",
    };

    mocks.requireApiSession.mockResolvedValue({ response: undefined });
    mocks.getProjectById.mockResolvedValue(project);
    mocks.getPriceBookEntries.mockResolvedValue([]);
    mocks.extractDetectedWorkItems.mockResolvedValue({
      items: [detectedItem],
      status: {
        status: "partial",
        message: "Detected work items are ready for human review. Nothing has been priced.",
        updatedAt: "2026-04-28T01:00:00.000Z",
      },
    });
    mocks.upsertProject.mockImplementation(async (savedProject) => savedProject);

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: JSON.stringify({ projectId: project.id }),
      }),
    );
    const savedProject = mocks.upsertProject.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(savedProject.detectedWorkItems).toEqual([detectedItem]);
    expect(savedProject.estimateDraft).toBe(project.estimateDraft);
    expect(savedProject.estimateDraft.lineItems).toHaveLength(0);
    expect(savedProject.proposalVariants).toBe(project.proposalVariants);
    expect(savedProject.proposalVariants).toHaveLength(0);
    expect(savedProject.ownerApprovalStatus).toBe(project.ownerApprovalStatus);
    expect(savedProject.customerSendStatus).toBe(project.customerSendStatus);
  });
});
