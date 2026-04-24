import "server-only";

import { randomUUID } from "node:crypto";
import { getSessionsTableName, getSupabaseAdmin, type AppSessionRow } from "@/lib/supabase-admin";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function sessionExpiresAt() {
  return new Date(Date.now() + SESSION_TTL_MS).toISOString();
}

function logSessionEvent(level: "info" | "warn" | "error", message: string, details?: object) {
  console[level]("[session-store] " + message, details ?? {});
}

async function deleteExpiredSessions() {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from(getSessionsTableName())
      .delete()
      .lt("expires_at", new Date().toISOString());

    if (error) {
      logSessionEvent("warn", "Expired session cleanup failed", {
        error: error.message,
      });
      return;
    }
  } catch (error) {
    logSessionEvent("warn", "Expired session cleanup threw unexpectedly", {
      error: error instanceof Error ? error.message : "Unknown cleanup error.",
    });
  }
}

export async function createSession(email: string) {
  await deleteExpiredSessions();

  const session = {
    id: randomUUID(),
    email,
    expires_at: sessionExpiresAt(),
  };
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from(getSessionsTableName()).insert(session);

  if (error) {
    logSessionEvent("error", "Session creation failed", {
      email,
      error: error.message,
    });
    throw new Error(`Failed to create session: ${error.message}`);
  }

  logSessionEvent("info", "Session created", {
    email,
    sessionId: session.id,
  });
  return session;
}

export async function getSessionById(sessionId: string) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(getSessionsTableName())
      .select("id, email, expires_at, created_at")
      .eq("id", sessionId)
      .maybeSingle<AppSessionRow>();

    if (error) {
      logSessionEvent("error", "Session lookup failed", {
        sessionId,
        error: error.message,
      });
      return null;
    }

    if (!data) {
      return null;
    }

    if (new Date(data.expires_at).getTime() <= Date.now()) {
      await deleteSession(sessionId);
      return null;
    }

    return data;
  } catch (error) {
    logSessionEvent("error", "Session lookup threw unexpectedly", {
      sessionId,
      error: error instanceof Error ? error.message : "Unknown lookup error.",
    });
    return null;
  }
}

export async function deleteSession(sessionId: string) {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from(getSessionsTableName()).delete().eq("id", sessionId);

    if (error) {
      logSessionEvent("warn", "Session deletion failed", {
        sessionId,
        error: error.message,
      });
    }
  } catch (error) {
    logSessionEvent("warn", "Session deletion threw unexpectedly", {
      sessionId,
      error: error instanceof Error ? error.message : "Unknown deletion error.",
    });
  }
}
