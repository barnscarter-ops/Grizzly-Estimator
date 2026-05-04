import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { upsertWalkthroughSection } from "@/lib/walkthrough-session";
import type {
  SectionMeasurements,
  WalkthroughSectionExtractionStatus,
  WalkthroughSectionNoteMode,
} from "@/lib/types";

type WalkthroughSectionRouteProps = {
  params: Promise<{ walkthroughId: string; sectionId: string }>;
};

type SectionUpdateRequest = {
  projectId?: string;
  name?: string;
  areaName?: string;
  sortOrder?: number;
  noteMode?: WalkthroughSectionNoteMode;
  photoAttachmentIds?: string[];
  audioNoteAttachmentId?: string;
  transcript?: string;
  typedNote?: string;
  sectionMeasurements?: SectionMeasurements;
  extractionStatus?: WalkthroughSectionExtractionStatus;
};

export async function PATCH(
  request: Request,
  { params }: WalkthroughSectionRouteProps,
) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const { walkthroughId, sectionId } = await params;
  const body = (await request.json()) as SectionUpdateRequest;

  if (!body.projectId) {
    return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  }

  const project = await getProjectById(body.projectId);
  const existingSection = project?.walkthroughSections?.find(
    (section) => section.id === sectionId,
  );

  if (!project || !existingSection) {
    return NextResponse.json({ error: "Walkthrough section not found." }, { status: 404 });
  }

  try {
    const updatedProject = upsertWalkthroughSection(project, {
      id: sectionId,
      walkthroughId,
      name: body.name ?? existingSection.name,
      areaName: body.areaName ?? existingSection.areaName,
      sortOrder: body.sortOrder,
      noteMode: body.noteMode,
      photoAttachmentIds: body.photoAttachmentIds,
      audioNoteAttachmentId: body.audioNoteAttachmentId,
      transcript: body.transcript,
      typedNote: body.typedNote,
      sectionMeasurements: body.sectionMeasurements,
      extractionStatus: body.extractionStatus,
    });
    const savedProject = await upsertProject(updatedProject);
    const section = savedProject.walkthroughSections?.find(
      (item) => item.id === sectionId,
    );

    return NextResponse.json({ project: savedProject, section });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Walkthrough section could not be saved.",
      },
      { status: 404 },
    );
  }
}
