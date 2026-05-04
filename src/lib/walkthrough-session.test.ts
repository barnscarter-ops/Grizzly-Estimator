import { describe, expect, it } from "vitest";
import {
  attachIntakeMedia,
  createIntakeProject,
  removeIntakeMedia,
} from "./intake-session";
import {
  attachAttachmentToWalkthroughSection,
  createWalkthrough,
  saveRouteMeasurement,
  upsertWalkthroughSection,
} from "./walkthrough-session";
import type { Attachment, ProjectIntakeInput } from "./types";

function buildInput(overrides: Partial<ProjectIntakeInput> = {}): ProjectIntakeInput {
  return {
    id: "walkthrough-project",
    title: "Walkthrough foundation",
    customer: {
      name: "Test Customer",
      address: "100 Field Lane",
    },
    propertyType: "single_family",
    projectType: "residential",
    projectSubtype: "receptacle_add",
    scopeDescription: "Capture rooms before estimating.",
    blueprintIncluded: false,
    notes: [],
    attachments: [],
    transcriptSegments: [],
    requestedActions: [],
    ...overrides,
  };
}

function buildProject() {
  return createIntakeProject(buildInput(), "estimator@example.com");
}

function buildSectionPhoto(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "section-photo-1",
    kind: "section_photo",
    name: "kitchen-wall.jpg",
    sizeLabel: "1 MB",
    uploadStatus: "complete",
    progress: 100,
    storageKey: "walkthrough-project/kitchen-wall.jpg",
    contentType: "image/jpeg",
    sizeBytes: 1_000_000,
    uploadedAt: "2026-04-28T00:00:00.000Z",
    projectId: "walkthrough-project",
    walkthroughId: "walkthrough-1",
    sectionId: "section-kitchen",
    ...overrides,
  };
}

describe("walkthrough sessions", () => {
  it("creates a walkthrough without estimate, proposal, or notification side effects", () => {
    const project = createWalkthrough(buildProject(), {
      id: "walkthrough-1",
      sessionId: "field-session-1",
      noteModeDefault: "mixed",
    });

    expect(project.walkthroughs).toHaveLength(1);
    expect(project.walkthroughs?.[0]).toMatchObject({
      id: "walkthrough-1",
      projectId: "walkthrough-project",
      sessionId: "field-session-1",
      status: "draft",
      noteModeDefault: "mixed",
    });
    expect(project.estimateDraft.lineItems).toHaveLength(0);
    expect(project.proposalVariants).toHaveLength(0);
    expect(project.ownerApprovalStatus.status).toBe("ready");
    expect(project.customerSendStatus.status).toBe("ready");
  });

  it("creates a text-note section", () => {
    const project = upsertWalkthroughSection(
      createWalkthrough(buildProject(), { id: "walkthrough-1" }),
      {
        id: "section-kitchen",
        walkthroughId: "walkthrough-1",
        areaName: "Kitchen",
        sortOrder: 0,
        noteMode: "text",
        typedNote: "Add outlets along the island.",
        sectionMeasurements: {
          roomLengthFt: 16,
          roomWidthFt: 12,
          notes: "Island is centered.",
        },
      },
    );

    expect(project.walkthroughSections).toHaveLength(1);
    expect(project.walkthroughSections?.[0]).toMatchObject({
      id: "section-kitchen",
      walkthroughId: "walkthrough-1",
      areaName: "Kitchen",
      noteMode: "text",
      typedNote: "Add outlets along the island.",
      extractionStatus: "not_started",
      sectionMeasurements: {
        roomLengthFt: 16,
        roomWidthFt: 12,
      },
    });
  });

  it("creates voice-note section metadata", () => {
    const project = upsertWalkthroughSection(
      createWalkthrough(buildProject(), {
        id: "walkthrough-1",
        noteModeDefault: "voice",
      }),
      {
        id: "section-garage",
        walkthroughId: "walkthrough-1",
        areaName: "Garage",
        noteMode: "voice",
        audioNoteAttachmentId: "audio-1",
        transcript: "Panel is on the left wall.",
      },
    );

    expect(project.walkthroughSections?.[0]).toMatchObject({
      id: "section-garage",
      noteMode: "voice",
      audioNoteAttachmentId: "audio-1",
      transcript: "Panel is on the left wall.",
    });
  });

  it("attaches multiple photos to one section", () => {
    let project = upsertWalkthroughSection(
      createWalkthrough(buildProject(), { id: "walkthrough-1" }),
      {
        id: "section-kitchen",
        walkthroughId: "walkthrough-1",
        areaName: "Kitchen",
      },
    );
    const firstPhoto = buildSectionPhoto();
    const secondPhoto = buildSectionPhoto({
      id: "section-photo-2",
      name: "kitchen-ceiling.jpg",
      storageKey: "walkthrough-project/kitchen-ceiling.jpg",
    });

    project = attachIntakeMedia(project, firstPhoto);
    project = attachAttachmentToWalkthroughSection(project, {
      walkthroughId: "walkthrough-1",
      sectionId: "section-kitchen",
      attachment: firstPhoto,
    });
    project = attachIntakeMedia(project, secondPhoto);
    project = attachAttachmentToWalkthroughSection(project, {
      walkthroughId: "walkthrough-1",
      sectionId: "section-kitchen",
      attachment: secondPhoto,
    });

    expect(project.attachments).toHaveLength(2);
    expect(project.walkthroughSections?.[0]?.photoAttachmentIds).toEqual([
      "section-photo-1",
      "section-photo-2",
    ]);
  });

  it("saves multiple sections under one walkthrough", () => {
    let project = createWalkthrough(buildProject(), { id: "walkthrough-1" });

    project = upsertWalkthroughSection(project, {
      id: "section-kitchen",
      walkthroughId: "walkthrough-1",
      areaName: "Kitchen",
      sortOrder: 1,
    });
    project = upsertWalkthroughSection(project, {
      id: "section-garage",
      walkthroughId: "walkthrough-1",
      areaName: "Garage",
      sortOrder: 0,
    });

    expect(project.walkthroughSections?.map((section) => section.id)).toEqual([
      "section-garage",
      "section-kitchen",
    ]);
  });

  it("saves route measurement records separate from sections", () => {
    let project = createWalkthrough(buildProject(), { id: "walkthrough-1" });
    project = upsertWalkthroughSection(project, {
      id: "section-garage",
      walkthroughId: "walkthrough-1",
      areaName: "Garage",
    });
    project = saveRouteMeasurement(project, {
      id: "route-1",
      walkthroughId: "walkthrough-1",
      sourceLocation: "Main panel",
      destinationSectionId: "section-garage",
      routeType: "attic",
      routeClass: "home_run",
      measuredDistanceFt: 42,
      circuitAmpRating: 20,
      requiresMeasuredDistance: false,
      requiresReview: true,
      notes: "Route across attic, then down garage wall.",
    });

    expect(project.walkthroughSections).toHaveLength(1);
    expect(project.routeMeasurements).toHaveLength(1);
    expect(project.routeMeasurements?.[0]).toMatchObject({
      id: "route-1",
      destinationSectionId: "section-garage",
      measuredDistanceFt: 42,
      requiresMeasuredDistance: false,
      requiresReview: true,
    });
  });

  it("replacing and deleting a section photo does not delete the section", () => {
    let project = upsertWalkthroughSection(
      createWalkthrough(buildProject(), { id: "walkthrough-1" }),
      {
        id: "section-kitchen",
        walkthroughId: "walkthrough-1",
        areaName: "Kitchen",
      },
    );
    const firstPhoto = buildSectionPhoto();
    const replacementPhoto = buildSectionPhoto({
      id: "section-photo-2",
      name: "kitchen-wall-replacement.jpg",
    });

    project = attachIntakeMedia(project, firstPhoto);
    project = attachAttachmentToWalkthroughSection(project, {
      walkthroughId: "walkthrough-1",
      sectionId: "section-kitchen",
      attachment: firstPhoto,
    });
    project = attachIntakeMedia(project, replacementPhoto, "section-photo-1");
    project = attachAttachmentToWalkthroughSection(project, {
      walkthroughId: "walkthrough-1",
      sectionId: "section-kitchen",
      attachment: replacementPhoto,
      replaceAttachmentId: "section-photo-1",
    });

    expect(project.walkthroughSections).toHaveLength(1);
    expect(project.walkthroughSections?.[0]?.photoAttachmentIds).toEqual([
      "section-photo-2",
    ]);

    const removed = removeIntakeMedia(project, "section-photo-2").project;

    expect(removed.walkthroughSections).toHaveLength(1);
    expect(removed.walkthroughSections?.[0]?.photoAttachmentIds).toEqual([]);
  });
});
