import "server-only";

import { createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, deleteSession, getSessionById } from "@/lib/session-store";
import { getSupabaseConfigurationError, isSupabaseConfigured } from "@/lib/supabase-admin";

const SESSION_COOKIE_NAME = "grizzly_session";

type LoginInput = {
  email: string;
  password: string;
};

function normalizeSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function getProposalSecret() {
  const explicitSecret = process.env.APP_SESSION_SECRET?.trim();

  if (explicitSecret) {
    return normalizeSecret(explicitSecret);
  }

  const derivedSecret = [
    process.env.APP_ADMIN_EMAIL?.trim(),
    process.env.APP_ADMIN_PASSWORD_HASH?.trim(),
    process.env.APP_ADMIN_PASSWORD?.trim(),
  ]
    .filter(Boolean)
    .join(":");

  return derivedSecret ? normalizeSecret(derivedSecret) : "";
}

function getAdminEmail() {
  return process.env.APP_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyAdminPassword(password: string) {
  const passwordHash = process.env.APP_ADMIN_PASSWORD_HASH?.trim();

  if (passwordHash) {
    const [algorithm, salt, digest] = passwordHash.split(":");

    if (algorithm !== "scrypt" || !salt || !digest) {
      return false;
    }

    const derivedKey = scryptSync(password, salt, digest.length / 2).toString("hex");
    return safeCompare(derivedKey, digest);
  }

  const plainPassword = process.env.APP_ADMIN_PASSWORD?.trim();
  return plainPassword ? safeCompare(password, plainPassword) : false;
}

function sanitizeNextPath(nextPath: string | null | undefined) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/";
  }

  return nextPath;
}

async function shouldUseSecureSessionCookie() {
  const headerStore = await headers();
  const forwardedProto = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = headerStore.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headerStore.get("host")?.split(",")[0]?.trim() || "";
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);

  if (forwardedProto) {
    return forwardedProto === "https";
  }

  return process.env.NODE_ENV === "production" && !isLocalHost;
}

function unauthorizedMessage() {
  if (!isAuthConfigured()) {
    return "Authentication is not configured. Set APP_ADMIN_EMAIL, APP_ADMIN_PASSWORD or APP_ADMIN_PASSWORD_HASH, and Supabase environment variables.";
  }

  return "Authentication required.";
}

export function isAuthConfigured() {
  return Boolean(getProposalSecret() && getAdminEmail() && isSupabaseConfigured());
}

export function getAuthConfigurationError() {
  const missingMessages = [];

  if (!getAdminEmail()) {
    missingMessages.push("APP_ADMIN_EMAIL");
  }

  if (!process.env.APP_ADMIN_PASSWORD?.trim() && !process.env.APP_ADMIN_PASSWORD_HASH?.trim()) {
    missingMessages.push("APP_ADMIN_PASSWORD or APP_ADMIN_PASSWORD_HASH");
  }

  const supabaseError = getSupabaseConfigurationError();

  if (supabaseError) {
    missingMessages.push(supabaseError.replace("Supabase storage is not configured. Add ", ""));
  }

  if (missingMessages.length === 0) {
    return "";
  }

  return `Authentication is not configured. Add ${missingMessages.join(", ")}. APP_SESSION_SECRET is optional but recommended.`;
}

export function createLoginRedirect(nextPath?: string | null, errorCode?: string) {
  const target = new URL("/login", "http://localhost");
  const safeNextPath = sanitizeNextPath(nextPath);

  if (safeNextPath !== "/") {
    target.searchParams.set("next", safeNextPath);
  }

  if (errorCode) {
    target.searchParams.set("error", errorCode);
  }

  return target.pathname + target.search;
}

export async function getSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionId) {
    return null;
  }

  try {
    const session = await getSessionById(sessionId);
    return session ? { email: session.email, id: session.id } : null;
  } catch (error) {
    console.error("[auth] Failed to restore session", {
      error: error instanceof Error ? error.message : "Unknown session restore error.",
    });
    return null;
  }
}

export async function requireApiSession() {
  const session = await getSession();

  if (session) {
    return { session, response: null as NextResponse | null };
  }

  return {
    session: null,
    response: NextResponse.json(
      { error: unauthorizedMessage() },
      { status: isAuthConfigured() ? 401 : 500 },
    ),
  };
}

export function verifyLogin(
  input: LoginInput,
): { ok: true; email: string } | { ok: false; error: string } {
  if (!isAuthConfigured()) {
    return {
      ok: false,
      error: getAuthConfigurationError(),
    };
  }

  const email = input.email.trim().toLowerCase();
  const expectedEmail = getAdminEmail();

  if (!safeCompare(email, expectedEmail) || !verifyAdminPassword(input.password)) {
    return {
      ok: false,
      error: "Invalid email or password.",
    };
  }

  return {
    ok: true,
    email,
  };
}

export async function applySessionCookie(response: NextResponse, email: string) {
  const session = await createSession(email);
  const secure = await shouldUseSecureSessionCookie();

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: session.id,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}

export async function clearSessionCookie(response: NextResponse) {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (sessionId) {
      await deleteSession(sessionId);
    }
  } catch (error) {
    console.warn("[auth] Session cleanup during logout failed", {
      error: error instanceof Error ? error.message : "Unknown logout cleanup error.",
    });
  }

  const secure = await shouldUseSecureSessionCookie();

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: new Date(0),
  });

  return response;
}

export function parseNextPath(rawValue: string | null | undefined) {
  return sanitizeNextPath(rawValue);
}
