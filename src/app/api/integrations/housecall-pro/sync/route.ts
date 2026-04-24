import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { runHousecallProSync } from "@/lib/hcp-sync";
import { getProjectById, upsertProject } from "@/lib/local-store";
import type { ProposalStyle } from "@/lib/types";

export async function POST(request: Request) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const body = (await request.json()) as {
    projectId: string;
    proposalStyle: ProposalStyle;
  };

  const project = await getProjectById(body.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const { updatedProject, sync } = await runHousecallProSync(
    project,
    body.proposalStyle,
  );

  await upsertProject(updatedProject);

  return NextResponse.json({ project: updatedProject, sync });
}
