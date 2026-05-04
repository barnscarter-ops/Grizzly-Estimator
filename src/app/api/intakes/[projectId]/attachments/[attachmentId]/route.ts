import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { removeIntakeMedia } from "@/lib/intake-session";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { deleteStoredUpload } from "@/lib/upload-storage";

type IntakeAttachmentRouteProps = {
  params: Promise<{ projectId: string; attachmentId: string }>;
};

export async function DELETE(
  _request: Request,
  { params }: IntakeAttachmentRouteProps,
) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const { projectId, attachmentId } = await params;
  const project = await getProjectById(projectId);

  if (!project) {
    return NextResponse.json({ error: "Intake session not found." }, { status: 404 });
  }

  const { project: updatedProject, removedAttachment } = removeIntakeMedia(
    project,
    attachmentId,
  );

  if (!removedAttachment) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const savedProject = await upsertProject(updatedProject);
  let storageDeleteError = "";

  if (removedAttachment.storageKey) {
    try {
      await deleteStoredUpload(removedAttachment.storageKey);
    } catch (error) {
      storageDeleteError =
        error instanceof Error ? error.message : "Stored file could not be deleted.";
    }
  }

  return NextResponse.json({
    project: savedProject,
    warning: storageDeleteError || undefined,
  });
}
