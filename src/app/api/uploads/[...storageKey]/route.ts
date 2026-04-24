import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { readStoredUpload } from "@/lib/upload-storage";

type UploadFileRouteProps = {
  params: Promise<{ storageKey: string[] }>;
};

export async function GET(_request: Request, { params }: UploadFileRouteProps) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const { storageKey } = await params;
  const stored = await readStoredUpload(storageKey);

  if (!stored) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  return new NextResponse(stored.file, {
    headers: {
      "Content-Type": stored.contentType,
      "Cache-Control": "private, no-store",
    },
  });
}
