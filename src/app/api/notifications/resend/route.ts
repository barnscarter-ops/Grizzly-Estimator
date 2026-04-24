import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getProjectById, upsertProject } from "@/lib/local-store";
import {
  canResendNotification,
  sendCustomerProposal,
  sendOwnerApprovalRequest,
} from "@/lib/proposal-workflow";
import type { NotificationType } from "@/lib/types";

function isValidType(value: string | undefined): value is NotificationType {
  return value === "owner_approval" || value === "customer_send";
}

export async function POST(request: Request) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    projectId?: string;
    type?: string;
    manualOverride?: boolean;
  };

  if (!body.projectId || !isValidType(body.type)) {
    return NextResponse.json(
      { error: "Project ID and notification type are required." },
      { status: 400 },
    );
  }

  const project = await getProjectById(body.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  if (!canResendNotification(project, body.type, body.manualOverride)) {
    return NextResponse.json(
      {
        error:
          "Resend is only allowed after a failed notification or when manual override is enabled.",
      },
      { status: 409 },
    );
  }

  const origin = new URL(request.url).origin;
  const result =
    body.type === "owner_approval"
      ? await sendOwnerApprovalRequest(project, origin, body.manualOverride)
      : await sendCustomerProposal(project, origin, body.manualOverride);

  await upsertProject(result.project);

  return NextResponse.json(
    {
      ok: result.ok,
      message: result.message,
      project: result.project,
      error: result.ok ? undefined : result.message,
    },
    { status: result.ok ? 200 : 422 },
  );
}
