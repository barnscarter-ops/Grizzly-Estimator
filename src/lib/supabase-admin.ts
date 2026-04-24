import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];

export type AppProjectRow = {
  id: string;
  payload: JsonValue;
  created_at: string;
  updated_at: string;
};

export type AppSessionRow = {
  id: string;
  email: string;
  expires_at: string;
  created_at: string;
};

export const DEFAULT_PROJECTS_TABLE = "app_projects";
export const DEFAULT_SESSIONS_TABLE = "app_sessions";
export const DEFAULT_UPLOAD_BUCKET = "project-attachments";

export type ProjectsTableName = typeof DEFAULT_PROJECTS_TABLE;
export type SessionsTableName = typeof DEFAULT_SESSIONS_TABLE;

let cachedClient: SupabaseClient | null = null;

function readEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function getProjectsTableName() {
  return (readEnv("SUPABASE_PROJECTS_TABLE") || DEFAULT_PROJECTS_TABLE) as ProjectsTableName;
}

export function getSessionsTableName() {
  return (readEnv("SUPABASE_SESSIONS_TABLE") || DEFAULT_SESSIONS_TABLE) as SessionsTableName;
}

export function getUploadsBucketName() {
  return readEnv("SUPABASE_UPLOADS_BUCKET") || DEFAULT_UPLOAD_BUCKET;
}

export function getSupabaseConfigurationError() {
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter(
    (name) => !readEnv(name),
  );

  if (missing.length === 0) {
    return "";
  }

  return `Supabase backend is not configured. Add ${missing.join(" and ")}.`;
}

export function isSupabaseConfigured() {
  return !getSupabaseConfigurationError();
}

export function getSupabaseAdmin() {
  if (cachedClient) {
    return cachedClient;
  }

  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(getSupabaseConfigurationError());
  }

  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedClient;
}
