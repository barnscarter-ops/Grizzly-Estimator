import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { updateIntakeProject } from "@/lib/intake-session";
import { getProjectById, upsertProject } from "@/lib/local-store";
import type { ProjectIntakeInput } from "@/lib/types";

type IntakeRouteProps = {
  params: Promise<{ projectId: string }>;
};

export async function PATCH(request: Request, { params }: IntakeRouteProps) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const { projectId } = await params;
  const project = await getProjectById(projectId);

  if (!project) {
    return NextResponse.json({ error: "Intake session not found." }, { status: 404 });
  }

  const body = (await request.json()) as ProjectIntakeInput;

  if (!body.customer?.name || !body.scopeDescription) {
    return NextResponse.json(
      { error: "Customer name and scope notes are required to save an intake." },
      { status: 400 },
    );
  }

  const updatedProject = updateIntakeProject(project, {
    ...body,
    id: project.id,
    attachments: project.attachments,
  });
  const savedProject = await upsertProject(updatedProject);

  return NextResponse.json(savedProject);
}
