import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { getPriceBookEntries } from "@/lib/price-book";
import { extractDetectedWorkItems } from "@/lib/work-item-extraction";

type AnalyzeRequest = {
  projectId?: string;
};

export async function POST(request: Request) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const body = (await request.json().catch(() => ({}))) as AnalyzeRequest;

  if (!body.projectId) {
    return NextResponse.json(
      { error: "Save an intake session before running extraction." },
      { status: 400 },
    );
  }

  const project = await getProjectById(body.projectId);

  if (!project) {
    return NextResponse.json({ error: "Intake session not found." }, { status: 404 });
  }

  const priceBook = await getPriceBookEntries();
  const extraction = await extractDetectedWorkItems(project, priceBook);
  const sectionIdsWithItems = new Set(
    extraction.items
      .map((item) => item.sectionId)
      .filter((sectionId): sectionId is string => Boolean(sectionId)),
  );
  const updatedWalkthroughSections = project.walkthroughSections?.map((section) =>
    sectionIdsWithItems.has(section.id)
      ? {
          ...section,
          extractionStatus: "complete" as const,
          updatedAt: extraction.status.updatedAt,
        }
      : section,
  );
  const walkthroughIdsWithItems = new Set(
    extraction.items
      .map((item) => item.walkthroughId)
      .filter((walkthroughId): walkthroughId is string => Boolean(walkthroughId)),
  );
  const updatedWalkthroughs = project.walkthroughs?.map((walkthrough) =>
    walkthroughIdsWithItems.has(walkthrough.id)
      ? {
          ...walkthrough,
          status: "extracted" as const,
          updatedAt: extraction.status.updatedAt,
        }
      : walkthrough,
  );
  const sectionCount = sectionIdsWithItems.size;
  const updatedProject = {
    ...project,
    detectedWorkItems: extraction.items,
    extractionStatus: extraction.status,
    intakeStatus: "ready_for_estimate" as const,
    updatedAt: extraction.status.updatedAt,
    walkthroughs: updatedWalkthroughs ?? project.walkthroughs,
    walkthroughSections: updatedWalkthroughSections ?? project.walkthroughSections,
    estimateDraft: project.estimateDraft,
    proposalVariants: project.proposalVariants,
    analysisSummary: [
      sectionCount > 0
        ? `${extraction.items.length} detected work item${
            extraction.items.length === 1 ? "" : "s"
          } ready for review across ${sectionCount} walkthrough section${
            sectionCount === 1 ? "" : "s"
          }.`
        : `${extraction.items.length} detected work item${
            extraction.items.length === 1 ? "" : "s"
          } ready for review.`,
      "Estimate pricing and proposal generation remain blocked until human review approves scope.",
    ],
  };

  const savedProject = await upsertProject(updatedProject);
  return NextResponse.json(savedProject);
}
