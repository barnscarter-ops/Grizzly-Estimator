"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import CameraCapture from "@/components/camera-capture";
import PwaRegister from "@/components/pwa-register";
import {
  PROJECT_SUBTYPE_TEMPLATES,
  PROJECT_TYPE_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
} from "@/lib/project-templates";
import { PHOTO_UPLOAD_ACCEPT } from "@/lib/media-types";
import type {
  Attachment,
  DashboardData,
  DetectedWorkItem,
  NotificationType,
  ProjectIntakeInput,
  ProjectRecord,
  ProposalStyle,
  RouteMeasurement,
  Walkthrough,
  WalkthroughSection,
  WalkthroughSectionNoteMode,
} from "@/lib/types";
import { formatCurrency, formatPercent, slugify } from "@/lib/utils";

type AppShellProps = {
  initialData: DashboardData;
  initialSelectedProjectId?: string;
};

type IntakeFormState = {
  customerName: string;
  email: string;
  phone: string;
  address: string;
  propertyType: ProjectIntakeInput["propertyType"];
  projectType: ProjectIntakeInput["projectType"];
  projectSubtype: ProjectIntakeInput["projectSubtype"];
  scopeDescription: string;
  notes: string;
  blueprintIncluded: boolean;
};

type UploadQueueItem = {
  id: string;
  name: string;
  kind: Attachment["kind"];
  progress: number;
  status: "uploading" | "complete" | "failed";
  error?: string;
};

type CapturePhase =
  | "idle"
  | "note_mode"
  | "section"
  | "next_prompt"
  | "route"
  | "done";

type SectionCaptureFormState = {
  areaName: string;
  noteMode: WalkthroughSectionNoteMode;
  typedNote: string;
  transcript: string;
};

type RouteMeasurementFormState = {
  sourceLocation: string;
  destinationSectionId: string;
  destinationDescription: string;
  measuredDistanceFt: string;
  notes: string;
};

type DetectedWorkItemReviewGroup = {
  id: string;
  name: string;
  noteText?: string;
  photos: Attachment[];
  items: DetectedWorkItem[];
};

const proposalStyles: ProposalStyle[] = ["hcp", "premium"];
const intakeDraftStorageKey = "grizzly-estimator:intake-draft";

function emptySectionCaptureForm(
  noteMode: WalkthroughSectionNoteMode = "text",
): SectionCaptureFormState {
  return {
    areaName: "",
    noteMode,
    typedNote: "",
    transcript: "",
  };
}

function emptyRouteMeasurementForm(): RouteMeasurementFormState {
  return {
    sourceLocation: "",
    destinationSectionId: "",
    destinationDescription: "",
    measuredDistanceFt: "",
    notes: "",
  };
}

function sectionDisplayName(section: WalkthroughSection) {
  return section.areaName || section.name || "Walkthrough section";
}

function sectionNoteText(section: WalkthroughSection) {
  return (section.typedNote?.trim() || section.transcript?.trim() || "").trim();
}

function buildDetectedWorkItemReviewGroups(
  project: ProjectRecord,
): DetectedWorkItemReviewGroup[] {
  const detectedItems = project.detectedWorkItems ?? [];
  const groups: DetectedWorkItemReviewGroup[] = [];

  [...(project.walkthroughSections ?? [])]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .forEach((section) => {
      const sectionItems = detectedItems.filter((item) => item.sectionId === section.id);

      if (sectionItems.length === 0) {
        return;
      }

      groups.push({
        id: section.id,
        name: sectionDisplayName(section),
        noteText: sectionNoteText(section) || undefined,
        photos: project.attachments.filter((attachment) =>
          section.photoAttachmentIds.includes(attachment.id),
        ),
        items: sectionItems,
      });
    });

  const groupedSectionIds = new Set(groups.map((group) => group.id));
  const generalItems = detectedItems.filter(
    (item) => !item.sectionId || !groupedSectionIds.has(item.sectionId),
  );

  if (generalItems.length > 0) {
    groups.push({
      id: "general-intake",
      name: "General intake",
      noteText: project.scopeDescription || project.notes.join("\n"),
      photos: project.attachments.filter(
        (attachment) => attachment.kind === "photo" || attachment.kind === "video",
      ),
      items: generalItems,
    });
  }

  return groups;
}

function emptyFormState(): IntakeFormState {
  return {
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
  };
}

function formStateFromProject(project: ProjectRecord): IntakeFormState {
  return {
    customerName: project.customer.name,
    email: project.customer.email ?? "",
    phone: project.customer.phone ?? "",
    address: project.customer.address,
    propertyType: project.propertyType,
    projectType: project.projectType,
    projectSubtype: project.projectSubtype,
    scopeDescription: project.scopeDescription,
    notes: project.notes.join("\n"),
    blueprintIncluded: project.blueprintIncluded,
  };
}

function buildIntakeInput(
  formState: IntakeFormState,
  existingProject?: ProjectRecord,
): ProjectIntakeInput {
  const projectId =
    existingProject?.id ??
    `intake-${slugify(formState.customerName || "new-intake")}-${Date.now()}`;
  const notes = formState.notes.trim() ? [formState.notes.trim()] : [];
  const transcriptText = [formState.scopeDescription.trim(), ...notes]
    .filter(Boolean)
    .join("\n\n");

  return {
    id: projectId,
    title:
      formState.scopeDescription.trim().split(".")[0]?.slice(0, 72) ||
      `${formState.customerName || "New customer"} intake`,
    customer: {
      name: formState.customerName.trim() || "New customer",
      email: formState.email.trim() || undefined,
      phone: formState.phone.trim() || undefined,
      address: formState.address.trim() || "Site address pending",
    },
    propertyType: formState.propertyType,
    projectType: formState.projectType,
    projectSubtype: formState.projectSubtype,
    scopeDescription: formState.scopeDescription.trim(),
    blueprintIncluded: formState.blueprintIncluded,
    notes,
    requestedActions: existingProject?.requestedActions ?? [],
    attachments: existingProject?.attachments ?? [],
    transcriptSegments: transcriptText
      ? [
          {
            id: `${projectId}-typed-notes`,
            speaker: "Estimator",
            timestamp: "00:00",
            text: transcriptText,
          },
        ]
      : [],
  };
}

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

function attachmentKindLabel(kind: Attachment["kind"]) {
  switch (kind) {
    case "section_photo":
      return "Section photo";
    case "section_audio_note":
      return "Section audio note";
    case "general_attachment":
      return "Attachment";
    case "photo":
      return "Photo";
    case "video":
      return "Video";
    case "blueprint":
      return "Blueprint";
    case "note":
      return "Note";
    default:
      return "Attachment";
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
      : "",
  );
  const [activeStyle, setActiveStyle] = useState<ProposalStyle>("hcp");
  const [copyState, setCopyState] = useState("");
  const [isSavingIntake, setIsSavingIntake] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSendingProposal, setIsSendingProposal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [formState, setFormState] = useState<IntakeFormState>(emptyFormState);
  const [capturePhase, setCapturePhase] = useState<CapturePhase>("idle");
  const [currentWalkthroughId, setCurrentWalkthroughId] = useState("");
  const [isSavingWalkthrough, setIsSavingWalkthrough] = useState(false);
  const [walkthroughMessage, setWalkthroughMessage] = useState("");
  const [sectionForm, setSectionForm] = useState<SectionCaptureFormState>(
    emptySectionCaptureForm(),
  );
  const [pendingSectionPhotos, setPendingSectionPhotos] = useState<File[]>([]);
  const [pendingAudioNote, setPendingAudioNote] = useState<File | undefined>();
  const [routeForm, setRouteForm] = useState<RouteMeasurementFormState>(
    emptyRouteMeasurementForm,
  );

  const selectedProject = dashboard.projects.find(
    (project) => project.id === selectedProjectId,
  );
  const selectedProposal =
    selectedProject?.proposalVariants.find((variant) => variant.style === activeStyle) ??
    selectedProject?.proposalVariants[0];
  const ownerApprovalStatus = getNotificationEntry(selectedProject, "owner_approval");
  const customerSendStatus = getNotificationEntry(selectedProject, "customer_send");
  const shouldShowOwnerResend = Boolean(ownerApprovalStatus);
  const shouldShowCustomerResend =
    customerSendStatus?.status === "failed" || customerSendStatus?.status === "queued";
  const activeWalkthrough =
    selectedProject?.walkthroughs?.find(
      (walkthrough) => walkthrough.id === currentWalkthroughId,
    ) ?? selectedProject?.walkthroughs?.[0];
  const activeWalkthroughSections =
    selectedProject?.walkthroughSections
      ?.filter((section) => section.walkthroughId === activeWalkthrough?.id)
      .sort((left, right) => left.sortOrder - right.sortOrder) ?? [];
  const activeRouteMeasurements =
    selectedProject?.routeMeasurements?.filter(
      (measurement) => measurement.walkthroughId === activeWalkthrough?.id,
    ) ?? [];
  const detectedWorkItemReviewGroups = selectedProject
    ? buildDetectedWorkItemReviewGroups(selectedProject)
    : [];

  useEffect(() => {
    if (selectedProject) {
      return;
    }

    const restoreDraft = window.setTimeout(() => {
      const savedDraft = window.localStorage.getItem(intakeDraftStorageKey);

      if (!savedDraft) {
        return;
      }

      try {
        setFormState({
          ...emptyFormState(),
          ...(JSON.parse(savedDraft) as Partial<IntakeFormState>),
        });
      } catch {
        window.localStorage.removeItem(intakeDraftStorageKey);
      }
    }, 0);

    return () => window.clearTimeout(restoreDraft);
  }, [selectedProject]);

  useEffect(() => {
    if (selectedProject) {
      return;
    }

    window.localStorage.setItem(intakeDraftStorageKey, JSON.stringify(formState));
  }, [formState, selectedProject]);

  function redirectToLogin() {
    window.location.assign(
      `/login?next=${encodeURIComponent(window.location.pathname)}`,
    );
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

  function startNewIntake() {
    setSelectedProjectId("");
    setFormState(emptyFormState());
    setUploadMessage("");
    setUploadQueue([]);
    setCapturePhase("idle");
    setCurrentWalkthroughId("");
    setWalkthroughMessage("");
    setSectionForm(emptySectionCaptureForm());
    setPendingSectionPhotos([]);
    setPendingAudioNote(undefined);
    setRouteForm(emptyRouteMeasurementForm());
    window.localStorage.removeItem(intakeDraftStorageKey);
  }

  async function saveIntakeSession(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setIsSavingIntake(true);
    setUploadMessage("");

    try {
      const intake = buildIntakeInput(formState, selectedProject);
      const response = await fetch(
        selectedProject ? `/api/intakes/${selectedProject.id}` : "/api/intakes",
        {
          method: selectedProject ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(intake),
        },
      );
      const parsed = await parseApiResponse<ProjectRecord>(response);

      if (!parsed.ok) {
        setUploadMessage(parsed.error);
        return undefined;
      }

      const savedProject = parsed.payload;

      startTransition(() => {
        setDashboard((current) => ({
          ...current,
          projects: [
            savedProject,
            ...current.projects.filter((project) => project.id !== savedProject.id),
          ],
        }));
        setSelectedProjectId(savedProject.id);
      });
      window.localStorage.removeItem(intakeDraftStorageKey);
      setUploadMessage("Intake session saved. Media can be added or retried safely.");
      return savedProject;
    } finally {
      setIsSavingIntake(false);
    }
  }

  function mergeProject(updatedProject: ProjectRecord) {
    startTransition(() => {
      setDashboard((current) => ({
        ...current,
        projects: [
          updatedProject,
          ...current.projects.filter((project) => project.id !== updatedProject.id),
        ],
      }));
    });
  }

  function updateUploadQueueItem(
    id: string,
    patch: Partial<UploadQueueItem>,
  ) {
    setUploadQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function uploadAttachment(
    file: File,
    kind: Attachment["kind"],
    replaceAttachmentId?: string,
    context?: {
      walkthroughId?: string;
      sectionId?: string;
      successMessage?: string;
    },
  ) {
    if (!selectedProject) {
      setUploadMessage("Save the intake session before adding media.");
      return Promise.resolve();
    }

    setIsUploading(true);
    setUploadMessage("");

    const queueId = `${kind}-${file.name}-${file.size}-${file.lastModified}`;
    setUploadQueue((current) => [
      {
        id: queueId,
        name: file.name,
        kind,
        progress: 0,
        status: "uploading",
      },
      ...current,
    ]);

    return new Promise<void>((resolve) => {
      const formData = new FormData();
      formData.append("projectId", selectedProject.id);
      formData.append("kind", kind);
      formData.append("file", file);

      if (replaceAttachmentId) {
        formData.append("replaceAttachmentId", replaceAttachmentId);
      }

      if (context?.walkthroughId) {
        formData.append("walkthroughId", context.walkthroughId);
      }

      if (context?.sectionId) {
        formData.append("sectionId", context.sectionId);
      }

      const request = new XMLHttpRequest();
      request.open("POST", "/api/uploads");

      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return;
        }

        updateUploadQueueItem(queueId, {
          progress: Math.max(1, Math.round((event.loaded / event.total) * 100)),
        });
      };

      request.onload = () => {
        const payload = JSON.parse(request.responseText || "{}") as {
          project?: ProjectRecord;
          error?: string;
        };

        if (request.status === 401) {
          redirectToLogin();
          resolve();
          return;
        }

        if (request.status < 200 || request.status >= 300 || !payload.project) {
          const error = payload.error ?? "Upload failed. Check signal and retry.";
          updateUploadQueueItem(queueId, {
            status: "failed",
            error,
          });
          setUploadMessage(error);
          resolve();
          return;
        }

        mergeProject(payload.project);
        updateUploadQueueItem(queueId, {
          progress: 100,
          status: "complete",
        });
        setUploadMessage(
          context?.successMessage ??
            `${attachmentKindLabel(kind)} saved to intake.`,
        );
        resolve();
      };

      request.onerror = () => {
        const error = "Upload failed before reaching storage. Check signal and retry.";
        updateUploadQueueItem(queueId, {
          status: "failed",
          error,
        });
        setUploadMessage(error);
        resolve();
      };

      request.onloadend = () => {
        setIsUploading(false);
      };

      request.send(formData);
    });
  }

  async function uploadMediaFiles(files: File[], kind: "photo" | "video") {
    for (const file of files) {
      await uploadAttachment(file, kind);
    }
  }

  function startWalkthroughCapture() {
    if (!selectedProject) {
      setWalkthroughMessage("Save or select an intake before starting a walkthrough.");
      return;
    }

    setCapturePhase("note_mode");
    setWalkthroughMessage("");
  }

  async function createWalkthroughForMode(mode: WalkthroughSectionNoteMode) {
    if (!selectedProject) {
      return undefined;
    }

    setIsSavingWalkthrough(true);
    setWalkthroughMessage("");

    try {
      const walkthroughId = slugify(
        `${selectedProject.id}-walkthrough-${Date.now()}`,
      );
      const response = await fetch("/api/walkthroughs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: selectedProject.id,
          id: walkthroughId,
          status: "draft",
          noteModeDefault: mode,
        }),
      });
      const parsed = await parseApiResponse<{
        project: ProjectRecord;
        walkthrough?: Walkthrough;
      }>(response);

      if (!parsed.ok) {
        setWalkthroughMessage(parsed.error);
        return undefined;
      }

      const walkthrough =
        parsed.payload.walkthrough ??
        parsed.payload.project.walkthroughs?.find((item) => item.id === walkthroughId);

      mergeProject(parsed.payload.project);
      setCurrentWalkthroughId(walkthrough?.id ?? walkthroughId);
      setSectionForm(emptySectionCaptureForm(mode));
      setPendingSectionPhotos([]);
      setPendingAudioNote(undefined);
      setCapturePhase("section");
      setWalkthroughMessage(
        `${mode === "voice" ? "Speak notes" : "Type notes"} walkthrough started.`,
      );

      return walkthrough;
    } finally {
      setIsSavingWalkthrough(false);
    }
  }

  async function getOrCreateActiveWalkthrough() {
    if (activeWalkthrough) {
      return activeWalkthrough;
    }

    return createWalkthroughForMode(sectionForm.noteMode);
  }

  function addPendingSectionPhotos(files: FileList | null) {
    const nextFiles = Array.from(files ?? []);

    if (nextFiles.length === 0) {
      return;
    }

    setPendingSectionPhotos((current) => [...current, ...nextFiles]);
  }

  async function saveWalkthroughSection(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!selectedProject) {
      setWalkthroughMessage("Save or select an intake before saving a section.");
      return;
    }

    if (!sectionForm.areaName.trim()) {
      setWalkthroughMessage("Name the area before saving this section.");
      return;
    }

    if (pendingSectionPhotos.length === 0) {
      setWalkthroughMessage("Add at least one photo for this section.");
      return;
    }

    if (sectionForm.noteMode === "text" && !sectionForm.typedNote.trim()) {
      setWalkthroughMessage("Add typed notes before saving this section.");
      return;
    }

    if (
      sectionForm.noteMode === "voice" &&
      !pendingAudioNote &&
      !sectionForm.transcript.trim()
    ) {
      setWalkthroughMessage("Add an audio note or transcript before saving this section.");
      return;
    }

    setIsSavingWalkthrough(true);
    setWalkthroughMessage("");

    try {
      const walkthrough = await getOrCreateActiveWalkthrough();

      if (!walkthrough) {
        setWalkthroughMessage("Walkthrough could not be started.");
        return;
      }

      const sectionId = slugify(
        `${walkthrough.id}-${sectionForm.areaName}-${Date.now()}`,
      );
      const response = await fetch(`/api/walkthroughs/${walkthrough.id}/sections`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: selectedProject.id,
          id: sectionId,
          areaName: sectionForm.areaName.trim(),
          name: sectionForm.areaName.trim(),
          sortOrder: activeWalkthroughSections.length,
          noteMode: sectionForm.noteMode,
          typedNote:
            sectionForm.noteMode === "text"
              ? sectionForm.typedNote.trim()
              : undefined,
          transcript:
            sectionForm.noteMode === "voice"
              ? sectionForm.transcript.trim() || undefined
              : undefined,
          extractionStatus: "not_started",
        }),
      });
      const parsed = await parseApiResponse<{
        project: ProjectRecord;
        section?: WalkthroughSection;
      }>(response);

      if (!parsed.ok) {
        setWalkthroughMessage(parsed.error);
        return;
      }

      mergeProject(parsed.payload.project);

      for (const photo of pendingSectionPhotos) {
        await uploadAttachment(photo, "section_photo", undefined, {
          walkthroughId: walkthrough.id,
          sectionId,
          successMessage: "Section photo saved to walkthrough.",
        });
      }

      if (pendingAudioNote) {
        await uploadAttachment(pendingAudioNote, "section_audio_note", undefined, {
          walkthroughId: walkthrough.id,
          sectionId,
          successMessage: "Section audio note saved to walkthrough.",
        });
      }

      setCurrentWalkthroughId(walkthrough.id);
      setSectionForm(emptySectionCaptureForm(sectionForm.noteMode));
      setPendingSectionPhotos([]);
      setPendingAudioNote(undefined);
      setCapturePhase("next_prompt");
      setWalkthroughMessage("Section saved. Choose the next walkthrough step.");
    } finally {
      setIsSavingWalkthrough(false);
    }
  }

  async function saveRouteMeasurement(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!selectedProject || !activeWalkthrough) {
      setWalkthroughMessage("Start a walkthrough before adding route measurements.");
      return;
    }

    if (!routeForm.sourceLocation.trim()) {
      setWalkthroughMessage("Add the route source before saving a measurement.");
      return;
    }

    setIsSavingWalkthrough(true);
    setWalkthroughMessage("");

    try {
      const measuredDistance = Number.parseFloat(routeForm.measuredDistanceFt);
      const response = await fetch(
        `/api/walkthroughs/${activeWalkthrough.id}/route-measurements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: selectedProject.id,
            id: slugify(
              `${activeWalkthrough.id}-route-${routeForm.sourceLocation}-${Date.now()}`,
            ),
            sourceLocation: routeForm.sourceLocation.trim(),
            destinationSectionId: routeForm.destinationSectionId || undefined,
            destinationDescription:
              routeForm.destinationDescription.trim() || undefined,
            measuredDistanceFt: Number.isFinite(measuredDistance)
              ? measuredDistance
              : undefined,
            requiresMeasuredDistance: !Number.isFinite(measuredDistance),
            requiresReview: true,
            notes: routeForm.notes.trim() || undefined,
          }),
        },
      );
      const parsed = await parseApiResponse<{
        project: ProjectRecord;
        routeMeasurement?: RouteMeasurement;
      }>(response);

      if (!parsed.ok) {
        setWalkthroughMessage(parsed.error);
        return;
      }

      mergeProject(parsed.payload.project);
      setRouteForm(emptyRouteMeasurementForm());
      setCapturePhase("next_prompt");
      setWalkthroughMessage("Route measurement saved separately from sections.");
    } finally {
      setIsSavingWalkthrough(false);
    }
  }

  async function finishWalkthrough() {
    if (!selectedProject || !activeWalkthrough) {
      setCapturePhase("done");
      setWalkthroughMessage("Walkthrough capture is done.");
      return;
    }

    setIsSavingWalkthrough(true);
    setWalkthroughMessage("");

    try {
      const response = await fetch(`/api/walkthroughs/${activeWalkthrough.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: selectedProject.id,
          status: "ready_for_extraction",
          noteModeDefault: activeWalkthrough.noteModeDefault,
        }),
      });
      const parsed = await parseApiResponse<{
        project: ProjectRecord;
        walkthrough?: Walkthrough;
      }>(response);

      if (!parsed.ok) {
        setWalkthroughMessage(parsed.error);
        return;
      }

      mergeProject(parsed.payload.project);
      setCapturePhase("done");
      setWalkthroughMessage(
        "Walkthrough saved for review. No estimate or proposal was generated.",
      );
    } finally {
      setIsSavingWalkthrough(false);
    }
  }

  async function replaceMediaFile(
    event: React.ChangeEvent<HTMLInputElement>,
    attachment: Attachment,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || (attachment.kind !== "photo" && attachment.kind !== "video")) {
      return;
    }

    await uploadAttachment(file, attachment.kind, attachment.id);
  }

  async function removeAttachment(attachment: Attachment) {
    if (!selectedProject) {
      return;
    }

    setUploadMessage("");

    const response = await fetch(
      `/api/intakes/${selectedProject.id}/attachments/${attachment.id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    const parsed = await parseApiResponse<{
      project?: ProjectRecord;
      warning?: string;
    }>(response);

    if (!parsed.ok || !parsed.payload.project) {
      setUploadMessage(parsed.ok ? "Remove failed." : parsed.error);
      return;
    }

    mergeProject(parsed.payload.project);
    setUploadMessage(parsed.payload.warning ?? "Attachment removed from intake.");
  }

  async function runExtraction() {
    if (!selectedProject) {
      setUploadMessage("Save or select an intake before running extraction.");
      return;
    }

    setIsExtracting(true);
    setUploadMessage("");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectId: selectedProject.id }),
      });
      const parsed = await parseApiResponse<ProjectRecord>(response);

      if (!parsed.ok) {
        setUploadMessage(parsed.error);
        return;
      }

      mergeProject(parsed.payload);
      setUploadMessage(
        parsed.payload.extractionStatus?.message ??
          "Detected work items are ready for review.",
      );
    } finally {
      setIsExtracting(false);
    }
  }

  async function sendProposal(force = false) {
    if (!selectedProject) {
      return;
    }

    if (!selectedProject.customer.email?.trim()) {
      setUploadMessage("Add a customer email address before sending the proposal.");
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
      const payload = (await response.json().catch(() => ({}))) as {
        project?: ProjectRecord;
        message?: string;
        error?: string;
      };

      if (response.status === 401) {
        redirectToLogin();
        return;
      }

      if (payload.project) {
        mergeProject(payload.project);
      }

      if (!response.ok || !payload.project) {
        setUploadMessage(
          payload.error ?? payload.message ?? "Customer proposal email failed.",
        );
        return;
      }

      setUploadMessage(
        payload.message ?? "Customer proposal email sent from the workspace.",
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
                This MVP captures section-based walkthrough notes, photos, and route
                measurements before anything is priced, proposed, or sent.
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
            <p className="eyebrow">Saved Intakes</p>
            <div className="mt-4 space-y-3">
              {dashboard.projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    startTransition(() => {
                      setSelectedProjectId(project.id);
                      setFormState(formStateFromProject(project));
                      setCurrentWalkthroughId(project.walkthroughs?.[0]?.id ?? "");
                      setCapturePhase("idle");
                      setWalkthroughMessage("");
                      setSectionForm(emptySectionCaptureForm());
                      setPendingSectionPhotos([]);
                      setPendingAudioNote(undefined);
                      setRouteForm(emptyRouteMeasurementForm());
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
                          Intake {statusLabel(project.intakeStatus ?? "saved")}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 ${notificationBadgeClasses(project.customerSendStatus.status)}`}
                        >
                          Media {project.attachments.length}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${badgeClasses(project.estimateDraft.reviewStatus)}`}
                    >
                      {project.estimateDraft.lineItems.length > 0
                        ? statusLabel(project.estimateDraft.reviewStatus)
                        : "intake"}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[#5d5047]">{project.title}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="panel rounded-[32px] p-5">
            <p className="eyebrow">Price Book Ready</p>
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
              <li>Current focus is reliable field intake, section photos, notes, and review.</li>
              <li>AI extraction and estimating stay out of this pass until inputs are proven.</li>
              <li>Saved sessions remain in protected storage so retry and refresh are recoverable.</li>
            </ul>
          </section>
        </aside>

        <div className="space-y-6">
          <section className="panel overflow-hidden rounded-[32px] p-5 sm:p-6">
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <div>
                <p className="eyebrow">Quick Intake</p>
                <h2 className="mt-2 text-2xl font-semibold">Create an intake session</h2>
                <p className="mt-3 text-sm leading-7 text-[#5d5047]">
                  Save the customer and job details, then use Walkthrough as the
                  primary estimating capture path.
                </p>

                <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={saveIntakeSession}>
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
                      disabled={isSavingIntake}
                      className="rounded-full bg-[#1f1a17] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#372d29] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSavingIntake
                        ? "Saving intake..."
                        : selectedProject
                          ? "Save intake changes"
                          : "Save intake session"}
                    </button>
                    <button
                      type="button"
                      onClick={startNewIntake}
                      className="rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-[#5d5047] transition hover:border-black/20"
                    >
                      New intake
                    </button>
                    <span className="text-sm text-[#6d5a50]">
                      Inputs are stored before AI or estimate generation starts.
                    </span>
                  </div>
                </form>
              </div>

              <div className="rounded-[30px] border border-black/8 bg-[#fff9f3] p-5">
                <p className="eyebrow">Intake Review</p>
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
                          INPUTS
                        </p>
                        <p className="mt-2 font-semibold">
                          {selectedProject.walkthroughSections?.length ?? 0}{" "}
                          sections,{" "}
                          {selectedProject.attachments.filter(
                            (attachment) => attachment.kind === "section_photo",
                          ).length}{" "}
                          section photos
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
                            className="grid gap-3 rounded-[18px] border border-black/6 bg-[#fbf8f3] px-4 py-3 sm:grid-cols-[1fr_auto]"
                          >
                            <div>
                              <p className="font-medium">{attachment.name}</p>
                              <p className="mt-1 text-xs text-[#6d5a50]">
                                {attachment.kind} • {attachment.sizeLabel}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${badgeClasses(attachment.uploadStatus)}`}
                              >
                                {statusLabel(attachment.uploadStatus)}
                              </span>
                              {attachment.kind === "photo" || attachment.kind === "video" ? (
                                <label className="rounded-full border border-black/10 bg-white px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-[#5d5047]">
                                  Replace
                                  <input
                                    type="file"
                                    accept={
                                      attachment.kind === "photo"
                                        ? PHOTO_UPLOAD_ACCEPT
                                        : "video/*"
                                    }
                                    onChange={(event) =>
                                      replaceMediaFile(event, attachment)
                                    }
                                    className="hidden"
                                  />
                                </label>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => removeAttachment(attachment)}
                                className="rounded-full border border-rose-900/10 bg-rose-50 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-rose-900"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                        {selectedProject.attachments.length === 0 ? (
                          <p className="text-sm text-[#6d5a50]">
                            No saved attachments yet.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-5 rounded-[24px] border border-dashed border-black/10 bg-[#faf4ee] p-4">
                      <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                        UPLOAD STATUS
                      </p>
                      <div className="mt-3 space-y-3">
                        {uploadQueue.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-[18px] border border-black/8 bg-white/80 px-4 py-3"
                          >
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="font-medium">{item.name}</span>
                              <span
                                className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${badgeClasses(item.status)}`}
                              >
                                {statusLabel(item.status)}
                              </span>
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/8">
                              <div
                                className={`h-full ${
                                  item.status === "failed"
                                    ? "bg-rose-600"
                                    : "bg-[#d96a28]"
                                }`}
                                style={{ width: `${item.progress}%` }}
                              />
                            </div>
                            {item.error ? (
                              <p className="mt-2 text-xs leading-5 text-rose-900">
                                {item.error}
                              </p>
                            ) : null}
                          </div>
                        ))}
                        {uploadQueue.length === 0 ? (
                          <p className="text-sm text-[#6d5a50]">
                            Upload progress and retry errors will appear here.
                          </p>
                        ) : null}
                      </div>
                      {uploadMessage ? (
                        <p className="mt-3 text-sm text-[#5d5047]">{uploadMessage}</p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="mt-4 rounded-[24px] border border-amber-900/12 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Save a new intake or select an existing saved intake to review inputs.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="panel overflow-hidden rounded-[32px] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Walkthrough</p>
                <h2 className="mt-2 text-2xl font-semibold">
                  Capture sections by area
                </h2>
              </div>
              <span className="rounded-full border border-black/8 bg-white/70 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[#745e51]">
                capture only
              </span>
            </div>

            {!selectedProject ? (
              <div className="mt-5 rounded-[24px] border border-amber-900/12 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Save or select an intake before starting a walkthrough.
              </div>
            ) : (
              <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_0.92fr]">
                <div className="rounded-[28px] border border-black/8 bg-[#fff9f3] p-4 sm:p-5">
                  {capturePhase === "idle" || capturePhase === "done" ? (
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm font-medium text-[#2b2420]">
                          {activeWalkthrough
                            ? `${activeWalkthroughSections.length} section${
                                activeWalkthroughSections.length === 1 ? "" : "s"
                              } saved`
                            : "Ready for field capture"}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[#6d5a50]">
                          Start a walkthrough, choose notes, then save each area with
                          its own photos.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={startWalkthroughCapture}
                        disabled={isSavingWalkthrough}
                        className="w-full rounded-full bg-[#1f1a17] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#372d29] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                      >
                        Walkthrough
                      </button>
                    </div>
                  ) : null}

                  {capturePhase === "note_mode" ? (
                    <div>
                      <p className="font-medium text-[#2b2420]">
                        How do you want to capture notes?
                      </p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => createWalkthroughForMode("voice")}
                          disabled={isSavingWalkthrough}
                          className="rounded-[22px] border border-black/10 bg-white px-4 py-4 text-left text-sm font-medium transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span className="block text-[#2b2420]">Speak notes</span>
                          <span className="mt-1 block text-xs font-normal leading-6 text-[#6d5a50]">
                            Use an audio note and optional transcript per area.
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => createWalkthroughForMode("text")}
                          disabled={isSavingWalkthrough}
                          className="rounded-[22px] border border-black/10 bg-white px-4 py-4 text-left text-sm font-medium transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span className="block text-[#2b2420]">Type notes</span>
                          <span className="mt-1 block text-xs font-normal leading-6 text-[#6d5a50]">
                            Type section notes before saving each area.
                          </span>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {capturePhase === "section" ? (
                    <form className="space-y-4" onSubmit={saveWalkthroughSection}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-[#2b2420]">New area</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[#7a6558]">
                            {sectionForm.noteMode} notes
                          </p>
                        </div>
                        <div className="flex rounded-full border border-black/10 bg-white p-1 text-xs font-medium">
                          {(["voice", "text"] as WalkthroughSectionNoteMode[]).map(
                            (mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() =>
                                  setSectionForm((current) => ({
                                    ...current,
                                    noteMode: mode,
                                  }))
                                }
                                className={`rounded-full px-3 py-1.5 transition ${
                                  sectionForm.noteMode === mode
                                    ? "bg-[#1f1a17] text-white"
                                    : "text-[#5d5047]"
                                }`}
                              >
                                {mode === "voice" ? "Voice" : "Text"}
                              </button>
                            ),
                          )}
                        </div>
                      </div>

                      <label className="block text-sm">
                        <span className="mb-2 block text-[#69584c]">Area name</span>
                        <input
                          value={sectionForm.areaName}
                          onChange={(event) =>
                            setSectionForm((current) => ({
                              ...current,
                              areaName: event.target.value,
                            }))
                          }
                          className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                          placeholder="Kitchen, garage, patio"
                        />
                      </label>

                      <div className="rounded-[22px] border border-black/8 bg-white/70 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">Section photos</p>
                            <p className="mt-1 text-xs text-[#6d5a50]">
                              {pendingSectionPhotos.length} ready to save
                            </p>
                          </div>
                          <label className="rounded-full bg-[#d96a28] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#c65c1c]">
                            Add photos
                            <input
                              type="file"
                              accept={PHOTO_UPLOAD_ACCEPT}
                              multiple
                              onChange={(event) => {
                                addPendingSectionPhotos(event.target.files);
                                event.target.value = "";
                              }}
                              className="hidden"
                            />
                          </label>
                        </div>
                        {pendingSectionPhotos.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {pendingSectionPhotos.map((file, index) => (
                              <div
                                key={`${file.name}-${file.size}-${index}`}
                                className="flex items-center justify-between gap-3 rounded-[16px] border border-black/6 bg-[#fbf8f3] px-3 py-2 text-sm"
                              >
                                <span className="min-w-0 truncate">{file.name}</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPendingSectionPhotos((current) =>
                                      current.filter((_, itemIndex) => itemIndex !== index),
                                    )
                                  }
                                  className="shrink-0 rounded-full border border-rose-900/10 bg-rose-50 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-rose-900"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {sectionForm.noteMode === "text" ? (
                        <label className="block text-sm">
                          <span className="mb-2 block text-[#69584c]">Section notes</span>
                          <textarea
                            rows={3}
                            value={sectionForm.typedNote}
                            onChange={(event) =>
                              setSectionForm((current) => ({
                                ...current,
                                typedNote: event.target.value,
                              }))
                            }
                            className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                            placeholder="What did you see in this area?"
                          />
                        </label>
                      ) : (
                        <div className="space-y-3">
                          <div className="rounded-[22px] border border-black/8 bg-white/70 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium">Audio note</p>
                                <p className="mt-1 text-xs text-[#6d5a50]">
                                  {pendingAudioNote?.name ?? "No audio selected"}
                                </p>
                              </div>
                              <label className="rounded-full bg-[#d96a28] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#c65c1c]">
                                Add audio
                                <input
                                  type="file"
                                  accept="audio/*"
                                  onChange={(event) => {
                                    setPendingAudioNote(event.target.files?.[0]);
                                    event.target.value = "";
                                  }}
                                  className="hidden"
                                />
                              </label>
                            </div>
                          </div>
                          <label className="block text-sm">
                            <span className="mb-2 block text-[#69584c]">
                              Transcript or summary
                            </span>
                            <textarea
                              rows={3}
                              value={sectionForm.transcript}
                              onChange={(event) =>
                                setSectionForm((current) => ({
                                  ...current,
                                  transcript: event.target.value,
                                }))
                              }
                              className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                              placeholder="Optional if an audio note is attached"
                            />
                          </label>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="submit"
                          disabled={isSavingWalkthrough || isUploading}
                          className="rounded-full bg-[#1f1a17] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#372d29] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingWalkthrough ? "Saving section..." : "Save section"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCapturePhase("next_prompt")}
                          className="rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-[#5d5047] transition hover:border-black/20"
                        >
                          Back
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {capturePhase === "next_prompt" ? (
                    <div>
                      <p className="font-medium text-[#2b2420]">Next step</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSectionForm(
                              emptySectionCaptureForm(sectionForm.noteMode),
                            );
                            setPendingSectionPhotos([]);
                            setPendingAudioNote(undefined);
                            setCapturePhase("section");
                          }}
                          className="rounded-[20px] border border-black/10 bg-white px-4 py-3 text-left text-sm font-medium transition hover:border-black/20"
                        >
                          Add next area
                        </button>
                        <button
                          type="button"
                          onClick={() => setCapturePhase("route")}
                          className="rounded-[20px] border border-black/10 bg-white px-4 py-3 text-left text-sm font-medium transition hover:border-black/20"
                        >
                          Add route measurements
                        </button>
                        <button
                          type="button"
                          onClick={finishWalkthrough}
                          disabled={isSavingWalkthrough}
                          className="rounded-[20px] bg-[#1f1a17] px-4 py-3 text-left text-sm font-medium text-white transition hover:bg-[#372d29] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {capturePhase === "route" ? (
                    <form className="space-y-4" onSubmit={saveRouteMeasurement}>
                      <div>
                        <p className="font-medium text-[#2b2420]">
                          Route measurement
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[#7a6558]">
                          separate from sections
                        </p>
                      </div>

                      <label className="block text-sm">
                        <span className="mb-2 block text-[#69584c]">Source</span>
                        <input
                          value={routeForm.sourceLocation}
                          onChange={(event) =>
                            setRouteForm((current) => ({
                              ...current,
                              sourceLocation: event.target.value,
                            }))
                          }
                          className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                          placeholder="Panel, attic junction, exterior meter"
                        />
                      </label>

                      <label className="block text-sm">
                        <span className="mb-2 block text-[#69584c]">
                          Destination area
                        </span>
                        <select
                          value={routeForm.destinationSectionId}
                          onChange={(event) =>
                            setRouteForm((current) => ({
                              ...current,
                              destinationSectionId: event.target.value,
                            }))
                          }
                          className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                        >
                          <option value="">Describe manually</option>
                          {activeWalkthroughSections.map((section) => (
                            <option key={section.id} value={section.id}>
                              {section.areaName}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-sm">
                        <span className="mb-2 block text-[#69584c]">
                          Destination description
                        </span>
                        <input
                          value={routeForm.destinationDescription}
                          onChange={(event) =>
                            setRouteForm((current) => ({
                              ...current,
                              destinationDescription: event.target.value,
                            }))
                          }
                          className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                        />
                      </label>

                      <label className="block text-sm">
                        <span className="mb-2 block text-[#69584c]">
                          Distance in feet
                        </span>
                        <input
                          inputMode="decimal"
                          value={routeForm.measuredDistanceFt}
                          onChange={(event) =>
                            setRouteForm((current) => ({
                              ...current,
                              measuredDistanceFt: event.target.value,
                            }))
                          }
                          className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                        />
                      </label>

                      <label className="block text-sm">
                        <span className="mb-2 block text-[#69584c]">Notes</span>
                        <textarea
                          rows={2}
                          value={routeForm.notes}
                          onChange={(event) =>
                            setRouteForm((current) => ({
                              ...current,
                              notes: event.target.value,
                            }))
                          }
                          className="w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 outline-none transition focus:border-[#d96a28]/40"
                        />
                      </label>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="submit"
                          disabled={isSavingWalkthrough}
                          className="rounded-full bg-[#1f1a17] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#372d29] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Save route measurement
                        </button>
                        <button
                          type="button"
                          onClick={() => setCapturePhase("next_prompt")}
                          className="rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-[#5d5047] transition hover:border-black/20"
                        >
                          Back
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {walkthroughMessage ? (
                    <p className="mt-4 text-sm leading-6 text-[#5d5047]">
                      {walkthroughMessage}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-[28px] border border-black/8 bg-white/70 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-[#2b2420]">
                        Saved walkthrough sections
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[#7a6558]">
                        {activeWalkthrough?.status
                          ? statusLabel(activeWalkthrough.status)
                          : "not started"}
                      </p>
                    </div>
                    <span className="rounded-full border border-black/8 bg-white px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-[#7a6558]">
                      {activeWalkthroughSections.length} areas
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {activeWalkthroughSections.map((section) => {
                      const sectionPhotos =
                        selectedProject.attachments.filter((attachment) =>
                          section.photoAttachmentIds.includes(attachment.id),
                        );
                      const audioNote = selectedProject.attachments.find(
                        (attachment) => attachment.id === section.audioNoteAttachmentId,
                      );

                      return (
                        <div
                          key={section.id}
                          className="rounded-[20px] border border-black/6 bg-[#fbf8f3] px-4 py-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium">{section.areaName}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[#7a6558]">
                                {section.noteMode} notes | {sectionPhotos.length} photos
                              </p>
                            </div>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${badgeClasses(section.extractionStatus)}`}
                            >
                              {statusLabel(section.extractionStatus)}
                            </span>
                          </div>
                          {section.typedNote ? (
                            <p className="mt-2 leading-6 text-[#5d5047]">
                              {section.typedNote}
                            </p>
                          ) : null}
                          {section.transcript ? (
                            <p className="mt-2 leading-6 text-[#5d5047]">
                              {section.transcript}
                            </p>
                          ) : null}
                          {audioNote ? (
                            <p className="mt-2 text-xs leading-5 text-[#6d5a50]">
                              Audio: {audioNote.name}
                            </p>
                          ) : null}
                          {sectionPhotos.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {sectionPhotos.map((photo) => (
                                <span
                                  key={photo.id}
                                  className="rounded-full border border-black/8 bg-white px-3 py-1 text-xs text-[#5d5047]"
                                >
                                  {photo.name}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {activeWalkthroughSections.length === 0 ? (
                      <p className="text-sm leading-6 text-[#6d5a50]">
                        No section areas saved yet.
                      </p>
                    ) : null}
                  </div>

                  {activeRouteMeasurements.length > 0 ? (
                    <div className="mt-5">
                      <p className="text-xs uppercase tracking-[0.16em] text-[#7a6558]">
                        Route measurements
                      </p>
                      <div className="mt-3 space-y-2">
                        {activeRouteMeasurements.map((measurement) => (
                          <div
                            key={measurement.id}
                            className="rounded-[18px] border border-black/6 bg-white/75 px-3 py-2 text-sm"
                          >
                            <p className="font-medium">
                              {measurement.sourceLocation}
                              {measurement.measuredDistanceFt
                                ? ` | ${measurement.measuredDistanceFt} ft`
                                : ""}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-[#6d5a50]">
                              {measurement.destinationDescription ??
                                activeWalkthroughSections.find(
                                  (section) =>
                                    section.id === measurement.destinationSectionId,
                                )?.areaName ??
                                "Destination pending"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
            <section className="panel overflow-hidden rounded-[32px] p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Input Review</p>
                  <h2 className="mt-2 text-xl font-semibold">Typed notes and saved media</h2>
                </div>
                <div className="rounded-full border border-black/8 bg-white/70 px-3 py-1 font-mono text-[11px] tracking-[0.16em] text-[#745e51]">
                  {selectedProject?.attachments.length ?? 0} FILES
                </div>
              </div>

              <div className="mt-5 grid gap-4">
                <div className="rounded-[26px] border border-black/8 bg-white/70 p-4">
                  <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                    TYPED NOTES
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
                    SAVED MEDIA
                  </p>
                  <div className="mt-3 space-y-3">
                    {selectedProject?.attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="rounded-[18px] border border-black/6 bg-[#fbf8f3] px-4 py-3 text-sm"
                      >
                        <p className="font-medium">{attachment.name}</p>
                        <p className="mt-1 leading-6 text-[#6d5a50]">
                          {attachment.kind} saved to {attachment.storageKey ?? "storage"}
                        </p>
                      </div>
                    ))}
                    {selectedProject?.attachments.length === 0 ? (
                      <p className="text-sm text-[#6d5a50]">
                        Section photos and optional secondary attachments appear here.
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-[26px] border border-black/8 bg-white/70 p-4">
                  <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                    SAVE STATUS
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-[#54473f]">
                    {selectedProject?.analysisSummary.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-[26px] border border-black/8 bg-white/70 p-4">
                  <p className="font-mono text-[11px] tracking-[0.16em] text-[#7a6558]">
                    DETECTED WORK ITEMS
                  </p>
                  <div className="mt-3 space-y-3">
                    {detectedWorkItemReviewGroups.map((group) => (
                      <div
                        key={group.id}
                        className="rounded-[18px] border border-black/6 bg-[#fbf8f3] px-4 py-3 text-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{group.name}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[#7a6558]">
                              {group.items.length} detected item
                              {group.items.length === 1 ? "" : "s"}
                            </p>
                          </div>
                          {group.photos.length > 0 ? (
                            <p className="text-xs leading-5 text-[#6d5a50]">
                              {group.photos.length} photo
                              {group.photos.length === 1 ? "" : "s"}
                            </p>
                          ) : null}
                        </div>
                        {group.noteText ? (
                          <p className="mt-3 rounded-[14px] border border-black/6 bg-white/70 px-3 py-2 text-xs leading-6 text-[#5f5148]">
                            {group.noteText}
                          </p>
                        ) : null}
                        {group.photos.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {group.photos.map((photo) => (
                              <span
                                key={photo.id}
                                className="rounded-full border border-black/8 bg-white/70 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[#7a6558]"
                              >
                                {photo.name}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="mt-3 space-y-3">
                          {group.items.map((item) => (
                            <div
                              key={item.id}
                              className="rounded-[14px] border border-black/6 bg-white/70 px-3 py-3"
                            >
                              <p className="font-medium">{item.description}</p>
                              <p className="mt-1 leading-6 text-[#6d5a50]">
                                Qty {item.quantity} {item.unit ?? "Each"} |{" "}
                                {formatPercent(item.confidence)} |{" "}
                                {item.requiresReview || item.manualReview
                                  ? "review required"
                                  : "ready after review"}{" "}
                                | {item.pricingStatus?.replaceAll("_", " ") ?? "not ready"}
                              </p>
                              {item.sourceAttachmentIds?.length ? (
                                <p className="mt-1 text-xs leading-5 text-[#6d5a50]">
                                  Sources: {item.sourceAttachmentIds.join(", ")}
                                </p>
                              ) : (
                                <p className="mt-1 text-xs leading-5 text-[#6d5a50]">
                                  Source: {item.sourcePath}
                                </p>
                              )}
                              {item.suggestedPriceBookMatch ? (
                                <p className="mt-1 text-xs leading-5 text-[#6d5a50]">
                                  Suggested match: {item.suggestedPriceBookMatch.name}
                                </p>
                              ) : null}
                              {item.missingMeasurementPrompts?.length ? (
                                <div className="mt-2 rounded-[12px] border border-amber-900/15 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                                  {item.missingMeasurementPrompts.map((prompt) => (
                                    <p key={prompt}>{prompt}</p>
                                  ))}
                                </div>
                              ) : null}
                              {item.extractionRequiresConversion || item.extractionNotes ? (
                                <p className="mt-2 text-xs leading-5 text-amber-900">
                                  {item.extractionRequiresConversion
                                    ? "AI extraction needs JPEG conversion for this file. Review manually for now."
                                    : item.extractionNotes}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {detectedWorkItemReviewGroups.length === 0 ? (
                      <p className="text-sm text-[#6d5a50]">
                        Run extraction after walkthrough sections, photos, and notes are saved.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <CameraCapture
              disabled={!selectedProject}
              isUploading={isUploading}
              onSelectFiles={uploadMediaFiles}
            />
          </div>

          {selectedProject?.estimateDraft.lineItems.length ? (
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
                          <span>Customer proposal email</span>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${notificationBadgeClasses(selectedProject.customerProposalEmailStatus)}`}
                          >
                            {statusLabel(selectedProject.customerProposalEmailStatus)}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-6 text-[#6d5a50]">
                          {customerSendStatus?.message}
                        </p>
                        {selectedProject.customerProposalEmailLastAttemptAt ? (
                          <p className="mt-2 text-xs leading-6 text-[#6d5a50]">
                            Last attempted{" "}
                            {new Date(
                              selectedProject.customerProposalEmailLastAttemptAt,
                            ).toLocaleString()}
                          </p>
                        ) : null}
                        {selectedProject.customerProposalEmailError ? (
                          <p className="mt-2 text-xs leading-6 text-rose-900">
                            {selectedProject.customerProposalEmailError}
                          </p>
                        ) : null}
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
                          onClick={() =>
                            resendNotification(
                              "owner_approval",
                              ownerApprovalStatus?.status === "sent",
                            )
                          }
                          disabled={isSendingProposal}
                          className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-[#5d5047] transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {ownerApprovalStatus?.status === "sent"
                            ? "Send owner approval email again"
                            : ownerApprovalStatus?.status === "queued"
                            ? "Send owner email now"
                            : "Resend owner alerts"}
                        </button>
                      ) : null}
                      {shouldShowCustomerResend ? (
                        <button
                          type="button"
                          onClick={() => resendNotification("customer_send")}
                          disabled={isSendingProposal}
                          className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-[#5d5047] transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {customerSendStatus?.status === "queued"
                            ? "Send customer email now"
                            : "Resend failed customer delivery"}
                        </button>
                      ) : null}
                    </div>

                    {copyState ? (
                      <p className="mt-3 text-sm text-emerald-900">{copyState}</p>
                    ) : null}

                    {!selectedProject.customer.email ? (
                      <p className="mt-3 text-sm text-amber-900">
                        Add a customer email address before the owner can send the proposal.
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
                <div className="mt-4 rounded-[22px] border border-black/8 bg-white/70 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">customer proposal email</p>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${notificationBadgeClasses(selectedProject?.customerProposalEmailStatus ?? "ready")}`}
                    >
                      {statusLabel(selectedProject?.customerProposalEmailStatus ?? "ready")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-7 text-[#5d5047]">
                    {customerSendStatus?.message}
                  </p>
                  {selectedProject?.customerProposalEmailLastAttemptAt ? (
                    <p className="mt-2 text-xs leading-6 text-[#6d5a50]">
                      Last attempted{" "}
                      {new Date(
                        selectedProject.customerProposalEmailLastAttemptAt,
                      ).toLocaleString()}
                    </p>
                  ) : null}
                  {selectedProject?.customerProposalEmailError ? (
                    <p className="mt-2 text-xs leading-6 text-rose-900">
                      {selectedProject.customerProposalEmailError}
                    </p>
                  ) : null}
                  {selectedProject?.customerProposalEmailStatus === "failed" ? (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => resendNotification("customer_send")}
                        disabled={isSendingProposal}
                        className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-[#5d5047] transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Resend customer proposal email
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 rounded-[22px] border border-black/8 bg-white/70 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">owner approval email</p>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${notificationBadgeClasses(ownerApprovalStatus?.status ?? "ready")}`}
                    >
                      {statusLabel(ownerApprovalStatus?.status ?? "ready")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-7 text-[#5d5047]">
                    {ownerApprovalStatus?.message}
                  </p>
                  {shouldShowOwnerResend ? (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() =>
                          resendNotification(
                            "owner_approval",
                            ownerApprovalStatus?.status === "sent",
                          )
                        }
                        disabled={isSendingProposal}
                        className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-[#5d5047] transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {ownerApprovalStatus?.status === "sent"
                          ? "Send owner approval email again"
                          : ownerApprovalStatus?.status === "failed"
                          ? "Retry owner approval email"
                          : "Send owner approval email"}
                      </button>
                    </div>
                  ) : null}
                </div>

                {uploadMessage ? (
                  <p className="mt-3 text-sm text-[#5d5047]">{uploadMessage}</p>
                ) : null}

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
                  Owner alerts and customer delivery now send directly through Resend from this
                  workspace. The cards above reflect the stored delivery result for each event,
                  and SMS delivery stays deferred until the later Twilio pass.
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
          ) : (
            <section className="panel rounded-[32px] p-5 sm:p-6">
              <p className="eyebrow">Estimate Generation</p>
              <h2 className="mt-2 text-xl font-semibold">Parked until intake is proven</h2>
              <p className="mt-3 text-sm leading-7 text-[#5d5047]">
                This pass saves field inputs only. AI extraction, estimate drafting,
                proposals, PDFs, and delivery actions are intentionally not run from this
                intake screen.
              </p>
              <button
                type="button"
                onClick={runExtraction}
                disabled={!selectedProject || isExtracting}
                className="mt-4 rounded-full bg-[#1f1a17] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#372d29] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isExtracting ? "Extracting review items..." : "Extract work items"}
              </button>
              {selectedProject?.extractionStatus ? (
                <p className="mt-3 text-sm text-[#6d5a50]">
                  {selectedProject.extractionStatus.message}
                </p>
              ) : null}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
