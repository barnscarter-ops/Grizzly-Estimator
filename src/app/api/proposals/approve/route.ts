import { NextResponse } from "next/server";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { approveCustomerProposal } from "@/lib/proposal-workflow";
import { validateProposalShareToken } from "@/lib/proposal-share";
import type { ProposalStyle } from "@/lib/types";

function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim();
  }

  return request.headers.get("x-real-ip")?.trim() ?? undefined;
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    projectId?: string;
    proposalStyle?: ProposalStyle;
    token?: string;
    signedByName?: string;
    signedByEmail?: string;
    signatureText?: string;
  };

  if (!body.projectId || !body.proposalStyle || !body.token) {
    return NextResponse.json(
      { error: "Project, proposal style, and share token are required." },
      { status: 400 },
    );
  }

  const project = await getProjectById(body.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  if (!validateProposalShareToken(body.token, project.id, body.proposalStyle)) {
    return NextResponse.json({ error: "This proposal link is invalid or expired." }, { status: 403 });
  }

  const signedByName = body.signedByName?.trim() ?? "";
  const signedByEmail = body.signedByEmail?.trim() ?? "";
  const signatureText = body.signatureText?.trim() ?? "";

  if (!signedByName || !signedByEmail || !signatureText) {
    return NextResponse.json(
      { error: "Name, email, and typed signature are required to approve." },
      { status: 400 },
    );
  }

  if (signatureText.toLowerCase() !== signedByName.toLowerCase()) {
    return NextResponse.json(
      {
        error:
          "Type your full name exactly into the signature field so the approval record matches the signer name.",
      },
      { status: 400 },
    );
  }

  const result = await approveCustomerProposal({
    project,
    style: body.proposalStyle,
    signedByName,
    signedByEmail,
    signatureText,
    requestIp: getRequestIp(request),
  });

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
