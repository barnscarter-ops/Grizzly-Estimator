import { describe, expect, it } from "vitest";
import {
  attachIntakeMedia,
  createIntakeProject,
  removeIntakeMedia,
  updateIntakeProject,
  validateUploadFile,
} from "./intake-session";
import type { Attachment, ProjectIntakeInput } from "./types";

function buildInput(overrides: Partial<ProjectIntakeInput> = {}): ProjectIntakeInput {
  return {
    id: "intake-test",
    title: "Panel walkthrough",
    customer: {
      name: "Test Customer",
      address: "100 Field Lane",
    },
    propertyType: "single_family",
    projectType: "residential",
    projectSubtype: "circuit_add",
    scopeDescription: "Walk panel, garage, and patio before estimating.",
    blueprintIncluded: false,
    notes: ["Customer wants patio outlets checked."],
    attachments: [],
    transcriptSegments: [],
    requestedActions: [],
    ...overrides,
  };
}

function buildAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "attachment-1",
    kind: "photo",
    name: "panel.jpg",
    sizeLabel: "1.1 MB",
    uploadStatus: "complete",
    progress: 100,
    storageKey: "intake-test/1-photo-panel.jpg",
    contentType: "image/jpeg",
    sizeBytes: 1_100_000,
    uploadedAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("intake sessions", () => {
  it("creates an intake-only project without running estimate generation", () => {
    const project = createIntakeProject(buildInput(), "estimator@example.com");

    expect(project.intakeStatus).toBe("saved");
    expect(project.createdByEmail).toBe("estimator@example.com");
    expect(project.estimateDraft.lineItems).toHaveLength(0);
    expect(project.proposalVariants).toHaveLength(0);
    expect(project.proposalWorkflow.status).toBe("intake_draft");
    expect(project.ownerApprovalStatus.status).toBe("ready");
    expect(project.customerSendStatus.status).toBe("ready");
    expect(project.transcriptSegments[0]?.text).toContain("Walk panel");
  });

  it("updates typed notes without dropping existing media", () => {
    const project = attachIntakeMedia(
      createIntakeProject(buildInput()),
      buildAttachment(),
    );
    const updated = updateIntakeProject(
      project,
      buildInput({
        scopeDescription: "Updated scope text.",
        notes: ["Updated typed note."],
      }),
    );

    expect(updated.scopeDescription).toBe("Updated scope text.");
    expect(updated.notes).toEqual(["Updated typed note."]);
    expect(updated.attachments).toHaveLength(1);
  });

  it("allows multiple photos and videos, then supports replace and remove", () => {
    const project = createIntakeProject(buildInput());
    const photo = buildAttachment({ id: "photo-1", kind: "photo" });
    const firstVideo = buildAttachment({
      id: "video-1",
      kind: "video",
      name: "walkthrough-a.mov",
      contentType: "video/quicktime",
    });
    const secondVideo = buildAttachment({
      id: "video-2",
      kind: "video",
      name: "walkthrough-b.mov",
      contentType: "video/quicktime",
    });

    const withMedia = attachIntakeMedia(
      attachIntakeMedia(attachIntakeMedia(project, photo), firstVideo),
      secondVideo,
    );
    const replacement = buildAttachment({
      id: "video-3",
      kind: "video",
      name: "walkthrough-replacement.mov",
      contentType: "video/quicktime",
    });
    const replaced = attachIntakeMedia(withMedia, replacement, "video-1");
    const { project: removed, removedAttachment } = removeIntakeMedia(
      replaced,
      "photo-1",
    );

    expect(withMedia.attachments.filter((item) => item.kind === "video")).toHaveLength(2);
    expect(replaced.attachments.some((item) => item.id === "video-3")).toBe(true);
    expect(replaced.attachments.some((item) => item.id === "video-1")).toBe(false);
    expect(removedAttachment?.id).toBe("photo-1");
    expect(removed.attachments.some((item) => item.id === "photo-1")).toBe(false);
  });

  it("supports replacing and removing HEIC photo attachments", () => {
    const project = createIntakeProject(buildInput());
    const heicPhoto = buildAttachment({
      id: "photo-heic-1",
      name: "customer-panel.heic",
      contentType: "image/heic",
      storageKey: "intake-test/1-photo-customer-panel.heic",
    });
    const replacement = buildAttachment({
      id: "photo-heic-2",
      name: "customer-panel-new.heif",
      contentType: "image/heif",
      storageKey: "intake-test/2-photo-customer-panel-new.heif",
    });

    const withHeic = attachIntakeMedia(project, heicPhoto);
    const replaced = attachIntakeMedia(withHeic, replacement, "photo-heic-1");
    const { project: removed, removedAttachment } = removeIntakeMedia(
      replaced,
      "photo-heic-2",
    );

    expect(withHeic.attachments[0]).toMatchObject({
      kind: "photo",
      name: "customer-panel.heic",
      contentType: "image/heic",
    });
    expect(replaced.attachments.some((item) => item.id === "photo-heic-1")).toBe(false);
    expect(replaced.attachments[0]).toMatchObject({
      kind: "photo",
      name: "customer-panel-new.heif",
      contentType: "image/heif",
    });
    expect(removedAttachment?.name).toBe("customer-panel-new.heif");
    expect(removed.attachments).toHaveLength(0);
  });

  it("validates file type and size before upload", () => {
    expect(
      validateUploadFile({
        kind: "photo",
        contentType: "video/mp4",
        sizeBytes: 100,
      }),
    ).toMatchObject({ ok: false, status: 415 });

    expect(
      validateUploadFile({
        kind: "video",
        contentType: "video/mp4",
        sizeBytes: 2 * 1024 * 1024 * 1024,
      }),
    ).toMatchObject({ ok: false, status: 413 });

    expect(
      validateUploadFile({
        kind: "video",
        contentType: "video/mp4",
        sizeBytes: 50 * 1024 * 1024,
      }),
    ).toMatchObject({ ok: true });
  });

  it("accepts HEIC and HEIF photos by MIME type or extension fallback", () => {
    expect(
      validateUploadFile({
        kind: "photo",
        contentType: "image/heic",
        fileName: "customer-panel.heic",
        sizeBytes: 100,
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateUploadFile({
        kind: "photo",
        contentType: "image/heif",
        fileName: "customer-panel.heif",
        sizeBytes: 100,
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateUploadFile({
        kind: "photo",
        contentType: "",
        fileName: "customer-panel.heic",
        sizeBytes: 100,
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateUploadFile({
        kind: "photo",
        contentType: "application/octet-stream",
        fileName: "customer-panel.heif",
        sizeBytes: 100,
      }),
    ).toMatchObject({ ok: true });
  });

  it("keeps existing JPG, PNG, and WebP photo uploads accepted", () => {
    for (const [contentType, fileName] of [
      ["image/jpeg", "panel.jpg"],
      ["image/png", "panel.png"],
      ["image/webp", "panel.webp"],
    ]) {
      expect(
        validateUploadFile({
          kind: "photo",
          contentType,
          fileName,
          sizeBytes: 100,
        }),
      ).toMatchObject({ ok: true });
    }
  });

  it("rejects unsupported photo files when neither MIME type nor extension is an image", () => {
    expect(
      validateUploadFile({
        kind: "photo",
        contentType: "application/pdf",
        fileName: "panel.pdf",
        sizeBytes: 100,
      }),
    ).toMatchObject({ ok: false, status: 415 });
  });
});
