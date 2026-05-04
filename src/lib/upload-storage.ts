import "server-only";

import { extname } from "node:path";
import { getSupabaseAdmin, getUploadsBucketName } from "@/lib/supabase-admin";
import { slugify } from "@/lib/utils";

export type StoredUpload = {
  storageKey: string;
  fileUrl: string;
  contentType: string;
  fileName: string;
  sizeBytes: number;
};

function sanitizeFileName(fileName: string) {
  const extension = extname(fileName);
  const stem = fileName.slice(0, Math.max(0, fileName.length - extension.length));
  const safeStem = slugify(stem || "upload");
  const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
  return `${safeStem || "upload"}${safeExtension}`;
}

export async function storeUpload(input: {
  projectId: string;
  kind: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}) {
  const safeFileName = sanitizeFileName(input.fileName);
  const storageKey = `${slugify(input.projectId)}/${Date.now()}-${input.kind}-${safeFileName}`;
  const supabase = getSupabaseAdmin();
  const bucket = getUploadsBucketName();
  const { error } = await supabase.storage.from(bucket).upload(storageKey, input.bytes, {
    contentType: input.contentType || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    throw new Error(`Failed to store upload ${input.fileName}: ${error.message}`);
  }

  return {
    storageKey,
    fileUrl: `/api/uploads/${storageKey}`,
    contentType: input.contentType || "application/octet-stream",
    fileName: input.fileName,
    sizeBytes: input.bytes.byteLength,
  } satisfies StoredUpload;
}

export async function readStoredUpload(storageKeySegments: string[]) {
  const storageKey = storageKeySegments.join("/");
  const supabase = getSupabaseAdmin();
  const bucket = getUploadsBucketName();
  const { data, error } = await supabase.storage.from(bucket).download(storageKey);

  if (error) {
    if (error.message.toLowerCase().includes("not found")) {
      return null;
    }

    throw new Error(`Failed to download upload ${storageKey}: ${error.message}`);
  }

  const file = Buffer.from(await data.arrayBuffer());
  return {
    file,
    storageKey,
    contentType: data.type || "application/octet-stream",
  };
}

export async function deleteStoredUpload(storageKey: string) {
  const supabase = getSupabaseAdmin();
  const bucket = getUploadsBucketName();
  const { error } = await supabase.storage.from(bucket).remove([storageKey]);

  if (error) {
    throw new Error(`Failed to delete upload ${storageKey}: ${error.message}`);
  }
}

export async function createSignedUploadAccessUrl(storageKey: string, expiresInSeconds = 3600) {
  const supabase = getSupabaseAdmin();
  const bucket = getUploadsBucketName();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storageKey, expiresInSeconds);

  if (error) {
    throw new Error(`Failed to sign upload URL ${storageKey}: ${error.message}`);
  }

  return data.signedUrl;
}
