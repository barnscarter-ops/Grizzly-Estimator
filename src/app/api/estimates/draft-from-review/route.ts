import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { getPriceBookEntries } from "@/lib/price-book";
import { createEstimateDraftFromReviewedWorkItems } from "@/lib/work-item-review";

type DraftEstimateRequest = {
  projectId?: string;
};

export async function POST(request: Request) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as DraftEstimateRequest;

  if (!body.projectId) {
    return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  }

  const project = await getProjectById(body.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const priceBook = await getPriceBookEntries();
  const result = createEstimateDraftFromReviewedWorkItems(project, priceBook);

  if (!result.ok) {
    return NextResponse.json(
      { project: result.project, error: result.message, ok: false },
      { status: 422 },
    );
  }

  const savedProject = await upsertProject(result.project);

  return NextResponse.json({
    project: savedProject,
    message: result.message,
    ok: true,
  });
}
