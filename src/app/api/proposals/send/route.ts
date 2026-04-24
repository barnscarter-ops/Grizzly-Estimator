import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { sendCustomerProposal } from "@/lib/proposal-workflow";
import type { ProposalStyle } from "@/lib/types";

export async function POST(request: Request) {
  const { response, session } = await requireApiSession();

  if (response) {
    return response;
  }

  const body = (await request.json()) as {
    projectId?: string;
    proposalStyle?: ProposalStyle;
    force?: boolean;
  };

  if (!body.projectId) {
    return NextResponse.json({ error: "Project ID is required." }, { status: 400 });
  }

  const project = await getProjectById(body.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const style = body.proposalStyle ?? project.proposalWorkflow.activeStyle;
  const preparedProject = {
    ...project,
    proposalWorkflow: {
      ...project.proposalWorkflow,
      activeStyle: style,
      ownerApprovedAt: project.proposalWorkflow.ownerApprovedAt ?? new Date().toISOString(),
      ownerApprovedByEmail:
        session?.email ?? process.env.APP_ADMIN_EMAIL ?? "owner",
    },
  };
  const result = await sendCustomerProposal(
    preparedProject,
    new URL(request.url).origin,
    body.force,
  );

  await upsertProject(result.project);

  return NextResponse.json(
    {
      project: result.project,
      message: result.message,
      error: result.ok ? undefined : result.message,
      ok: result.ok,
    },
    { status: result.ok ? 200 : 422 },
  );
}
