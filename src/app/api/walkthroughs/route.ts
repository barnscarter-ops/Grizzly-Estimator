import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { createWalkthrough } from "@/lib/walkthrough-session";
import type { WalkthroughNoteMode, WalkthroughStatus } from "@/lib/types";

type WalkthroughRequest = {
  projectId?: string;
  id?: string;
  sessionId?: string;
  status?: WalkthroughStatus;
  noteModeDefault?: WalkthroughNoteMode;
};

export async function POST(request: Request) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const body = (await request.json()) as WalkthroughRequest;

  if (!body.projectId) {
    return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  }

  const project = await getProjectById(body.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const updatedProject = createWalkthrough(project, {
    id: body.id,
    sessionId: body.sessionId,
    status: body.status,
    noteModeDefault: body.noteModeDefault,
  });
  const savedProject = await upsertProject(updatedProject);
  const walkthrough = savedProject.walkthroughs?.find(
    (item) => item.id === (body.id ?? updatedProject.walkthroughs?.[0]?.id),
  );

  return NextResponse.json({ project: savedProject, walkthrough });
}
