"use client";

import { useEffect, useRef, useState } from "react";

type CameraCaptureProps = {
  onCapture: (artifact: {
    file: File;
    name: string;
    sizeLabel: string;
    previewUrl: string;
  }) => Promise<void> | void;
};

function humanFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CameraCapture({ onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  async function ensurePreview() {
    if (streamRef.current) {
      return streamRef.current;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: true,
    });

    streamRef.current = stream;

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }

    return stream;
  }

  async function startPreview() {
    try {
      await ensurePreview();
      setError("");
      setIsPreviewing(true);
    } catch {
      setError(
        "Camera access was blocked. You can still use the fallback file capture below.",
      );
    }
  }

  async function startRecording() {
    try {
      const stream = await ensurePreview();
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const nextPreviewUrl = URL.createObjectURL(blob);
        const file = new File(
          [blob],
          `walkthrough-${new Date().toISOString().slice(0, 19)}.webm`,
          { type: recorder.mimeType || "video/webm" },
        );

        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }

        setPreviewUrl(nextPreviewUrl);
        onCapture({
          file,
          name: file.name,
          sizeLabel: humanFileSize(blob.size),
          previewUrl: nextPreviewUrl,
        });
      };

      recorder.start();
      setIsPreviewing(true);
      setIsRecording(true);
      setError("");
    } catch {
      setError(
        "Live recording is not available in this browser. Use the file capture input to attach the walkthrough.",
      );
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setIsRecording(false);
  }

  function attachFallbackVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(file);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setPreviewUrl(nextPreviewUrl);
    onCapture({
      file,
      name: file.name,
      sizeLabel: humanFileSize(file.size),
      previewUrl: nextPreviewUrl,
    });
  }

  return (
    <section className="panel data-grid overflow-hidden rounded-[32px] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Phone Capture</p>
          <h2 className="mt-2 text-xl font-semibold">Walkthrough video + voiceover</h2>
        </div>
        <div className="rounded-full border border-black/10 bg-white/70 px-3 py-1 font-mono text-[11px] tracking-[0.16em] text-[#745e51]">
          PWA READY
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="overflow-hidden rounded-[28px] bg-[#1f1a17]">
          <video
            ref={videoRef}
            muted
            playsInline
            className="aspect-[4/3] w-full object-cover"
            controls={Boolean(previewUrl)}
            src={previewUrl || undefined}
          />
        </div>

        <div className="space-y-4 rounded-[28px] border border-black/8 bg-white/65 p-4">
          <p className="text-sm leading-7 text-[#574a41]">
            Record while describing what should be added, replaced, rerouted, or
            measured. Commercial jobs can trigger measurement prompts later in the
            review flow.
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={startPreview}
              className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium transition hover:border-black/20"
            >
              {isPreviewing ? "Preview active" : "Start camera preview"}
            </button>
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              className="rounded-full bg-[#d96a28] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#c65c1c]"
            >
              {isRecording ? "Stop recording" : "Record walkthrough"}
            </button>
          </div>

          <label className="block rounded-[22px] border border-dashed border-black/14 bg-[#f8f2eb] px-4 py-4 text-sm text-[#5f5148]">
            <span className="font-medium">Fallback capture / upload</span>
            <span className="mt-1 block text-xs leading-6 text-[#7a675a]">
              Works on mobile browsers that prefer the native camera app.
            </span>
            <input
              type="file"
              accept="video/*"
              capture="environment"
              onChange={attachFallbackVideo}
              className="mt-3 block w-full text-sm"
            />
          </label>

          {previewUrl ? (
            <div className="rounded-[22px] border border-emerald-900/10 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Walkthrough attached. This session can now feed transcript, takeoff,
              and proposal generation.
            </div>
          ) : null}

          {error ? (
            <div className="rounded-[22px] border border-amber-900/12 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
