import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getDashboardData } from "@/lib/local-store";

export async function GET() {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const dashboard = await getDashboardData();
  return NextResponse.json(dashboard);
}
