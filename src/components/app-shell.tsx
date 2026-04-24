"use client";

import Link from "next/link";
import { startTransition, useState } from "react";
import CameraCapture from "@/components/camera-capture";
import PwaRegister from "@/components/pwa-register";
import {
  PROJECT_SUBTYPE_TEMPLATES,
  PROJECT_TYPE_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
} from "@/lib/project-templates";
import type {
  DashboardData,
  NotificationType,
  ProjectIntakeInput,
  ProjectRecord,
  ProposalStyle,
} from "@/lib/types";
import { formatCurrency, formatPercent, slugify } from "@/lib/utils";

type AppShellProps = {
  initialData: DashboardData;
  initialSelectedProjectId?: string;
};

const proposalStyles: ProposalStyle[] = ["hcp", "premium"];

function badgeClasses(status: string) {
  switch (status) {
    case "synced":
      return "bg-emerald-50 text-emerald-800 border-emerald-900/10";
    case "matched_duplicate":
      return "bg-amber-50 text-amber-900 border-amber-900/10";
    case "failed":
    case "review_required":
      return "bg-rose-50 text-rose-900 border-rose-900/10";
    default:
      return "bg-white/70 text-[#6a5648] border-black/8";
  }
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function workflowStatusLabel(project: ProjectRecord | undefined) {
  if (!project) {
    return "No project selected";
  }

  if (project.proposalWorkflow.customerSignature) {
    return "signed";
  }

  if (project.proposalWorkflow.customerSentAt) {
    return "signature pending";
  }

  if (project.proposalWorkflow.ownerApprovedAt) {
    return "approved";
  }

  return "pending owner approval";
}

function notificationBadgeClasses(status: string) {
  switch (status) {
    case "sent":
      return "bg-emerald-50 text-emerald-800 border-emerald-900/10";
    case "failed":
      return "bg-rose-50 text-rose-900 border-rose-900/10";
    case "queued":
      return "bg-amber-50 text-amber-900 border-amber-900/10";
    default:
      return "bg-white/70 text-[#6a5648] border-black/8";
  }
}

function getNotificationEntry(project: ProjectRecord | undefined, type: NotificationType) {
  if (!project) {
    return undefined;
  }

  return type === "owner_approval"
    ? project.ownerApprovalStatus
    : project.customerSendStatus;
}

export default function AppShell({
  initialData,
  initialSelectedProjectId,
}: AppShellProps) {
  const [dashboard, setDashboard] = useState(initialData);
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialSelectedProjectId &&
      initialData.projects.some((project) => project.id === initialSelectedProjectId)
      ? initialSelectedProjectId
      : initialData.projects[0]?.id ?? "",
  );
  const [activeStyle, setActiveStyle] = useState<ProposalStyle>("hcp");
  const [capturePreviewUrl, setCapturePreviewUrl] = useState("");
  const [copyState, setCopyState] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSendingProposal, setIsSendingProposal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [formState, setFormState] = useState({
    customerName: "",
    email: "",
    phone: "",
    address: "",
    propertyType: PROPERTY_TYPE_OPTIONS[0].value,
    projectType: PROJECT_TYPE_OPTIONS[0].value,
    projectSubtype: PROJECT_SUBTYPE_TEMPLATES[0].value,
    scopeDescription: "",
    notes: "",
    blueprintIncluded: false,
  });

  const selectedProject =
    dashboard.projects.find((project) => project.id === selectedProjectId) ??
    dashboard.projects[0];
  const selectedProposal =
    selectedProject?.proposalVariants.find((variant) => variant.style === activeStyle) ??
    selectedProject?.proposalVariants[0];
  const ownerApprovalStatus = getNotificationEntry(selectedProject, "owner_approval");
  const customerSendStatus = getNotificationEntry(selectedProject, "customer_send");
  const shouldShowOwnerResend = ownerApprovalStatus?.status === "failed";
  const shouldShowCustomerResend = customerSendStatus?.status === "failed";

  function redirectToLogin() {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }

  async function parseApiResponse<TPayload>(
    response: Response,
  ): Promise<{ payload: TPayload; ok: true } | { error: string; ok: false }> {
    const payload = (await response.json().catch(() => ({}))) as TPayload & {
      error?: string;
    };

    if (response.status === 401) {
      redirectToLogin();
      return { error: "Your session expired. Sign in again.", ok: false };
    }

    if (!response.ok) {
      return {
        error: payload.error ?? "Request failed.",
        ok: false,
      };
    }

    return {
      payload,
      ok: true,
    };
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAnalyzing(true);
    setUploadMessage("");

    const intake: ProjectIntakeInput = {
      id: `project-${slugify(formState.customerName || "new-project")}-${Date.now()}`,
      title:
        formState.scopeDescription.split(".")[0]?.slice(0, 72) ||
        "New electrical walkthrough",
      customer: {
        name: formState.customerName || "New customer",
        email: formState.email,
        phone: formState.phone,
        address: formState.address || "Site address pending",
      },
      propertyType: formState.propertyType,
      projectType: formState.projectType,
      projectSubtype: formState.projectSubtype,
      scopeDescription: formState.scopeDescription,
      blueprintIncluded: formState.blueprintIncluded,
      notes: formState.notes ? [formState.notes] : [],
      requestedActions: [],
      transcriptSegments: [
        {
          id: `${Date.now()}-transcript`,
          speaker: "Estimator",
          timestamp: "00:00",
          text:
            formState.scopeDescription ||
            "Quick walkthrough pending. Capture video or add voice notes to improve takeoff confidence.",
        },
      ],
      attachments: [
        {
          id: `${Date.now()}-video`,
          kind: "video",
          name: "Walkthrough pending",
          sizeLabel: "Not captured yet",
          uploadStatus: "queued",
          progress: 0,
        },
      ],
    };

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(intake),
      });
      const parsed = await parseApiResponse<ProjectRecord>(response);

      if (!parsed.ok) {
        setUploadMessage(parsed.error);
        return;
      }

      const createdProject = parsed.payload;

      startTransition(() => {
        setDashboard((current) => ({
          ...current,
          projects: [
            createdProject,
            ...current.projects.filter((project) => project.id !== createdProject.id),
          ],
        }));
        setSelectedProjectId(createdProject.id);
        setFormState({
          customerName: "",
          email: "",
          phone: "",
          address: "",
          propertyType: PROPERTY_TYPE_OPTIONS[0].value,
          projectType: PROJECT_TYPE_OPTIONS[0].value,
          projectSubtype: PROJECT_SUBTYPE_TEMPLATES[0].value,
          scopeDescription: "",
          notes: "",
          blueprintIncluded: false,
        });
      });
      setUploadMessage("Project created and secured in the workspace.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function mergeProject(updatedProject: ProjectRecord) {
    startTransition(() => {
      setDashboard((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === updatedProject.id ? updatedProject : project,
        ),
      }));
    });
  }

  async function uploadAttachment(
    file: File,
    kind: "video" | "blueprint" | "photo" | "note",
  ) {
    if (!selectedProject) {
      return;
    }

    setIsUploading(true);
    setUploadMessage("");

    try {
      const formData = new FormData();
      formData.append("projectId", selectedProject.id);
      formData.append("kind", kind);
      formData.append("file", file);

      const response = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });
      const parsed = await parseApiResponse<{
        project?: ProjectRecord;
        error?: string;
      }>(response);

      if (!parsed.ok || !parsed.payload.project) {
        setUploadMessage(parsed.ok ? "Upload failed." : parsed.error);
        return;
      }

      mergeProject(parsed.payload.project);
      setUploadMessage(
        kind === "video"
          ? "Walkthrough uploaded to private project storage."
          : `${kind.replaceAll("_", " ")} uploaded to private project storage.`,
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function attachCapture(artifact: {
    file: File;
    name: string;
    sizeLabel: string;
    previewUrl: string;
  }) {
    setCapturePreviewUrl(artifact.previewUrl);
    await uploadAttachment(artifact.file, "video");
  }

  async function sendProposal(force = false) {
    if (!selectedProject) {
      return;
    }

    setIsSendingProposal(true);
    setUploadMessage("");

    try {
      const response = await fetch("/api/proposals/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: selectedProject.id,
          proposalStyle: activeStyle,
          force,
        }),
      });
      const parsed = await parseApiResponse<{
        project?: ProjectRecord;
        message?: string;
      }>(response);

      if (!parsed.ok || !parsed.payload.project) {
        setUploadMessage(parsed.ok ? parsed.payload.message ?? "Proposal send failed." : parsed.error);
        return;
      }

      mergeProject(parsed.payload.project);
      setUploadMessage(
        parsed.payload.message ?? "Customer delivery was queued from the workspace.",
      );
    } finally {
      setIsSendingProposal(false);
    }
  }

  async function resendNotification(type: NotificationType, manualOverride = false) {
    if (!selectedProject) {
      return;
    }

    setIsSendingProposal(true);
    setUploadMessage("");

    try {
      const response = await fetch("/api/notifications/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: selectedProject.id,
          type,
          manualOverride,
        }),
      });
      const parsed = await parseApiResponse<{
        project?: ProjectRecord;
        message?: string;
      }>(response);

      if (!parsed.ok || !parsed.payload.project) {
        setUploadMessage(
          parsed.ok ? parsed.payload.message ?? "Notification resend failed." : parsed.error,
        );
        return;
      }

      mergeProject(parsed.payload.project);
      setUploadMessage(
        parsed.payload.message ?? "Notification was resent for this project.",
      );
    } finally {
      setIsSendingProposal(false);
    }
  }

  async function copyShareLink() {
    if (!selectedProposal || !selectedProject) {
      return;
    }

    const shareUrl = new URL(selectedProposal.sharePath, window.location.origin).toString();
    await navigator.clipboard.writeText(shareUrl);
    setCopyState("Share link copied");

    window.setTimeout(() => {
      setCopyState("");
    }, 1800);
  }

  async function uploadSupplementalFile(
    event: React.ChangeEvent<HTMLInputElement>,
    kind: "blueprint" | "photo" | "note",
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    await uploadAttachment(file, kind);
    event.target.value = "";
  }

  return (
    <div className="min-h-screen pb-10">
      <PwaRegister />

      <header className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <div className="panel overflow-hidden rounded-[36px] border-black/8 p-6 sm:p-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="eyebrow">Electrical Estimating Workspace</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-[#1f1a17] sm:text-5xl">
                Walk the job once. Review the estimate before it leaves your office.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-8 text-[#5d5047] sm:text-base">
                This MVP turns walkthrough video, voiceover, blueprints, and customer
                notes into a reviewable estimate draft, proposal variants, and owner
                review plus direct email and text delivery with manual HCP handoff support.
              </p>
              <form className="mt-5" action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  className="rounded-full border border-black/10 bg-white/75 px-4 py-2 text-sm font-medium text-[#5d5047] transition hover:border-black/20"
                >
                  Sign out
                </button>
              </form>
            </div>

            <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-[30rem]">
              {dashboard.stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-[28px] border border-black/8 bg-white/70 px-5 py-4"
                >
                  <p className="font-mono text-[11px] tracking-[0.18em] text-[#7a6558]">
                    {stat.label.toUpperCase()}
                  </p>
                  <p className="mt-3 text-2xl font-semibold">{stat.value}</p>
                  <p className="mt-1 text-sm text-[#64564c]">{stat.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-6 grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:px-8">
        <aside className="space-y-6">
          <section className="panel rounded-[32px] p-5">
            <p className="eyebrow">Demo Jobs</p>
            <div className="mt-4 space-y-3">
              {dashboard.projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    startTransition(() => {
                      setSelectedProjectId(project.id);
                    });
                  }}
                  className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                    project.id === selectedProject?.id
                      ? "border-[#d96a28]/40 bg-[#fff2e8] shadow-[0_10px_24px_rgba(217,106,40,0.12)]"
                      : "border-black/8 bg-white/68 hover:border-black/16"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#2b2420]">{project.customer.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[#7a6558]">
                        {project.projectType} • {project.projectSubtype.replaceAll("_", " ")}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em]">
                        <span
                          className={`rounded-full border px-2.5 py-1 ${notificationBadgeClasses(project.ownerApprovalStatus.status)}`}
                        >
                          Owner {statusLabel(project.ownerApprovalStatus.status)}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 ${notificationBadgeClasses(project.customerSendStatus.status)}`}
                        >
                          Customer {statusLabel(project.customerSendStatus.status)}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${badgeClasses(project.estimateDraft.reviewStatus)}`}
                    >
                      {statusLabel(project.estimateDraft.reviewStatus)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[#5d5047]">{project.title}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="panel rounded-[32px] p-5">
            <p className="eyebrow">Live Price Book</p>
            <div className="mt-4 space-y-3">
              {dashboard.priceBookPreview.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[22px] border border-black/8 bg-white/70 px-4 py-3"
                >
                  <p className="font-medium text-[#2b2420]">{item.name}</p>
                  <p className="mt-1 text-xs leading-6 text-[#6d5a50]">{item.category}</p>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-[#6d5a50]">{item.sourceLabel}</span>
                    <span className="font-semibold">{formatCurrency(item.price)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel-dark rounded-[32px] p-5">
            <p className="eyebrow text-[#f1c8ad]">Roadmap Alignment</p>
            <ul className="mt-4 space-y-4 text-sm leading-7 text-[#f5e5d8]">
              <li>Web-first PWA handles intake, capture, review, owner alerts, and customer signature.</li>
              <li>Native iPhone app later becomes the best-in-class capture specialist.</li>
              <li>Manual HCP upload, supply-house email, and dispatch stay queued after approval.</li>
            </ul>
          </section>
        </aside>

        <div className="space-y-6">
          <section className="panel overflow-hidden rounded-[32px] p-5 sm:p-6">
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <div>
                <p className="eyebrow">Quick Intake</p>
                <h2 className="mt-2 text-2xl font-semibold">Spin up a fresh walkthrough</h2>
                <p className="mt-3 text-sm leading-7 text-[#5d5047]">
                  Capture just enough structure before walking the site, then let the
                  AI draft the materials, labor, and scope for review.
                </p>

                <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={createProject}>
                  <label className="text-sm">
                    <span className="mb-2 block text-[#69584c]">Customer name</span>
                    <input
                      required
                      value={formState.customerName}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          customerName: event.target.value,
                        }))
                      }
                      className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-2 block text-[#69584c]">Email</span>
                    <input
                      type="email"
                      value={formState.email}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-2 block text-[#69584c]">Phone</span>
                    <input
                      value={formState.phone}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                      className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-2 block text-[#69584c]">Address</span>
                    <input
                      value={formState.address}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          address: event.target.value,
                        }))
                      }
                      className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-2 block text-[#69584c]">Property type</span>
                    <select
                      value={formState.propertyType}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          propertyType: event.target.value as typeof current.propertyType,
                        }))
                      }
                      className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                    >
                      {PROPERTY_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-2 block text-[#69584c]">Project type</span>
                    <select
                      value={formState.projectType}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          projectType: event.target.value as typeof current.projectType,
                        }))
                      }
                      className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                    >
                      {PROJECT_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm md:col-span-2">
                    <span className="mb-2 block text-[#69584c]">Project subtype</span>
                    <select
                      value={formState.projectSubtype}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          projectSubtype: event.target.value as typeof current.projectSubtype,
                        }))
                      }
                      className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                    >
                      {PROJECT_SUBTYPE_TEMPLATES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} — {option.description}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm md:col-span-2">
                    <span className="mb-2 block text-[#69584c]">General scope</span>
                    <textarea
                      required
                      rows={3}
                      value={formState.scopeDescription}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          scopeDescription: event.target.value,
                        }))
                      }
                      className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                    />
                  </label>
                  <label className="text-sm md:col-span-2">
                    <span className="mb-2 block text-[#69584c]">Customer notes</span>
                    <textarea
                      rows={2}
                      value={formState.notes}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                    />
                  </label>

                  <label className="md:col-span-2 flex items-center gap-3 rounded-[18px] border border-black/8 bg-[#faf4ee] px-4 py-3 text-sm text-[#5d5047]">
                    <input
                      type="checkbox"
                      checked={formState.blueprintIncluded}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          blueprintIncluded: event.target.checked,
                        }))
                      }
                    />
                    Blueprint available for upload and review
                  </label>

                  <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={isAnalyzing}
                      className="rounded-full bg-[#1f1a17] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#372d29] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isAnalyzing ? "Building estimate draft..." : "Create estimate draft"}
                    </button>
                    <span className="text-sm text-[#6d5a50]">
                      New projects are stored in the protected workspace database so proposal links keep working.
                    </span>
                  </div>
                </form>
              </div>

              <div className="rounded-[30px] border border-black/8 bg-[#fff9f3] p-5">
                <p className="eyebrow">Selected Job</p>
                {selectedProject ? (
                  <>
                    <h2 className="mt-2 text-2xl font-semibold">{selectedProject.title}</h2>
                    <p className="mt-3 text-sm leading-7 text-[#5f5148]">
                      {selectedProject.scopeDescription}
                    </p>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[22px] border border-black/8 bg-white/75 p-4">
                        <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                          CUSTOMER
                        </p>
                        <p className="mt-2 font-semibold">{selectedProject.customer.name}</p>
                        <p className="mt-1 text-sm text-[#6d5a50]">
                          {selectedProject.customer.address}
                        </p>
                      </div>
                      <div className="rounded-[22px] border border-black/8 bg-white/75 p-4">
                        <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                          CURRENT STATUS
                        </p>
                        <p className="mt-2 font-semibold">
                          {statusLabel(selectedProject.estimateDraft.reviewStatus)}
                        </p>
                        <p className="mt-1 text-sm text-[#6d5a50]">
                          {selectedProject.projectType} •{" "}
                          {selectedProject.projectSubtype.replaceAll("_", " ")}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 rounded-[24px] border border-black/8 bg-white/75 p-4">
                      <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                        ATTACHMENTS
                      </p>
                      <div className="mt-3 space-y-3">
                        {selectedProject.attachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="flex items-center justify-between gap-3 rounded-[18px] border border-black/6 bg-[#fbf8f3] px-4 py-3"
                          >
                            <div>
                              <p className="font-medium">{attachment.name}</p>
                              <p className="mt-1 text-xs text-[#6d5a50]">
                                {attachment.kind} • {attachment.sizeLabel}
                              </p>
                            </div>
                            <span
                              className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${badgeClasses(attachment.uploadStatus)}`}
                            >
                              {statusLabel(attachment.uploadStatus)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-5 rounded-[24px] border border-dashed border-black/10 bg-[#faf4ee] p-4">
                      <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                        PERSISTENT FILE UPLOADS
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <label className="rounded-[18px] border border-black/8 bg-white/80 px-3 py-3 text-sm text-[#5d5047]">
                          <span className="font-medium">Blueprint</span>
                          <input
                            type="file"
                            accept=".pdf,image/*"
                            onChange={(event) => uploadSupplementalFile(event, "blueprint")}
                            className="mt-2 block w-full text-xs"
                          />
                        </label>
                        <label className="rounded-[18px] border border-black/8 bg-white/80 px-3 py-3 text-sm text-[#5d5047]">
                          <span className="font-medium">Photo</span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(event) => uploadSupplementalFile(event, "photo")}
                            className="mt-2 block w-full text-xs"
                          />
                        </label>
                        <label className="rounded-[18px] border border-black/8 bg-white/80 px-3 py-3 text-sm text-[#5d5047]">
                          <span className="font-medium">Notes doc</span>
                          <input
                            type="file"
                            accept=".txt,.pdf,.doc,.docx"
                            onChange={(event) => uploadSupplementalFile(event, "note")}
                            className="mt-2 block w-full text-xs"
                          />
                        </label>
                      </div>
                      {uploadMessage ? (
                        <p className="mt-3 text-sm text-[#5d5047]">{uploadMessage}</p>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
            <CameraCapture onCapture={attachCapture} />

            <section className="panel overflow-hidden rounded-[32px] p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">AI Review</p>
                  <h2 className="mt-2 text-xl font-semibold">Transcript and capture prompts</h2>
                </div>
                <div className="rounded-full border border-black/8 bg-white/70 px-3 py-1 font-mono text-[11px] tracking-[0.16em] text-[#745e51]">
                  {selectedProject?.estimateDraft.lineItems.length ?? 0} LINE ITEMS
                </div>
              </div>

              {capturePreviewUrl ? (
                <div className="mt-4 rounded-[24px] border border-emerald-900/10 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  New walkthrough capture attached to private object storage for this job review session.
                </div>
              ) : null}

              <div className="mt-5 grid gap-4">
                <div className="rounded-[26px] border border-black/8 bg-white/70 p-4">
                  <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                    TRANSCRIPT
                  </p>
                  <div className="soft-scrollbar mt-3 max-h-[18rem] space-y-3 overflow-auto pr-2">
                    {selectedProject?.transcriptSegments.map((segment) => (
                      <div
                        key={segment.id}
                        className="rounded-[18px] border border-black/6 bg-[#fbf8f3] px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.14em] text-[#7a6558]">
                          <span>{segment.speaker}</span>
                          <span>{segment.timestamp}</span>
                        </div>
                        <p className="mt-2 text-sm leading-7 text-[#473c35]">
                          {segment.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[26px] border border-black/8 bg-white/70 p-4">
                  <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                    PROMPTS
                  </p>
                  <div className="mt-3 space-y-3">
                    {selectedProject?.capturePrompts.map((prompt) => (
                      <div
                        key={prompt.id}
                        className={`rounded-[18px] border px-4 py-3 text-sm ${
                          badgeClasses(
                            prompt.severity === "critical" ? "failed" : "matched_duplicate",
                          )
                        }`}
                      >
                        <p className="font-medium">{prompt.question}</p>
                        <p className="mt-1 leading-6">{prompt.context}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[26px] border border-black/8 bg-white/70 p-4">
                  <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                    ANALYSIS SUMMARY
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-[#54473f]">
                    {selectedProject?.analysisSummary.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          </div>

          <section className="grid gap-6 xl:grid-cols-[1.06fr_0.94fr]">
            <div className="panel rounded-[32px] p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Estimate Draft</p>
                  <h2 className="mt-2 text-xl font-semibold">By area + line items</h2>
                </div>
                <div className="rounded-full border border-black/8 bg-white/70 px-4 py-2 text-sm text-[#64564c]">
                  Avg confidence{" "}
                  {formatPercent(selectedProject?.estimateDraft.averageConfidence ?? 0)}
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {selectedProject?.estimateDraft.areaGroups.map((group) => (
                  <div
                    key={group.area}
                    className="rounded-[28px] border border-black/8 bg-white/70 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">{group.area}</h3>
                        <p className="mt-1 text-sm text-[#6d5a50]">
                          {group.lineItems.length} line items
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrency(group.subtotal)}</p>
                        <p className="mt-1 text-xs text-[#6d5a50]">
                          {group.totalLaborHours} labor hrs
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      {group.lineItems.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-[22px] border border-black/6 bg-[#fbf8f3] px-4 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="max-w-xl">
                              <p className="font-medium">{item.name}</p>
                              <p className="mt-1 text-sm leading-6 text-[#5d5047]">
                                {item.description}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold">{formatCurrency(item.sellPrice)}</p>
                              <p className="mt-1 text-xs text-[#6d5a50]">
                                {item.quantity}x • {item.laborHours} hrs
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${badgeClasses(item.status)}`}
                            >
                              {statusLabel(item.status)}
                            </span>
                            <span className="rounded-full border border-black/8 bg-white/70 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[#7a6558]">
                              {item.source.replaceAll("_", " ")}
                            </span>
                            <span className="rounded-full border border-black/8 bg-white/70 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[#7a6558]">
                              {formatPercent(item.confidence)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[22px] border border-black/8 bg-white/70 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#7a6558]">
                    Materials
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    {formatCurrency(selectedProject?.estimateDraft.materialTotal ?? 0)}
                  </p>
                </div>
                <div className="rounded-[22px] border border-black/8 bg-white/70 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#7a6558]">
                    Labor
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    {selectedProject?.estimateDraft.totalLaborHours ?? 0} hrs
                  </p>
                </div>
                <div className="rounded-[22px] border border-black/8 bg-white/70 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#7a6558]">
                    Total
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    {formatCurrency(selectedProject?.estimateDraft.grandTotal ?? 0)}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <section className="panel rounded-[32px] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="eyebrow">Proposal Studio</p>
                    <h2 className="mt-2 text-xl font-semibold">Owner approval and customer handoff</h2>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {proposalStyles.map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => setActiveStyle(style)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                        activeStyle === style
                          ? "bg-[#1f1a17] text-white"
                          : "border border-black/8 bg-white/75 text-[#5d5047]"
                      }`}
                    >
                      {style === "hcp" ? "HCP style" : "Premium style"}
                    </button>
                  ))}
                </div>

                {selectedProject && selectedProposal ? (
                  <div className="mt-5 rounded-[28px] border border-black/8 bg-[#fff9f3] p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold">{selectedProposal.title}</h3>
                        <p className="mt-2 text-sm leading-7 text-[#5d5047]">
                          {selectedProposal.intro}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${
                          selectedProposal.depositRequired
                            ? "border-amber-900/10 bg-amber-50 text-amber-900"
                            : "border-emerald-900/10 bg-emerald-50 text-emerald-900"
                        }`}
                      >
                        {selectedProposal.depositRequired
                          ? `Deposit ${formatCurrency(selectedProposal.depositAmount)}`
                          : "No deposit"}
                      </span>
                    </div>

                    <ul className="mt-4 space-y-2 text-sm leading-7 text-[#4e423b]">
                      {selectedProposal.bulletHighlights.map((highlight) => (
                        <li key={highlight}>{highlight}</li>
                      ))}
                    </ul>

                    <div className="mt-4 rounded-[20px] border border-black/8 bg-white/75 px-4 py-3 text-sm text-[#574a41]">
                      Proposal workflow:{" "}
                      <strong>
                        {workflowStatusLabel(selectedProject)}
                      </strong>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[20px] border border-black/8 bg-white/75 px-4 py-3 text-sm text-[#574a41]">
                        <div className="flex items-center justify-between gap-3">
                          <span>Owner approval request</span>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${notificationBadgeClasses(ownerApprovalStatus?.status ?? "ready")}`}
                          >
                            {statusLabel(ownerApprovalStatus?.status ?? "ready")}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-6 text-[#6d5a50]">
                          {ownerApprovalStatus?.message}
                        </p>
                      </div>
                      <div className="rounded-[20px] border border-black/8 bg-white/75 px-4 py-3 text-sm text-[#574a41]">
                        <div className="flex items-center justify-between gap-3">
                          <span>Customer send</span>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${notificationBadgeClasses(customerSendStatus?.status ?? "ready")}`}
                          >
                            {statusLabel(customerSendStatus?.status ?? "ready")}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-6 text-[#6d5a50]">
                          {customerSendStatus?.message}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={copyShareLink}
                        className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium transition hover:border-black/20"
                      >
                        Copy share link
                      </button>
                      <Link
                        href={selectedProposal.sharePath}
                        target="_blank"
                        className="rounded-full bg-[#d96a28] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#c65c1c]"
                      >
                        Open customer proposal
                      </Link>
                      <button
                        type="button"
                        onClick={() => sendProposal(false)}
                        disabled={
                          isSendingProposal ||
                          selectedProject.proposalWorkflow.status === "customer_approved" ||
                          customerSendStatus?.status === "queued" ||
                          customerSendStatus?.status === "sent"
                        }
                        className="rounded-full bg-[#1f1a17] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#372d29] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSendingProposal
                          ? "Sending delivery..."
                          : selectedProject.proposalWorkflow.status === "customer_approved"
                            ? "Customer already approved"
                            : customerSendStatus?.status === "queued" || customerSendStatus?.status === "sent"
                              ? "Customer delivery in progress"
                              : "Approve + send to customer"}
                      </button>
                      {shouldShowOwnerResend ? (
                        <button
                          type="button"
                          onClick={() => resendNotification("owner_approval")}
                          disabled={isSendingProposal}
                          className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-[#5d5047] transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Resend owner alerts
                        </button>
                      ) : null}
                      {shouldShowCustomerResend ? (
                        <button
                          type="button"
                          onClick={() => resendNotification("customer_send")}
                          disabled={isSendingProposal}
                          className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-[#5d5047] transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Resend failed customer delivery
                        </button>
                      ) : null}
                    </div>

                    {copyState ? (
                      <p className="mt-3 text-sm text-emerald-900">{copyState}</p>
                    ) : null}

                    {!selectedProject.customer.email || !selectedProject.customer.phone ? (
                      <p className="mt-3 text-sm text-amber-900">
                        Add both a customer email and a customer phone number before the owner can
                        complete customer delivery across both channels.
                      </p>
                    ) : null}

                    {selectedProject.proposalWorkflow.customerSignature ? (
                      <p className="mt-3 text-sm text-emerald-900">
                        Signed by {selectedProject.proposalWorkflow.customerSignature.signedByName} on{" "}
                        {new Date(
                          selectedProject.proposalWorkflow.customerSignature.signedAt,
                        ).toLocaleString()}
                        .
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="panel rounded-[32px] p-5 sm:p-6">
                <p className="eyebrow">Approval + Ops</p>
                <div className="mt-4 space-y-3">
                  {selectedProject?.integrationSyncs.map((sync) => (
                    <div
                      key={`${sync.system}-${sync.updatedAt}`}
                      className="rounded-[22px] border border-black/8 bg-white/70 px-4 py-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{sync.system.replaceAll("-", " ")}</p>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${badgeClasses(sync.status)}`}
                        >
                          {statusLabel(sync.status)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-7 text-[#5d5047]">{sync.message}</p>
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-sm leading-6 text-[#5d5047]">
                  Owner alerts and customer delivery now send directly through Resend and Twilio
                  from this workspace. The cards above reflect the stored delivery result for each
                  event, and the Housecall Pro step stays manual after customer approval.
                </p>

                <div className="mt-5 rounded-[24px] border border-black/8 bg-[#fff9f3] p-4">
                  <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                    NEXT OPS STEPS
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-[#574a41]">
                    {selectedProject?.opsNextSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>

                {isUploading ? (
                  <div className="mt-4 rounded-[20px] border border-amber-900/10 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Uploading file to persistent storage...
                  </div>
                ) : null}
              </section>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
