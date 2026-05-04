import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { createIntakeProject } from "@/lib/intake-session";
import { upsertProject } from "@/lib/local-store";
import type { ProjectIntakeInput } from "@/lib/types";

export async function POST(request: Request) {
  const { response, session } = await requireApiSession();

  if (response) {
    return response;
  }

  const body = (await request.json()) as ProjectIntakeInput;

  if (!body.id || !body.customer?.name || !body.scopeDescription) {
    return NextResponse.json(
      { error: "Customer name and scope notes are required to save an intake." },
      { status: 400 },
    );
  }

  const project = createIntakeProject(body, session?.email);
  const savedProject = await upsertProject(project);

  return NextResponse.json(savedProject);
}
