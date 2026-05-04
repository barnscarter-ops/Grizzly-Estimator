import type {
  Attachment,
  AttachmentKind,
  EstimateDraft,
  IntakeStatus,
  ProjectIntakeInput,
  ProjectRecord,
  ProposalWorkflowState,
} from "@/lib/types";
import { isSupportedPhotoFile, normalizeContentType } from "@/lib/media-types";
import { removeAttachmentFromWalkthroughSections } from "@/lib/walkthrough-session";

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function emptyEstimateDraft(): EstimateDraft {
  return {
    areaGroups: [],
    lineItems: [],
    materialTotal: 0,
    totalLaborHours: 0,
    laborRate: 118,
    grandTotal: 0,
    averageConfidence: 0,
    reviewStatus: "ready_for_owner_review",
  };
}

function intakeWorkflow(currentTime: string): ProposalWorkflowState {
  return {
    status: "intake_draft",
    activeStyle: "hcp",
    ownerReviewRequestedAt: currentTime,
  };
}

function normalizeTranscript(input: ProjectIntakeInput) {
  if (input.transcriptSegments.length > 0) {
    return input.transcriptSegments;
  }

  const text = [input.scopeDescription, ...input.notes].filter(Boolean).join("\n\n");

  return text
    ? [
        {
          id: `${input.id}-typed-notes`,
          speaker: "Estimator",
          timestamp: "00:00",
          text,
        },
      ]
    : [];
}

function withIntakeFields(
  input: ProjectIntakeInput,
  currentTime: string,
  createdByEmail?: string,
  intakeStatus: IntakeStatus = "saved",
): ProjectRecord {
  return {
    ...input,
    attachments: input.attachments,
    transcriptSegments: normalizeTranscript(input),
    createdAt: currentTime,
    updatedAt: currentTime,
    createdByEmail,
    intakeStatus,
    estimateDraft: emptyEstimateDraft(),
    proposalVariants: [],
    proposalWorkflow: intakeWorkflow(currentTime),
    notificationStatus: {
      status: "ready",
      lastUpdatedAt: currentTime,
      type: "owner_approval",
    },
    ownerApprovalStatus: {
      status: "ready",
      lastUpdatedAt: currentTime,
      message: "Intake is saved. Owner approval has not been requested.",
      channels: {
        email: "ready",
        sms: "ready",
      },
    },
    customerSendStatus: {
      status: "ready",
      lastUpdatedAt: currentTime,
      message: "Customer proposal has not been generated or sent.",
      channels: {
        email: "ready",
        sms: "ready",
      },
    },
    customerProposalEmailStatus: "ready",
    integrationSyncs: [],
    walkthroughs: [],
    walkthroughSections: [],
    routeMeasurements: [],
    detectedWorkItems: [],
    extractionStatus: {
      status: "not_started",
      message: "Extraction has not run for this intake.",
      updatedAt: currentTime,
    },
    capturePrompts: [],
    analysisSummary: [
      "Intake inputs are saved for review. Estimate generation has not run.",
    ],
    opsNextSteps: [
      "Review customer info, photos, videos, and typed notes before starting estimate generation.",
    ],
  };
}

export function createIntakeProject(
  input: ProjectIntakeInput,
  createdByEmail?: string,
  intakeStatus: IntakeStatus = "saved",
) {
  return withIntakeFields(input, nowIso(), createdByEmail, intakeStatus);
}

export function updateIntakeProject(
  project: ProjectRecord,
  input: ProjectIntakeInput,
  intakeStatus: IntakeStatus = "saved",
): ProjectRecord {
  const currentTime = nowIso();

  return {
    ...project,
    ...input,
    attachments: project.attachments,
    transcriptSegments: normalizeTranscript(input),
    createdAt: project.createdAt,
    updatedAt: currentTime,
    createdByEmail: project.createdByEmail,
    intakeStatus,
    estimateDraft: project.estimateDraft.lineItems.length
      ? project.estimateDraft
      : emptyEstimateDraft(),
    proposalVariants: project.proposalVariants,
    proposalWorkflow: project.proposalWorkflow ?? intakeWorkflow(currentTime),
    notificationStatus: project.notificationStatus,
    ownerApprovalStatus: project.ownerApprovalStatus,
    customerSendStatus: project.customerSendStatus,
    customerProposalEmailStatus: project.customerProposalEmailStatus,
    customerProposalEmailLastAttemptAt: project.customerProposalEmailLastAttemptAt,
    customerProposalEmailError: project.customerProposalEmailError,
    lastNotificationAttemptAt: project.lastNotificationAttemptAt,
    integrationSyncs: project.integrationSyncs ?? [],
    integrationState: project.integrationState,
    walkthroughs: project.walkthroughs ?? [],
    walkthroughSections: project.walkthroughSections ?? [],
    routeMeasurements: project.routeMeasurements ?? [],
    detectedWorkItems: project.detectedWorkItems ?? [],
    extractionStatus: project.extractionStatus,
    capturePrompts: project.capturePrompts ?? [],
    analysisSummary: project.analysisSummary?.length
      ? project.analysisSummary
      : ["Intake inputs are saved for review. Estimate generation has not run."],
    opsNextSteps: project.opsNextSteps?.length
      ? project.opsNextSteps
      : [
          "Review customer info, photos, videos, and typed notes before starting estimate generation.",
        ],
  };
}

export function isSupportedAttachmentKind(kind: string): kind is AttachmentKind {
  return [
    "video",
    "blueprint",
    "note",
    "photo",
    "section_photo",
    "section_audio_note",
    "general_attachment",
  ].includes(kind);
}

export function validateUploadFile(input: {
  kind: AttachmentKind;
  contentType: string;
  fileName?: string;
  sizeBytes: number;
}) {
  const contentType = normalizeContentType(input.contentType);

  if (
    (input.kind === "photo" || input.kind === "section_photo") &&
    !isSupportedPhotoFile(input)
  ) {
    return { ok: false as const, status: 415, error: "Photos must be image files." };
  }

  if (input.kind === "video" && !contentType.startsWith("video/")) {
    return { ok: false as const, status: 415, error: "Videos must be video files." };
  }

  if (
    input.kind === "section_audio_note" &&
    !contentType.startsWith("audio/")
  ) {
    return {
      ok: false as const,
      status: 415,
      error: "Section audio notes must be audio files.",
    };
  }

  if (
    input.kind === "blueprint" &&
    !contentType.startsWith("image/") &&
    contentType !== "application/pdf"
  ) {
    return {
      ok: false as const,
      status: 415,
      error: "Blueprints must be PDF or image files.",
    };
  }

  if (
    input.kind === "note" &&
    ![
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ].includes(contentType)
  ) {
    return {
      ok: false as const,
      status: 415,
      error: "Note uploads must be TXT, PDF, DOC, or DOCX files.",
    };
  }

  const maxBytes =
    input.kind === "video"
      ? MAX_VIDEO_BYTES
      : input.kind === "photo" || input.kind === "section_photo"
        ? MAX_PHOTO_BYTES
        : input.kind === "section_audio_note"
          ? MAX_AUDIO_BYTES
          : MAX_DOCUMENT_BYTES;

  if (input.sizeBytes > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false as const,
      status: 413,
      error: `${input.kind} files must be ${maxMb} MB or smaller.`,
    };
  }

  return { ok: true as const };
}

export function attachIntakeMedia(
  project: ProjectRecord,
  attachment: Attachment,
  replaceAttachmentId?: string,
): ProjectRecord {
  const currentTime = nowIso();
  const attachments = replaceAttachmentId
    ? project.attachments.map((current) =>
        current.id === replaceAttachmentId ? attachment : current,
      )
    : [attachment, ...project.attachments];

  return {
    ...project,
    attachments,
    updatedAt: currentTime,
    intakeStatus: project.intakeStatus ?? "saved",
    walkthroughs: project.walkthroughs ?? [],
    walkthroughSections: project.walkthroughSections ?? [],
    routeMeasurements: project.routeMeasurements ?? [],
  };
}

export function removeIntakeMedia(project: ProjectRecord, attachmentId: string) {
  const removedAttachment = project.attachments.find(
    (attachment) => attachment.id === attachmentId,
  );

  const updatedProject = {
    removedAttachment,
    project: {
      ...project,
      attachments: project.attachments.filter(
        (attachment) => attachment.id !== attachmentId,
      ),
      updatedAt: nowIso(),
      intakeStatus: project.intakeStatus ?? "saved",
    },
  };

  return {
    removedAttachment,
    project: removeAttachmentFromWalkthroughSections(
      updatedProject.project,
      attachmentId,
    ),
  };
}
