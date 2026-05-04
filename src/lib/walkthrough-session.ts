import type {
  Attachment,
  ProjectRecord,
  RouteMeasurement,
  SectionMeasurements,
  Walkthrough,
  WalkthroughNoteMode,
  WalkthroughSection,
  WalkthroughSectionExtractionStatus,
  WalkthroughSectionNoteMode,
  WalkthroughStatus,
} from "@/lib/types";
import { slugify } from "@/lib/utils";

type WalkthroughInput = {
  id?: string;
  sessionId?: string;
  status?: WalkthroughStatus;
  noteModeDefault?: WalkthroughNoteMode;
};

type WalkthroughSectionInput = {
  id?: string;
  walkthroughId: string;
  name?: string;
  areaName: string;
  sortOrder?: number;
  noteMode?: WalkthroughSectionNoteMode;
  photoAttachmentIds?: string[];
  audioNoteAttachmentId?: string;
  transcript?: string;
  typedNote?: string;
  sectionMeasurements?: SectionMeasurements;
  extractionStatus?: WalkthroughSectionExtractionStatus;
};

type RouteMeasurementInput = Omit<
  Partial<RouteMeasurement>,
  "walkthroughId" | "projectId" | "createdAt" | "updatedAt"
> & {
  walkthroughId: string;
  sourceLocation: string;
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(...parts: string[]) {
  return slugify(parts.filter(Boolean).join("-")).slice(0, 120);
}

function sortedSections(sections: WalkthroughSection[]) {
  return [...sections].sort((left, right) => {
    if (left.walkthroughId !== right.walkthroughId) {
      return left.walkthroughId.localeCompare(right.walkthroughId);
    }

    return left.sortOrder - right.sortOrder;
  });
}

function getWalkthroughOrThrow(project: ProjectRecord, walkthroughId: string) {
  const walkthrough = (project.walkthroughs ?? []).find(
    (item) => item.id === walkthroughId,
  );

  if (!walkthrough) {
    throw new Error(`Walkthrough ${walkthroughId} was not found on project ${project.id}.`);
  }

  return walkthrough;
}

function getSectionOrThrow(project: ProjectRecord, sectionId: string) {
  const section = (project.walkthroughSections ?? []).find(
    (item) => item.id === sectionId,
  );

  if (!section) {
    throw new Error(`Walkthrough section ${sectionId} was not found on project ${project.id}.`);
  }

  return section;
}

export function createWalkthrough(
  project: ProjectRecord,
  input: WalkthroughInput = {},
) {
  const currentTime = nowIso();
  const id = input.id ?? makeId(project.id, "walkthrough", currentTime);
  const existing = (project.walkthroughs ?? []).find((item) => item.id === id);
  const walkthrough: Walkthrough = {
    id,
    projectId: project.id,
    sessionId: input.sessionId ?? existing?.sessionId,
    status: input.status ?? existing?.status ?? "draft",
    noteModeDefault: input.noteModeDefault ?? existing?.noteModeDefault ?? "mixed",
    createdAt: existing?.createdAt ?? currentTime,
    updatedAt: currentTime,
  };

  return {
    ...project,
    updatedAt: currentTime,
    intakeStatus: project.intakeStatus ?? "saved",
    walkthroughs: [
      walkthrough,
      ...(project.walkthroughs ?? []).filter((item) => item.id !== id),
    ],
    walkthroughSections: project.walkthroughSections ?? [],
    routeMeasurements: project.routeMeasurements ?? [],
  };
}

export function updateWalkthrough(
  project: ProjectRecord,
  walkthroughId: string,
  input: Partial<Omit<Walkthrough, "id" | "projectId" | "createdAt" | "updatedAt">>,
) {
  getWalkthroughOrThrow(project, walkthroughId);

  const currentTime = nowIso();

  return {
    ...project,
    updatedAt: currentTime,
    walkthroughs: (project.walkthroughs ?? []).map((walkthrough) =>
      walkthrough.id === walkthroughId
        ? {
            ...walkthrough,
            sessionId: input.sessionId ?? walkthrough.sessionId,
            status: input.status ?? walkthrough.status,
            noteModeDefault: input.noteModeDefault ?? walkthrough.noteModeDefault,
            updatedAt: currentTime,
          }
        : walkthrough,
    ),
  };
}

export function upsertWalkthroughSection(
  project: ProjectRecord,
  input: WalkthroughSectionInput,
) {
  getWalkthroughOrThrow(project, input.walkthroughId);

  const currentTime = nowIso();
  const currentSections = project.walkthroughSections ?? [];
  const id =
    input.id ??
    makeId(project.id, input.walkthroughId, input.areaName || input.name || currentTime);
  const existing = currentSections.find((section) => section.id === id);
  const section: WalkthroughSection = {
    id,
    walkthroughId: input.walkthroughId,
    projectId: project.id,
    name: input.name ?? input.areaName,
    areaName: input.areaName,
    sortOrder:
      input.sortOrder ??
      existing?.sortOrder ??
      currentSections.filter((item) => item.walkthroughId === input.walkthroughId).length,
    noteMode: input.noteMode ?? existing?.noteMode ?? "text",
    photoAttachmentIds: input.photoAttachmentIds ?? existing?.photoAttachmentIds ?? [],
    audioNoteAttachmentId:
      input.audioNoteAttachmentId ?? existing?.audioNoteAttachmentId,
    transcript: input.transcript ?? existing?.transcript,
    typedNote: input.typedNote ?? existing?.typedNote,
    sectionMeasurements:
      input.sectionMeasurements ?? existing?.sectionMeasurements,
    extractionStatus:
      input.extractionStatus ?? existing?.extractionStatus ?? "not_started",
    createdAt: existing?.createdAt ?? currentTime,
    updatedAt: currentTime,
  };

  return {
    ...project,
    updatedAt: currentTime,
    walkthroughSections: sortedSections([
      section,
      ...currentSections.filter((item) => item.id !== id),
    ]),
  };
}

export function attachAttachmentToWalkthroughSection(
  project: ProjectRecord,
  input: {
    walkthroughId: string;
    sectionId: string;
    attachment: Attachment;
    replaceAttachmentId?: string;
  },
) {
  const section = getSectionOrThrow(project, input.sectionId);

  if (section.walkthroughId !== input.walkthroughId) {
    throw new Error("Section does not belong to the requested walkthrough.");
  }

  const currentTime = nowIso();
  const withoutReplacedPhotoId = section.photoAttachmentIds.filter(
    (attachmentId) => attachmentId !== input.replaceAttachmentId,
  );
  const nextSection =
    input.attachment.kind === "section_photo"
      ? {
          ...section,
          photoAttachmentIds: [
            ...withoutReplacedPhotoId,
            input.attachment.id,
          ].filter((value, index, values) => values.indexOf(value) === index),
          updatedAt: currentTime,
        }
      : input.attachment.kind === "section_audio_note"
        ? {
            ...section,
            audioNoteAttachmentId: input.attachment.id,
            updatedAt: currentTime,
          }
        : section;

  return {
    ...project,
    updatedAt: currentTime,
    walkthroughSections: (project.walkthroughSections ?? []).map((current) =>
      current.id === section.id ? nextSection : current,
    ),
  };
}

export function removeAttachmentFromWalkthroughSections(
  project: ProjectRecord,
  attachmentId: string,
) {
  const currentTime = nowIso();
  const sections = project.walkthroughSections ?? [];

  if (sections.length === 0) {
    return project;
  }

  return {
    ...project,
    updatedAt: currentTime,
    walkthroughSections: sections.map((section) => ({
      ...section,
      photoAttachmentIds: section.photoAttachmentIds.filter((id) => id !== attachmentId),
      audioNoteAttachmentId:
        section.audioNoteAttachmentId === attachmentId
          ? undefined
          : section.audioNoteAttachmentId,
      updatedAt:
        section.photoAttachmentIds.includes(attachmentId) ||
        section.audioNoteAttachmentId === attachmentId
          ? currentTime
          : section.updatedAt,
    })),
  };
}

export function saveRouteMeasurement(
  project: ProjectRecord,
  input: RouteMeasurementInput,
) {
  getWalkthroughOrThrow(project, input.walkthroughId);

  const currentTime = nowIso();
  const id =
    input.id ??
    makeId(project.id, input.walkthroughId, "route", input.sourceLocation, currentTime);
  const existing = (project.routeMeasurements ?? []).find((item) => item.id === id);
  const routeMeasurement: RouteMeasurement = {
    id,
    walkthroughId: input.walkthroughId,
    projectId: project.id,
    sourceLocation: input.sourceLocation,
    destinationSectionId:
      input.destinationSectionId ?? existing?.destinationSectionId,
    destinationDescription:
      input.destinationDescription ?? existing?.destinationDescription,
    routeType: input.routeType ?? existing?.routeType,
    measuredDistanceFt:
      input.measuredDistanceFt ?? existing?.measuredDistanceFt,
    routeClass: input.routeClass ?? existing?.routeClass,
    circuitAmpRating: input.circuitAmpRating ?? existing?.circuitAmpRating,
    requiresMeasuredDistance:
      input.requiresMeasuredDistance ?? existing?.requiresMeasuredDistance ?? true,
    requiresReview: input.requiresReview ?? existing?.requiresReview ?? true,
    notes: input.notes ?? existing?.notes,
    createdAt: existing?.createdAt ?? currentTime,
    updatedAt: currentTime,
  };

  return {
    ...project,
    updatedAt: currentTime,
    routeMeasurements: [
      routeMeasurement,
      ...(project.routeMeasurements ?? []).filter((item) => item.id !== id),
    ],
  };
}
