const IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const IMAGE_EXTENSIONS = new Set([
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
]);

const HEIC_EXTENSIONS = new Set([".heic", ".heif"]);

const OPENAI_VISION_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const OPENAI_VISION_EXTENSION_MIME_TYPES = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const GENERIC_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

export const PHOTO_UPLOAD_ACCEPT =
  "image/*,.heic,.heif,image/heic,image/heif,image/heic-sequence,image/heif-sequence";

export function normalizeContentType(contentType?: string) {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export function getFileExtension(fileName?: string) {
  const normalizedName = (fileName ?? "").trim().toLowerCase();
  const dotIndex = normalizedName.lastIndexOf(".");

  if (dotIndex < 0) {
    return "";
  }

  return normalizedName.slice(dotIndex);
}

export function isSupportedPhotoFile(input: {
  contentType?: string;
  fileName?: string;
}) {
  const contentType = normalizeContentType(input.contentType);
  const extension = getFileExtension(input.fileName);

  if (contentType.startsWith("image/") || IMAGE_MIME_TYPES.has(contentType)) {
    return true;
  }

  return GENERIC_MIME_TYPES.has(contentType) && IMAGE_EXTENSIONS.has(extension);
}

export function isHeicLikeFile(input: {
  contentType?: string;
  fileName?: string;
}) {
  return (
    HEIC_MIME_TYPES.has(normalizeContentType(input.contentType)) ||
    HEIC_EXTENSIONS.has(getFileExtension(input.fileName))
  );
}

export function getOpenAiVisionContentType(input: {
  contentType?: string;
  fileName?: string;
}) {
  const contentType = normalizeContentType(input.contentType);

  if (OPENAI_VISION_MIME_TYPES.has(contentType)) {
    return contentType;
  }

  if (!GENERIC_MIME_TYPES.has(contentType)) {
    return undefined;
  }

  return OPENAI_VISION_EXTENSION_MIME_TYPES.get(getFileExtension(input.fileName));
}
