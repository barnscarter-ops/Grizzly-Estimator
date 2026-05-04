import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getProjectById, upsertProject } from "@/lib/local-store";
import {
  reviewDetectedWorkItem,
  type WorkItemReviewDecision,
} from "@/lib/work-item-review";
import type { SuggestedPriceBookMatch } from "@/lib/types";

type ReviewWorkItemRequest = {
  projectId?: string;
  workItemId?: string;
  decision?: WorkItemReviewDecision;
  description?: string;
  quantity?: number;
  unit?: string;
  suggestedPriceBookMatch?: SuggestedPriceBookMatch;
  reviewerNote?: string;
};

function isReviewDecision(value: unknown): value is WorkItemReviewDecision {
  return value === "approve" || value === "reject" || value === "edit";
}

export async function POST(request: Request) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as ReviewWorkItemRequest;

  if (!body.projectId || !body.workItemId || !isReviewDecision(body.decision)) {
    return NextResponse.json(
      { error: "projectId, workItemId, and a valid decision are required." },
      { status: 400 },
    );
  }

  const project = await getProjectById(body.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const result = reviewDetectedWorkItem(project, {
    workItemId: body.workItemId,
    decision: body.decision,
    description: body.description,
    quantity: body.quantity,
    unit: body.unit,
    suggestedPriceBookMatch: body.suggestedPriceBookMatch,
    reviewerNote: body.reviewerNote,
  });

  if (!result.ok) {
    return NextResponse.json(
      { project: result.project, error: result.message, ok: false },
      { status: 422 },
    );
  }

  const savedProject = await upsertProject(result.project);

  return NextResponse.json({
    project: savedProject,
    workItem: result.item,
    message: result.message,
    ok: true,
  });
}
