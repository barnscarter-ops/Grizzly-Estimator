import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { updateWalkthrough } from "@/lib/walkthrough-session";
import type { WalkthroughNoteMode, WalkthroughStatus } from "@/lib/types";

type WalkthroughRouteProps = {
  params: Promise<{ walkthroughId: string }>;
};

type WalkthroughUpdateRequest = {
  projectId?: string;
  sessionId?: string;
  status?: WalkthroughStatus;
  noteModeDefault?: WalkthroughNoteMode;
};

export async function PATCH(
  request: Request,
  { params }: WalkthroughRouteProps,
) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const { walkthroughId } = await params;
  const body = (await request.json()) as WalkthroughUpdateRequest;

  if (!body.projectId) {
    return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  }

  const project = await getProjectById(body.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  try {
    const updatedProject = updateWalkthrough(project, walkthroughId, {
      sessionId: body.sessionId,
      status: body.status,
      noteModeDefault: body.noteModeDefault,
    });
    const savedProject = await upsertProject(updatedProject);
    const walkthrough = savedProject.walkthroughs?.find(
      (item) => item.id === walkthroughId,
    );

    return NextResponse.json({ project: savedProject, walkthrough });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Walkthrough could not be updated.",
      },
      { status: 404 },
    );
  }
}
