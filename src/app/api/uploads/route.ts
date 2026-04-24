import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { storeUpload } from "@/lib/upload-storage";

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

  const project = await getProjectById(projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const storedUpload = await storeUpload({
    projectId,
    kind,
    fileName: file.name,
    contentType: file.type,
    bytes,
  });

  const nextAttachment = {
    id: `${projectId}-${Date.now()}-${kind}`,
    kind: kind as "video" | "blueprint" | "note" | "photo",
    name: storedUpload.fileName,
    sizeLabel: humanFileSize(storedUpload.sizeBytes),
    uploadStatus: "complete" as const,
    progress: 100,
    previewUrl: storedUpload.fileUrl,
    storageKey: storedUpload.storageKey,
    contentType: storedUpload.contentType,
  };

  const updatedProject = {
    ...project,
    attachments: [
      nextAttachment,
      ...project.attachments.filter((attachment) =>
        kind === "video" ? attachment.kind !== "video" : true,
      ),
    ],
  };

  await upsertProject(updatedProject);

  return NextResponse.json({
    attachment: nextAttachment,
    project: updatedProject,
  });
}
