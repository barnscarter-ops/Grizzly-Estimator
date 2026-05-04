import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createIntakeProject } from "./intake-session";
import {
  buildOpenAiVisionRequest,
  extractDetectedWorkItems,
  getResponseOutputText,
  type VisionExtractor,
} from "./work-item-extraction";
import type {
  Attachment,
  PriceBookEntry,
  ProjectRecord,
  RouteMeasurement,
  Walkthrough,
  WalkthroughSection,
} from "./types";

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

function buildAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "photo-1",
    kind: "photo",
    name: "panel.jpg",
    sizeLabel: "1 MB",
    uploadStatus: "complete",
    progress: 100,
    storageKey: "intake-test/1-photo-panel.jpg",
    contentType: "image/jpeg",
    sizeBytes: 1024,
    uploadedAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

function buildProject(attachments: Attachment[] = []) {
  return createIntakeProject({
    id: "intake-test",
    title: "Field intake",
    customer: {
      name: "Test Customer",
      address: "100 Field Lane",
    },
    propertyType: "single_family",
    projectType: "residential",
    projectSubtype: "receptacle_add",
    scopeDescription: "Add a receptacle near the patio.",
    blueprintIncluded: false,
    notes: ["Verify box location before pricing."],
    attachments,
    transcriptSegments: [],
    requestedActions: [],
  });
}

function buildWalkthrough(): Walkthrough {
  return {
    id: "walkthrough-1",
    projectId: "intake-test",
    status: "ready_for_extraction",
    noteModeDefault: "mixed",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
  };
}

function buildSection(
  overrides: Partial<WalkthroughSection> = {},
): WalkthroughSection {
  return {
    id: "section-living-room",
    walkthroughId: "walkthrough-1",
    projectId: "intake-test",
    name: "Living Room",
    areaName: "Living Room",
    sortOrder: 0,
    noteMode: "text",
    photoAttachmentIds: ["section-photo-1"],
    typedNote: "Add a receptacle on the TV wall.",
    extractionStatus: "not_started",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

function buildRouteMeasurement(
  overrides: Partial<RouteMeasurement> = {},
): RouteMeasurement {
  return {
    id: "route-1",
    walkthroughId: "walkthrough-1",
    projectId: "intake-test",
    sourceLocation: "Main panel",
    destinationSectionId: "section-living-room",
    routeType: "attic",
    routeClass: "home_run",
    measuredDistanceFt: 42,
    requiresMeasuredDistance: false,
    requiresReview: true,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

function withWalkthroughSections(
  project: ProjectRecord,
  sections: WalkthroughSection[],
  routeMeasurements: RouteMeasurement[] = [],
) {
  return {
    ...project,
    walkthroughs: [buildWalkthrough()],
    walkthroughSections: sections,
    routeMeasurements,
  };
}

describe("work item extraction", () => {
  it("reads raw Responses API output text", () => {
    expect(
      getResponseOutputText({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: '{"items":[]}',
              },
            ],
          },
        ],
      }),
    ).toBe('{"items":[]}');
  });

  it("passes photo attachments to OpenAI vision as input_image data URLs", () => {
    const project = buildProject([buildAttachment()]);
    const request = buildOpenAiVisionRequest({
      attachment: project.attachments[0]!,
      imageDataUrl: "data:image/jpeg;base64,ZmFrZQ==",
      project,
    });
    const imageContent = request.input[0].content.find(
      (content) => content.type === "input_image",
    );

    expect(imageContent).toMatchObject({
      type: "input_image",
      image_url: "data:image/jpeg;base64,ZmFrZQ==",
      detail: "high",
    });
    expect(request.text.format.type).toBe("json_schema");
  });

  it("extracts reviewable work items from photo attachments", async () => {
    const project = buildProject([buildAttachment()]);
    const visionExtractor = vi.fn<VisionExtractor>(async (input) => {
      expect(input.imageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
      expect(input.attachment.id).toBe("photo-1");

      return [
        {
          description: "Add New Receptacle visible near patio wall",
          quantity: 1,
          confidence: 0.88,
          manualReview: false,
          area: "Patio",
          priceBookKeywords: ["Add New Receptacle"],
        },
      ];
    });

    const result = await extractDetectedWorkItems(project, priceBook, {
      visionExtractor,
      readUpload: async () => ({
        file: Buffer.from("fake-image"),
        storageKey: "intake-test/1-photo-panel.jpg",
        contentType: "image/jpeg",
      }),
    });

    const photoItem = result.items.find((item) => item.sourceType === "photo");
    expect(photoItem).toMatchObject({
      description: "Add New Receptacle visible near patio wall",
      quantity: 1,
      confidence: 0.88,
      sourceAttachmentId: "photo-1",
      sourcePath: "intake-test/1-photo-panel.jpg",
      manualReview: false,
      reviewStatus: "pending",
      suggestedPriceBookMatch: {
        id: "add-new-receptacle",
      },
    });
  });

  it("reads walkthrough sections before loose attachment-level analysis", async () => {
    const sectionPhoto = buildAttachment({
      id: "section-photo-1",
      kind: "section_photo",
      name: "living-room.jpg",
      storageKey: "intake-test/section-living-room.jpg",
      projectId: "intake-test",
      walkthroughId: "walkthrough-1",
      sectionId: "section-living-room",
    });
    const loosePhoto = buildAttachment({
      id: "loose-photo-1",
      name: "loose-photo.jpg",
      storageKey: "intake-test/loose-photo.jpg",
    });
    const project = withWalkthroughSections(
      buildProject([sectionPhoto, loosePhoto]),
      [buildSection()],
    );

    const result = await extractDetectedWorkItems(project, priceBook, {
      visionExtractor: async () => [
        {
          description: "Add New Receptacle in Living Room",
          quantity: 1,
          confidence: 0.86,
          manualReview: false,
          area: "Living Room",
          priceBookKeywords: ["Add New Receptacle"],
        },
      ],
      readUpload: async (path) => ({
        file: Buffer.from(`fake-image-${path.join("/")}`),
        storageKey: path.join("/"),
        contentType: "image/jpeg",
      }),
    });

    expect(result.items.some((item) => item.sourceAttachmentId === "loose-photo-1")).toBe(
      false,
    );
    expect(result.items.find((item) => item.sourceAttachmentId === "section-photo-1"))
      .toMatchObject({
        walkthroughId: "walkthrough-1",
        sectionId: "section-living-room",
        sectionName: "Living Room",
        sourceAttachmentIds: ["section-photo-1"],
      });
  });

  it("passes section photos and typed notes together to extraction", async () => {
    const sectionPhoto = buildAttachment({
      id: "section-photo-1",
      kind: "section_photo",
      name: "living-room.jpg",
      storageKey: "intake-test/section-living-room.jpg",
      projectId: "intake-test",
      walkthroughId: "walkthrough-1",
      sectionId: "section-living-room",
    });
    const project = withWalkthroughSections(
      buildProject([sectionPhoto]),
      [
        buildSection({
          typedNote: "Add a receptacle on the TV wall and reuse nearby circuit.",
        }),
      ],
    );
    const visionExtractor = vi.fn<VisionExtractor>(async (input) => {
      expect(input.section?.id).toBe("section-living-room");
      expect(input.sourceNoteText).toContain("TV wall");
      expect(input.sectionAttachments?.map((attachment) => attachment.id)).toEqual([
        "section-photo-1",
      ]);

      return [
        {
          description: "Add New Receptacle on TV wall",
          quantity: 1,
          confidence: 0.9,
          manualReview: false,
          area: "Living Room",
          priceBookKeywords: ["Add New Receptacle"],
        },
      ];
    });

    const result = await extractDetectedWorkItems(project, priceBook, {
      visionExtractor,
      readUpload: async () => ({
        file: Buffer.from("fake-image"),
        storageKey: "intake-test/section-living-room.jpg",
        contentType: "image/jpeg",
      }),
    });

    expect(result.items[0]).toMatchObject({
      description: "Add New Receptacle on TV wall",
      walkthroughId: "walkthrough-1",
      sectionId: "section-living-room",
      sourceAttachmentIds: ["section-photo-1"],
      sourceNoteText: "Add a receptacle on the TV wall and reuse nearby circuit.",
      reviewStatus: "pending",
      pricingStatus: "not_ready",
      requiresReview: true,
    });
  });

  it("passes voice transcripts as section note context", async () => {
    const sectionPhoto = buildAttachment({
      id: "section-photo-1",
      kind: "section_photo",
      name: "garage-wall.jpg",
      storageKey: "intake-test/garage-wall.jpg",
      projectId: "intake-test",
      walkthroughId: "walkthrough-1",
      sectionId: "section-living-room",
    });
    const project = withWalkthroughSections(
      buildProject([sectionPhoto]),
      [
        buildSection({
          areaName: "Garage",
          name: "Garage",
          noteMode: "voice",
          typedNote: undefined,
          transcript: "Voice note says add a GFCI near the workbench.",
        }),
      ],
    );

    const result = await extractDetectedWorkItems(project, priceBook, {
      visionExtractor: async (input) => {
        expect(input.sourceNoteText).toContain("Voice note");

        return [
          {
            description: "Add GFCI receptacle near workbench",
            quantity: 1,
            confidence: 0.84,
            manualReview: false,
            area: "Garage",
            priceBookKeywords: ["receptacle"],
          },
        ];
      },
      readUpload: async () => ({
        file: Buffer.from("fake-image"),
        storageKey: "intake-test/garage-wall.jpg",
        contentType: "image/jpeg",
      }),
    });

    expect(result.items[0]).toMatchObject({
      sectionName: "Garage",
      sourceNoteText: "Voice note says add a GFCI near the workbench.",
      sourceAttachmentIds: ["section-photo-1"],
    });
  });

  it("blocks pricing and creates a prompt when route measurements are missing", async () => {
    const sectionPhoto = buildAttachment({
      id: "section-photo-1",
      kind: "section_photo",
      name: "living-room.jpg",
      storageKey: "intake-test/living-room.jpg",
      projectId: "intake-test",
      walkthroughId: "walkthrough-1",
      sectionId: "section-living-room",
    });
    const project = withWalkthroughSections(
      buildProject([sectionPhoto]),
      [
        buildSection({
          typedNote: "Install dedicated circuit home run from panel for media wall.",
        }),
      ],
    );

    const result = await extractDetectedWorkItems(project, priceBook, {
      visionExtractor: async () => [
        {
          description: "Install dedicated circuit for media wall",
          quantity: 1,
          confidence: 0.82,
          manualReview: false,
          area: "Living Room",
          priceBookKeywords: ["circuit"],
        },
      ],
      readUpload: async () => ({
        file: Buffer.from("fake-image"),
        storageKey: "intake-test/living-room.jpg",
        contentType: "image/jpeg",
      }),
    });

    expect(result.items[0]).toMatchObject({
      pricingStatus: "blocked_missing_measurement",
      requiresReview: true,
      manualReview: true,
      missingMeasurementPrompts: [
        "Confirm route allowance or measured distance from panel to Living Room section.",
      ],
    });
  });

  it("does not block pricing when a section route measurement exists", async () => {
    const sectionPhoto = buildAttachment({
      id: "section-photo-1",
      kind: "section_photo",
      name: "living-room.jpg",
      storageKey: "intake-test/living-room.jpg",
      projectId: "intake-test",
      walkthroughId: "walkthrough-1",
      sectionId: "section-living-room",
    });
    const project = withWalkthroughSections(
      buildProject([sectionPhoto]),
      [
        buildSection({
          typedNote: "Install dedicated circuit home run from panel for media wall.",
        }),
      ],
      [buildRouteMeasurement()],
    );

    const result = await extractDetectedWorkItems(project, priceBook, {
      visionExtractor: async () => [
        {
          description: "Install dedicated circuit for media wall",
          quantity: 1,
          confidence: 0.82,
          manualReview: false,
          area: "Living Room",
          priceBookKeywords: ["circuit"],
        },
      ],
      readUpload: async () => ({
        file: Buffer.from("fake-image"),
        storageKey: "intake-test/living-room.jpg",
        contentType: "image/jpeg",
      }),
    });

    expect(result.items[0]).toMatchObject({
      pricingStatus: "not_ready",
      missingMeasurementPrompts: [],
    });
  });

  it("keeps HEIC section photos accepted but manual-review only", async () => {
    const sectionPhoto = buildAttachment({
      id: "section-photo-heic-1",
      kind: "section_photo",
      name: "living-room.heic",
      storageKey: "intake-test/living-room.heic",
      contentType: "image/heic",
      projectId: "intake-test",
      walkthroughId: "walkthrough-1",
      sectionId: "section-living-room",
    });
    const project = withWalkthroughSections(
      buildProject([sectionPhoto]),
      [
        buildSection({
          photoAttachmentIds: ["section-photo-heic-1"],
          typedNote: "Customer sent an iPhone photo for the living room wall.",
        }),
      ],
    );
    const visionExtractor = vi.fn<VisionExtractor>();
    const readUpload = vi.fn();

    const result = await extractDetectedWorkItems(project, priceBook, {
      visionExtractor,
      readUpload,
    });

    expect(result.items.find((item) => item.sourceAttachmentId === "section-photo-heic-1"))
      .toMatchObject({
        walkthroughId: "walkthrough-1",
        sectionId: "section-living-room",
        sourceType: "photo",
        manualReview: true,
        extractionRequiresConversion: true,
        pricingStatus: "not_ready",
      });
    expect(result.items.some((item) => item.sourceNoteText?.includes("iPhone photo"))).toBe(
      true,
    );
    expect(visionExtractor).not.toHaveBeenCalled();
    expect(readUpload).not.toHaveBeenCalled();
  });

  it("keeps raw section extraction out of estimates, proposals, and notifications", async () => {
    const sectionPhoto = buildAttachment({
      id: "section-photo-1",
      kind: "section_photo",
      name: "living-room.jpg",
      storageKey: "intake-test/living-room.jpg",
      projectId: "intake-test",
      walkthroughId: "walkthrough-1",
      sectionId: "section-living-room",
    });
    const project = withWalkthroughSections(buildProject([sectionPhoto]), [
      buildSection(),
    ]);

    await extractDetectedWorkItems(project, priceBook, {
      visionExtractor: async () => [
        {
          description: "Add New Receptacle in Living Room",
          quantity: 1,
          confidence: 0.86,
          manualReview: false,
          area: "Living Room",
          priceBookKeywords: ["Add New Receptacle"],
        },
      ],
      readUpload: async () => ({
        file: Buffer.from("fake-image"),
        storageKey: "intake-test/living-room.jpg",
        contentType: "image/jpeg",
      }),
    });

    expect(project.estimateDraft.lineItems).toHaveLength(0);
    expect(project.proposalVariants).toHaveLength(0);
    expect(project.ownerApprovalStatus.status).toBe("ready");
    expect(project.customerSendStatus.status).toBe("ready");
  });

  it("keeps attachment-level analysis as fallback when no walkthrough sections exist", async () => {
    const project = buildProject([buildAttachment()]);

    const result = await extractDetectedWorkItems(project, priceBook, {
      visionExtractor: async () => [
        {
          description: "Add New Receptacle from fallback photo",
          quantity: 1,
          confidence: 0.83,
          manualReview: false,
          area: "Patio",
          priceBookKeywords: ["Add New Receptacle"],
        },
      ],
      readUpload: async () => ({
        file: Buffer.from("fake-image"),
        storageKey: "intake-test/1-photo-panel.jpg",
        contentType: "image/jpeg",
      }),
    });

    expect(result.items.find((item) => item.sourceAttachmentId === "photo-1"))
      .toMatchObject({
        sectionId: undefined,
        sourceType: "photo",
        description: "Add New Receptacle from fallback photo",
      });
  });

  it("marks videos as unsupported manual-review items until frame extraction exists", async () => {
    const project = buildProject([
      buildAttachment({
        id: "video-1",
        kind: "video",
        name: "walkthrough.mov",
        storageKey: "intake-test/2-video-walkthrough.mov",
        contentType: "video/quicktime",
      }),
    ]);

    const result = await extractDetectedWorkItems(project, priceBook);
    const videoItem = result.items.find((item) => item.sourceType === "video");

    expect(result.status.status).toBe("partial");
    expect(videoItem).toMatchObject({
      sourceAttachmentId: "video-1",
      sourcePath: "intake-test/2-video-walkthrough.mov",
      confidence: 0,
      manualReview: true,
      reviewStatus: "pending",
    });
    expect(videoItem?.description).toContain("frame extraction is not implemented");
  });

  it("accepts HEIC photos for intake but marks extraction as requiring conversion", async () => {
    const project = buildProject([
      buildAttachment({
        id: "photo-heic-1",
        name: "customer-panel.heic",
        storageKey: "intake-test/3-photo-customer-panel.heic",
        contentType: "image/heic",
      }),
    ]);
    const visionExtractor = vi.fn<VisionExtractor>();
    const readUpload = vi.fn();

    const result = await extractDetectedWorkItems(project, priceBook, {
      visionExtractor,
      readUpload,
    });
    const heicItem = result.items.find(
      (item) => item.sourceAttachmentId === "photo-heic-1",
    );

    expect(result.status.status).toBe("partial");
    expect(heicItem).toMatchObject({
      sourceType: "photo",
      sourceAttachmentId: "photo-heic-1",
      sourcePath: "intake-test/3-photo-customer-panel.heic",
      confidence: 0,
      manualReview: true,
      reviewStatus: "pending",
      extractionRequiresConversion: true,
    });
    expect(heicItem?.description).toContain("requires JPEG conversion");
    expect(visionExtractor).not.toHaveBeenCalled();
    expect(readUpload).not.toHaveBeenCalled();
  });

  it("accepts HEIC photos with generic MIME by extension and marks manual review", async () => {
    const project = buildProject([
      buildAttachment({
        id: "photo-heic-2",
        name: "customer-panel.HEIC",
        storageKey: "intake-test/4-photo-customer-panel.heic",
        contentType: "application/octet-stream",
      }),
    ]);

    const result = await extractDetectedWorkItems(project, priceBook);
    const heicItem = result.items.find(
      (item) => item.sourceAttachmentId === "photo-heic-2",
    );

    expect(heicItem).toMatchObject({
      sourceType: "photo",
      manualReview: true,
      extractionRequiresConversion: true,
    });
  });

  it("keeps low-confidence detections in manual review and out of estimate lines", async () => {
    const project = buildProject([buildAttachment()]);
    const result = await extractDetectedWorkItems(project, priceBook, {
      visionExtractor: async () => [
        {
          description: "Possible receptacle work, unclear wall location",
          quantity: 1,
          confidence: 0.41,
          manualReview: false,
          area: "Unknown",
          priceBookKeywords: ["receptacle"],
        },
      ],
      readUpload: async () => ({
        file: Buffer.from("fake-image"),
        storageKey: "intake-test/1-photo-panel.jpg",
        contentType: "image/jpeg",
      }),
    });

    expect(result.items.find((item) => item.sourceType === "photo")).toMatchObject({
      confidence: 0.41,
      manualReview: true,
      reviewStatus: "pending",
    });
    expect(project.estimateDraft.lineItems).toHaveLength(0);
    expect(project.proposalVariants).toHaveLength(0);
  });
});
