import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { analyzeProject } from "@/lib/estimate-engine";
import { upsertProject } from "@/lib/local-store";
import { getPriceBookEntries } from "@/lib/price-book";
import {
  initializeProposalWorkflow,
  sendOwnerApprovalRequest,
} from "@/lib/proposal-workflow";
import type { ProjectIntakeInput } from "@/lib/types";

export async function POST(request: Request) {
  const { response, session } = await requireApiSession();

  if (response) {
    return response;
  }

  const body = (await request.json()) as ProjectIntakeInput;
  const priceBook = await getPriceBookEntries();
  let project = initializeProposalWorkflow(
    analyzeProject(body, priceBook),
    session?.email,
  );

  await upsertProject(project);

  const ownerNotification = await sendOwnerApprovalRequest(
    project,
    new URL(request.url).origin,
  );
  project = ownerNotification.project;
  await upsertProject(project);

  return NextResponse.json(project);
}
