"use client";

import { useRef, type ChangeEvent } from "react";
import { PHOTO_UPLOAD_ACCEPT } from "@/lib/media-types";

type MediaKind = "photo" | "video";

type CameraCaptureProps = {
  disabled?: boolean;
  isUploading?: boolean;
  onSelectFiles: (files: File[], kind: MediaKind) => Promise<void> | void;
};

export default function CameraCapture({
  disabled = false,
  isUploading = false,
  onSelectFiles,
}: CameraCaptureProps) {
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFiles(
    event: ChangeEvent<HTMLInputElement>,
    kind: MediaKind,
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    await onSelectFiles(files, kind);
  }

  return (
    <section className="panel data-grid overflow-hidden rounded-[32px] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Secondary Attachments</p>
          <h2 className="mt-2 text-xl font-semibold">General files</h2>
        </div>
        <div className="rounded-full border border-black/10 bg-white/70 px-3 py-1 font-mono text-[11px] tracking-[0.16em] text-[#745e51]">
          OPTIONAL
        </div>
      </div>

      <p className="mt-4 text-sm leading-7 text-[#574a41]">
        Use the Walkthrough section capture for estimating. Add reference photos
        or short videos here only when they do not belong to a specific area.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={disabled || isUploading}
          onClick={() => photoInputRef.current?.click()}
          className="rounded-[22px] border border-black/10 bg-white px-4 py-4 text-left text-sm font-medium transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="block text-[#2b2420]">Add general photos</span>
          <span className="mt-1 block text-xs font-normal leading-6 text-[#6d5a50]">
            Optional references outside the section workflow.
          </span>
        </button>

        <button
          type="button"
          disabled={disabled || isUploading}
          onClick={() => videoInputRef.current?.click()}
          className="rounded-[22px] border border-black/10 bg-white px-4 py-4 text-left text-sm font-medium transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="block text-[#2b2420]">Add reference videos</span>
          <span className="mt-1 block text-xs font-normal leading-6 text-[#6d5a50]">
            For short supporting clips, not the primary estimating path.
          </span>
        </button>
      </div>

      <input
        ref={photoInputRef}
        type="file"
        accept={PHOTO_UPLOAD_ACCEPT}
        multiple
        onChange={(event) => handleFiles(event, "photo")}
        className="hidden"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        multiple
        onChange={(event) => handleFiles(event, "video")}
        className="hidden"
      />

      {disabled ? (
        <div className="mt-4 rounded-[22px] border border-amber-900/12 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Save or select an intake session before attaching media.
        </div>
      ) : null}
    </section>
  );
}
