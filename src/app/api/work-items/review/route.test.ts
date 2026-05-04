import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getProjectById: vi.fn(),
  upsertProject: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

vi.mock("@/lib/local-store", () => ({
  getProjectById: mocks.getProjectById,
  upsertProject: mocks.upsertProject,
}));

import { createIntakeProject } from "../../../../lib/intake-session";
import { POST } from "./route";
import type { DetectedWorkItem, ProjectRecord } from "../../../../lib/types";

function buildProject(): ProjectRecord {
  const detectedItem: DetectedWorkItem = {
    id: "detected-1",
    walkthroughId: "walkthrough-1",
    sectionId: "section-1",
    sectionName: "Kitchen",
    description: "Add receptacle",
    quantity: 1,
    unit: "Each",
    confidence: 0.8,
    sourceType: "photo",
    sourceAttachmentId: "photo-1",
    sourceAttachmentIds: ["photo-1"],
    sourcePath: "route-test/photo-1.jpg",
    manualReview: false,
    requiresReview: true,
    reviewStatus: "pending",
    pricingStatus: "not_ready",
    detectedAt: "2026-04-28T00:00:00.000Z",
  };

  return {
    ...createIntakeProject({
      id: "route-test",
      title: "Route test",
      customer: {
        name: "Route Customer",
        address: "100 Field Lane",
      },
      propertyType: "single_family",
      projectType: "residential",
      projectSubtype: "receptacle_add",
      scopeDescription: "Review detected work.",
      blueprintIncluded: false,
      notes: [],
      attachments: [],
      transcriptSegments: [],
      requestedActions: [],
    }),
    detectedWorkItems: [detectedItem],
  };
}

describe("/api/work-items/review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists approved detected work item review status", async () => {
    const project = buildProject();
    mocks.requireApiSession.mockResolvedValue({ response: undefined });
    mocks.getProjectById.mockResolvedValue(project);
    mocks.upsertProject.mockImplementation(async (savedProject) => savedProject);

    const response = await POST(
      new Request("http://localhost/api/work-items/review", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          workItemId: "detected-1",
          decision: "approve",
        }),
      }),
    );
    const payload = await response.json();
    const savedProject = mocks.upsertProject.mock.calls[0][0] as ProjectRecord;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(savedProject.detectedWorkItems?.[0]?.reviewStatus).toBe("approved");
    expect(savedProject.detectedWorkItems?.[0]?.pricingStatus).toBe(
      "ready_after_review",
    );
    expect(savedProject.estimateDraft.lineItems).toHaveLength(0);
    expect(savedProject.proposalVariants).toHaveLength(0);
  });

  it("does not persist approval for measurement-blocked items", async () => {
    const project = {
      ...buildProject(),
      detectedWorkItems: [
        {
          ...buildProject().detectedWorkItems![0]!,
          pricingStatus: "blocked_missing_measurement" as const,
        },
      ],
    };
    mocks.requireApiSession.mockResolvedValue({ response: undefined });
    mocks.getProjectById.mockResolvedValue(project);

    const response = await POST(
      new Request("http://localhost/api/work-items/review", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          workItemId: "detected-1",
          decision: "approve",
        }),
      }),
    );

    expect(response.status).toBe(422);
    expect(mocks.upsertProject).not.toHaveBeenCalled();
  });
});
