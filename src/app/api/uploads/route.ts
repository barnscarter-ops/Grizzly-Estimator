import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import {
  attachIntakeMedia,
  isSupportedAttachmentKind,
  validateUploadFile,
} from "@/lib/intake-session";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { deleteStoredUpload, storeUpload } from "@/lib/upload-storage";
import { attachAttachmentToWalkthroughSection } from "@/lib/walkthrough-session";

function humanFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function POST(request: Request) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const formData = await request.formData();
  const projectId = formData.get("projectId");
  const kind = formData.get("kind");
  const replaceAttachmentId = formData.get("replaceAttachmentId");
  const walkthroughId = formData.get("walkthroughId");
  const sectionId = formData.get("sectionId");
  const file = formData.get("file");

  if (
    typeof projectId !== "string" ||
    typeof kind !== "string" ||
    !(file instanceof File)
  ) {
    return NextResponse.json(
      { error: "projectId, kind, and file are required." },
      { status: 400 },
    );
  }

  if (!isSupportedAttachmentKind(kind)) {
    return NextResponse.json({ error: "Unsupported attachment type." }, { status: 400 });
  }

  const project = await getProjectById(projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  if (
    typeof replaceAttachmentId === "string" &&
    !project.attachments.some((attachment) => attachment.id === replaceAttachmentId)
  ) {
    return NextResponse.json(
      { error: "Attachment to replace was not found." },
      { status: 404 },
    );
  }

  const shouldAttachToSection =
    kind === "section_photo" || kind === "section_audio_note";

  if (
    shouldAttachToSection &&
    (typeof walkthroughId !== "string" || typeof sectionId !== "string")
  ) {
    return NextResponse.json(
      { error: "walkthroughId and sectionId are required for section uploads." },
      { status: 400 },
    );
  }

  if (shouldAttachToSection) {
    const section = (project.walkthroughSections ?? []).find(
      (item) => item.id === sectionId,
    );

    if (!section || section.walkthroughId !== walkthroughId) {
      return NextResponse.json(
        { error: "Walkthrough section was not found for this upload." },
        { status: 404 },
      );
    }
  }

  const validation = validateUploadFile({
    kind,
    contentType: file.type || "application/octet-stream",
    fileName: file.name,
    sizeBytes: file.size,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let storedUpload;

  try {
    storedUpload = await storeUpload({
      projectId,
      kind,
      fileName: file.name,
      contentType: file.type,
      bytes,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Upload failed before the file reached storage.",
      },
      { status: 502 },
    );
  }

  const nextAttachment = {
    id: `${projectId}-${Date.now()}-${kind}`,
    kind,
    name: storedUpload.fileName,
    sizeLabel: humanFileSize(storedUpload.sizeBytes),
    uploadStatus: "complete" as const,
    progress: 100,
    previewUrl: storedUpload.fileUrl,
    storageKey: storedUpload.storageKey,
    contentType: storedUpload.contentType,
    sizeBytes: storedUpload.sizeBytes,
    uploadedAt: new Date().toISOString(),
    projectId,
    walkthroughId: typeof walkthroughId === "string" ? walkthroughId : undefined,
    sectionId: typeof sectionId === "string" ? sectionId : undefined,
  };

  const replacedAttachment =
    typeof replaceAttachmentId === "string"
      ? project.attachments.find((attachment) => attachment.id === replaceAttachmentId)
      : undefined;
  let updatedProject = attachIntakeMedia(
    project,
    nextAttachment,
    typeof replaceAttachmentId === "string" ? replaceAttachmentId : undefined,
  );

  if (
    shouldAttachToSection &&
    typeof walkthroughId === "string" &&
    typeof sectionId === "string"
  ) {
    try {
      updatedProject = attachAttachmentToWalkthroughSection(updatedProject, {
        walkthroughId,
        sectionId,
        attachment: nextAttachment,
        replaceAttachmentId:
          typeof replaceAttachmentId === "string" ? replaceAttachmentId : undefined,
      });
    } catch (error) {
      await deleteStoredUpload(storedUpload.storageKey).catch(() => undefined);

      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Section upload metadata could not be saved.",
          storageSaved: false,
          projectSaved: false,
        },
        { status: 400 },
      );
    }
  }

  let savedProject;

  try {
    savedProject = await upsertProject(updatedProject);
  } catch (error) {
    await deleteStoredUpload(storedUpload.storageKey).catch(() => undefined);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `File reached storage, but intake metadata could not be saved: ${error.message}`
            : "File reached storage, but intake metadata could not be saved.",
        storageSaved: false,
        projectSaved: false,
      },
      { status: 500 },
    );
  }

  if (replacedAttachment?.storageKey) {
    await deleteStoredUpload(replacedAttachment.storageKey).catch((error) => {
      console.warn("[uploads] Replaced attachment cleanup failed", {
        attachmentId: replacedAttachment.id,
        error: error instanceof Error ? error.message : "Unknown cleanup error.",
      });
    });
  }

  return NextResponse.json({
    attachment: nextAttachment,
    project: savedProject,
  });
}
