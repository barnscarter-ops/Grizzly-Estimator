import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { upsertWalkthroughSection } from "@/lib/walkthrough-session";
import type {
  SectionMeasurements,
  WalkthroughSectionExtractionStatus,
  WalkthroughSectionNoteMode,
} from "@/lib/types";

type WalkthroughSectionsRouteProps = {
  params: Promise<{ walkthroughId: string }>;
};

type SectionRequest = {
  projectId?: string;
  id?: string;
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

export async function POST(
  request: Request,
  { params }: WalkthroughSectionsRouteProps,
) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const { walkthroughId } = await params;
  const body = (await request.json()) as SectionRequest;

  if (!body.projectId || !body.areaName) {
    return NextResponse.json(
      { error: "projectId and areaName are required." },
      { status: 400 },
    );
  }

  const project = await getProjectById(body.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  try {
    const updatedProject = upsertWalkthroughSection(project, {
      id: body.id,
      walkthroughId,
      name: body.name,
      areaName: body.areaName,
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
      (item) => item.id === (body.id ?? updatedProject.walkthroughSections?.[0]?.id),
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
