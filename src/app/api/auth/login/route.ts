import { NextResponse } from "next/server";
import { applySessionCookie, parseNextPath, verifyLogin } from "@/lib/auth";

type LoginPayload = {
  email?: string;
  password?: string;
  next?: string;
};

export const dynamic = "force-dynamic";

async function parseLoginPayload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as LoginPayload;
    return {
      email: body.email?.trim() ?? "",
      password: body.password ?? "",
      nextPath: parseNextPath(body.next),
      expectsJson: true,
    };
  }

  const formData = await request.formData();
  return {
    email: `${formData.get("email") ?? ""}`.trim(),
    password: `${formData.get("password") ?? ""}`,
    nextPath: parseNextPath(`${formData.get("next") ?? "/"}`),
    expectsJson: false,
  };
}

export async function POST(request: Request) {
  const payload = await parseLoginPayload(request);
  const normalizedEmail = payload.email.trim().toLowerCase();
  console.info("[auth/login] Attempt", {
    email: normalizedEmail || "(blank)",
    nextPath: payload.nextPath,
    expectsJson: payload.expectsJson,
  });

  const result = verifyLogin({
    email: payload.email,
    password: payload.password,
  });

  if (!result.ok) {
    const errorMessage = result.error ?? "Sign-in failed.";
    console.warn("[auth/login] Failed", {
      email: normalizedEmail || "(blank)",
      reason: errorMessage,
    });

    return NextResponse.json(
      { ok: false, error: errorMessage },
      { status: errorMessage.includes("configured") ? 500 : 401 },
    );
  }

  try {
    const response = NextResponse.json({
      ok: true,
      email: result.email,
      redirectTo: payload.nextPath,
    });

    await applySessionCookie(response, result.email);
    console.info("[auth/login] Success", {
      email: result.email,
      redirectTo: payload.nextPath,
    });
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown session creation error.";
    console.error("[auth/login] Session creation failed", {
      email: result.email,
      error: message,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "Sign-in failed because the session could not be created.",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "Use POST to sign in.",
    },
    { status: 405 },
  );
}
