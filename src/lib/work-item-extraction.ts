import "server-only";

import type {
  Attachment,
  DetectedWorkItem,
  DetectedWorkItemPricingStatus,
  DetectedWorkItemReviewStatus,
  ExtractionStatus,
  PriceBookEntry,
  ProjectRecord,
  RouteMeasurement,
  SectionMeasurements,
  SuggestedPriceBookMatch,
  WalkthroughSection,
  WorkItemSourceType,
} from "@/lib/types";
import {
  getOpenAiVisionContentType,
  isHeicLikeFile,
  isSupportedPhotoFile,
} from "@/lib/media-types";
import { readStoredUpload } from "@/lib/upload-storage";
import { slugify } from "@/lib/utils";

const LOW_CONFIDENCE_THRESHOLD = 0.72;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

type VisionExtractionItem = {
  description: string;
  quantity: number;
  unit?: string;
  confidence: number;
  manualReview: boolean;
  area: string;
  priceBookKeywords: string[];
};

type VisionExtractionResult = {
  items: VisionExtractionItem[];
};

export type VisionExtractorInput = {
  attachment: Attachment;
  imageDataUrl: string;
  project: ProjectRecord;
  walkthroughId?: string;
  section?: WalkthroughSection;
  sectionAttachments?: Attachment[];
  sourceNoteText?: string;
  routeMeasurements?: RouteMeasurement[];
};

export type VisionExtractor = (
  input: VisionExtractorInput,
) => Promise<VisionExtractionItem[]>;

type ExtractDetectedWorkItemOptions = {
  visionExtractor?: VisionExtractor;
  readUpload?: typeof readStoredUpload;
};

type DetectedItemContext = {
  walkthroughId?: string;
  sectionId?: string;
  sectionName?: string;
  section?: WalkthroughSection;
  sourceAttachmentIds?: string[];
  sourceNoteText?: string;
  extractedMeasurements?: SectionMeasurements;
  routeMeasurements?: RouteMeasurement[];
};

function nowIso() {
  return new Date().toISOString();
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function normalizeQuantity(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Number(value.toFixed(2));
}

function uniqueStrings(values: (string | undefined)[]) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function compactText(values: (string | undefined)[]) {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function getSectionName(section: WalkthroughSection) {
  return section.areaName || section.name || "Walkthrough section";
}

function getSectionNoteText(section: WalkthroughSection) {
  return (section.typedNote?.trim() || section.transcript?.trim() || "").trim();
}

function getSectionPhotoAttachments(project: ProjectRecord, section: WalkthroughSection) {
  const photoIds = new Set(section.photoAttachmentIds);

  return project.attachments.filter((attachment) => photoIds.has(attachment.id));
}

function getSectionAudioAttachment(project: ProjectRecord, section: WalkthroughSection) {
  if (!section.audioNoteAttachmentId) {
    return undefined;
  }

  return project.attachments.find(
    (attachment) => attachment.id === section.audioNoteAttachmentId,
  );
}

function getRelatedRouteMeasurements(
  project: ProjectRecord,
  section: WalkthroughSection,
) {
  const sectionName = getSectionName(section).toLowerCase();

  return (project.routeMeasurements ?? []).filter((measurement) => {
    if (measurement.walkthroughId !== section.walkthroughId) {
      return false;
    }

    if (measurement.destinationSectionId === section.id) {
      return true;
    }

    return Boolean(
      measurement.destinationDescription?.toLowerCase().includes(sectionName),
    );
  });
}

function hasRouteMeasurementOrAllowance(routeMeasurements: RouteMeasurement[] = []) {
  return routeMeasurements.some(
    (measurement) =>
      (typeof measurement.measuredDistanceFt === "number" &&
        Number.isFinite(measurement.measuredDistanceFt) &&
        measurement.measuredDistanceFt > 0) ||
      measurement.requiresMeasuredDistance === false,
  );
}

function textMentionsRouteMeasurementNeed(text: string) {
  return /\b(home\s*run|homerun|dedicated\s+circuit|new\s+circuit|panel\s+to|from\s+panel|route|feeder)\b/i.test(
    text,
  );
}

function getMissingMeasurementPrompts(
  context: DetectedItemContext | undefined,
  itemText = "",
) {
  if (!context?.sectionId || !context.sectionName) {
    return [];
  }

  const combinedText = compactText([context.sourceNoteText, itemText]);

  if (
    !textMentionsRouteMeasurementNeed(combinedText) ||
    hasRouteMeasurementOrAllowance(context.routeMeasurements)
  ) {
    return [];
  }

  return [
    `Confirm route allowance or measured distance from panel to ${context.sectionName} section.`,
  ];
}

function isOpenAiVisionCandidate(attachment: Attachment) {
  return (
    (attachment.kind === "photo" || attachment.kind === "section_photo") &&
    Boolean(attachment.storageKey) &&
    !isHeicLikeFile({
      contentType: attachment.contentType,
      fileName: attachment.name,
    }) &&
    Boolean(
      getOpenAiVisionContentType({
        contentType: attachment.contentType,
        fileName: attachment.name,
      }),
    )
  );
}

function findSuggestedPriceBookMatch(
  priceBook: PriceBookEntry[],
  keywords: string[],
  description: string,
): SuggestedPriceBookMatch | undefined {
  const normalizedKeywords = [...keywords, description]
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9/]+/i))
    .filter((value) => value.length > 2);
  let bestMatch: PriceBookEntry | undefined;
  let bestScore = 0;

  for (const entry of priceBook) {
    const haystack = `${entry.name} ${entry.description} ${entry.category}`.toLowerCase();
    const score = normalizedKeywords.reduce(
      (total, keyword) => total + (haystack.includes(keyword) ? 1 : 0),
      0,
    );

    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestMatch
    ? {
        id: bestMatch.id,
        name: bestMatch.name,
        category: bestMatch.category,
        sourceLabel: bestMatch.sourceLabel,
      }
    : undefined;
}

function buildDetectedItem(input: {
  projectId: string;
  walkthroughId?: string;
  sectionId?: string;
  sectionName?: string;
  description: string;
  quantity: number;
  unit?: string;
  confidence: number;
  sourceType: WorkItemSourceType;
  sourceAttachmentId?: string;
  sourceAttachmentIds?: string[];
  sourcePath: string;
  sourceNoteText?: string;
  extractedMeasurements?: SectionMeasurements;
  missingMeasurementPrompts?: string[];
  suggestedPriceBookMatch?: SuggestedPriceBookMatch;
  manualReview?: boolean;
  requiresReview?: boolean;
  reviewStatus?: DetectedWorkItemReviewStatus;
  pricingStatus?: DetectedWorkItemPricingStatus;
  extractionNotes?: string;
  extractionRequiresConversion?: boolean;
}) {
  const confidence = clampConfidence(input.confidence);
  const missingMeasurementPrompts = input.missingMeasurementPrompts ?? [];
  const manualReview =
    input.manualReview === true ||
    confidence < LOW_CONFIDENCE_THRESHOLD ||
    missingMeasurementPrompts.length > 0;
  const idParts = [
    input.projectId,
    input.walkthroughId,
    input.sectionId,
    input.sourceAttachmentId ?? input.sourceType,
    input.description,
  ];
  const sourceAttachmentIds =
    input.sourceAttachmentIds ??
    (input.sourceAttachmentId ? [input.sourceAttachmentId] : undefined);

  return {
    id: slugify(idParts.join("-")).slice(0, 120),
    walkthroughId: input.walkthroughId,
    sectionId: input.sectionId,
    sectionName: input.sectionName,
    description: input.description,
    quantity: normalizeQuantity(input.quantity),
    unit: input.unit ?? "Each",
    confidence,
    sourceType: input.sourceType,
    sourceAttachmentId: input.sourceAttachmentId,
    sourceAttachmentIds,
    sourcePath: input.sourcePath,
    sourceNoteText: input.sourceNoteText,
    extractedMeasurements: input.extractedMeasurements,
    missingMeasurementPrompts,
    manualReview,
    requiresReview: input.requiresReview ?? true,
    reviewStatus: input.reviewStatus ?? "pending",
    pricingStatus:
      missingMeasurementPrompts.length > 0
        ? "blocked_missing_measurement"
        : (input.pricingStatus ?? "not_ready"),
    suggestedPriceBookMatch: input.suggestedPriceBookMatch,
    extractionNotes: input.extractionNotes,
    extractionRequiresConversion: input.extractionRequiresConversion,
    detectedAt: nowIso(),
  } satisfies DetectedWorkItem;
}

function typedNotesItem(project: ProjectRecord, priceBook: PriceBookEntry[]) {
  const text = [project.scopeDescription, ...project.notes].filter(Boolean).join("\n\n");

  if (!text.trim()) {
    return undefined;
  }

  return buildDetectedItem({
    projectId: project.id,
    description: text.slice(0, 240),
    quantity: 1,
    confidence: 0.56,
    sourceType: "typed_notes",
    sourcePath: project.id,
    manualReview: true,
    suggestedPriceBookMatch: findSuggestedPriceBookMatch(priceBook, [], text),
    extractionNotes:
      "Typed notes were captured as a review item. Human review must confirm exact scope and quantities before pricing.",
  });
}

function unsupportedAttachmentItem(
  project: ProjectRecord,
  attachment: Attachment,
  priceBook: PriceBookEntry[],
  reason: string,
  options: { extractionRequiresConversion?: boolean } = {},
  context?: DetectedItemContext,
) {
  const sourceType: WorkItemSourceType =
    attachment.kind === "section_photo"
      ? "photo"
      : attachment.kind === "section_audio_note" ||
          attachment.kind === "general_attachment" ||
          attachment.kind === "note"
        ? "note"
        : attachment.kind;

  return buildDetectedItem({
    projectId: project.id,
    walkthroughId: context?.walkthroughId,
    sectionId: context?.sectionId,
    sectionName: context?.sectionName,
    description: reason,
    quantity: 1,
    confidence: 0,
    sourceType,
    sourceAttachmentId: attachment.id,
    sourceAttachmentIds: context?.sourceAttachmentIds ?? [attachment.id],
    sourcePath: attachment.storageKey ?? attachment.previewUrl ?? attachment.name,
    sourceNoteText: context?.sourceNoteText,
    extractedMeasurements: context?.extractedMeasurements,
    missingMeasurementPrompts: getMissingMeasurementPrompts(context, reason),
    manualReview: true,
    requiresReview: true,
    suggestedPriceBookMatch: findSuggestedPriceBookMatch(priceBook, [], attachment.name),
    extractionNotes: "This attachment was not auto-extracted and must be reviewed manually.",
    extractionRequiresConversion: options.extractionRequiresConversion,
  });
}

function mapVisionItem(
  project: ProjectRecord,
  attachment: Attachment,
  item: VisionExtractionItem,
  priceBook: PriceBookEntry[],
  context?: DetectedItemContext,
) {
  const missingMeasurementPrompts = getMissingMeasurementPrompts(
    context,
    item.description,
  );

  return buildDetectedItem({
    projectId: project.id,
    walkthroughId: context?.walkthroughId,
    sectionId: context?.sectionId,
    sectionName: context?.sectionName,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    confidence: item.confidence,
    sourceType: "photo",
    sourceAttachmentId: attachment.id,
    sourceAttachmentIds: context?.sourceAttachmentIds ?? [attachment.id],
    sourcePath: attachment.storageKey ?? attachment.previewUrl ?? attachment.name,
    sourceNoteText: context?.sourceNoteText,
    extractedMeasurements: context?.extractedMeasurements,
    missingMeasurementPrompts,
    manualReview: item.manualReview,
    requiresReview: true,
    suggestedPriceBookMatch: findSuggestedPriceBookMatch(
      priceBook,
      item.priceBookKeywords,
      item.description,
    ),
    extractionNotes: item.area ? `Detected area: ${item.area}` : undefined,
  });
}

export function getResponseOutputText(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "output_text" in payload &&
    typeof payload.output_text === "string"
  ) {
    return payload.output_text;
  }

  if (!payload || typeof payload !== "object" || !("output" in payload)) {
    return "";
  }

  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) =>
      item && typeof item === "object" && "content" in item
        ? Array.isArray((item as { content?: unknown }).content)
          ? (item as { content?: unknown[] }).content
          : []
        : [],
    )
    .map((content) =>
      content &&
      typeof content === "object" &&
      "text" in content &&
      typeof content.text === "string"
        ? content.text
        : "",
    )
    .join("");
}

export function buildOpenAiVisionRequest(input: VisionExtractorInput) {
  const sectionLines = input.section
    ? [
        `Walkthrough id: ${input.section.walkthroughId}`,
        `Section id: ${input.section.id}`,
        `Section name: ${getSectionName(input.section)}`,
        `Section note mode: ${input.section.noteMode}`,
        `Section notes/transcript: ${input.sourceNoteText || "None provided"}`,
        `Section measurements: ${
          input.section.sectionMeasurements
            ? JSON.stringify(input.section.sectionMeasurements)
            : "None provided"
        }`,
        `Section photo attachment ids: ${
          input.sectionAttachments?.map((attachment) => attachment.id).join(", ") ||
          input.attachment.id
        }`,
        `Related route measurements: ${
          input.routeMeasurements?.length
            ? JSON.stringify(input.routeMeasurements)
            : "None provided"
        }`,
      ]
    : [];

  return {
    model: process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Extract electrical work items from this field intake photo as JSON.",
              "Only describe visible or clearly inferable electrical scope.",
              "Use conservative quantities. Mark manualReview true unless the photo clearly confirms scope and quantity.",
              `Customer: ${input.project.customer.name}`,
              `Project notes: ${input.project.scopeDescription}`,
              `Attachment id: ${input.attachment.id}`,
              ...sectionLines,
            ].join("\n"),
          },
          {
            type: "input_image",
            image_url: input.imageDataUrl,
            detail: "high",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "grizzly_work_item_extraction",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "description",
                  "quantity",
                  "confidence",
                  "manualReview",
                  "area",
                  "priceBookKeywords",
                ],
                properties: {
                  description: { type: "string" },
                  quantity: { type: "number" },
                  confidence: { type: "number" },
                  manualReview: { type: "boolean" },
                  area: { type: "string" },
                  priceBookKeywords: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

async function openAiVisionExtractor(input: VisionExtractorInput) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildOpenAiVisionRequest(input)),
  });

  const payload = (await response.json().catch(() => ({}))) as unknown;

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : "OpenAI vision extraction failed.";
    throw new Error(message);
  }

  const outputText = getResponseOutputText(payload);
  const parsed = JSON.parse(outputText || '{"items":[]}') as VisionExtractionResult;
  return parsed.items;
}

async function extractPhotoItems(
  project: ProjectRecord,
  attachment: Attachment,
  priceBook: PriceBookEntry[],
  options: ExtractDetectedWorkItemOptions,
  context?: DetectedItemContext,
) {
  if (isHeicLikeFile({ contentType: attachment.contentType, fileName: attachment.name })) {
    return [
      unsupportedAttachmentItem(
        project,
        attachment,
        priceBook,
        `Photo ${attachment.name} is saved as HEIC/HEIF. Upload is accepted and the original file remains stored, but AI extraction requires JPEG conversion before analysis. Review this photo manually for now.`,
        { extractionRequiresConversion: true },
        context,
      ),
    ];
  }

  if (!attachment.storageKey) {
    return [
      unsupportedAttachmentItem(
        project,
        attachment,
        priceBook,
        `Photo ${attachment.name} has no storage path and must be reviewed manually.`,
        {},
        context,
      ),
    ];
  }

  const readUpload = options.readUpload ?? readStoredUpload;
  const stored = await readUpload(attachment.storageKey.split("/"));

  if (!stored) {
    return [
      unsupportedAttachmentItem(
        project,
        attachment,
        priceBook,
        `Photo ${attachment.name} could not be read from storage and must be reviewed manually.`,
        {},
        context,
      ),
    ];
  }

  const visionContentType = getOpenAiVisionContentType({
    contentType: stored.contentType,
    fileName: attachment.name,
  });

  if (!visionContentType) {
    return [
      unsupportedAttachmentItem(
        project,
        attachment,
        priceBook,
        `Photo ${attachment.name} is saved, but this image format is not supported by AI extraction yet. Review it manually before estimating.`,
        {},
        context,
      ),
    ];
  }

  const imageDataUrl = `data:${visionContentType};base64,${stored.file.toString("base64")}`;
  const visionExtractor = options.visionExtractor ?? openAiVisionExtractor;

  try {
    const visionItems = await visionExtractor({
      attachment,
      imageDataUrl,
      project,
      walkthroughId: context?.walkthroughId,
      section: context?.section,
      sectionAttachments: context?.section
        ? getSectionPhotoAttachments(project, context.section)
        : undefined,
      sourceNoteText: context?.sourceNoteText,
      routeMeasurements: context?.routeMeasurements,
    });

    return visionItems.map((item) =>
      mapVisionItem(project, attachment, item, priceBook, context),
    );
  } catch (error) {
    return [
      unsupportedAttachmentItem(
        project,
        attachment,
        priceBook,
        `Photo ${attachment.name} could not be auto-extracted: ${
          error instanceof Error ? error.message : "Unknown extraction error."
        }`,
        {},
        context,
      ),
    ];
  }
}

function buildSectionContext(
  project: ProjectRecord,
  section: WalkthroughSection,
): DetectedItemContext {
  const photoAttachments = getSectionPhotoAttachments(project, section);
  const audioAttachment = getSectionAudioAttachment(project, section);
  const sourceAttachmentIds = uniqueStrings([
    ...photoAttachments.map((attachment) => attachment.id),
    audioAttachment?.id,
  ]);

  return {
    walkthroughId: section.walkthroughId,
    sectionId: section.id,
    sectionName: getSectionName(section),
    section,
    sourceAttachmentIds,
    sourceNoteText: getSectionNoteText(section) || undefined,
    extractedMeasurements: section.sectionMeasurements,
    routeMeasurements: getRelatedRouteMeasurements(project, section),
  };
}

function buildSectionNotesItem(
  project: ProjectRecord,
  section: WalkthroughSection,
  priceBook: PriceBookEntry[],
  context: DetectedItemContext,
) {
  const noteText = context.sourceNoteText;

  if (!noteText) {
    return undefined;
  }

  const missingMeasurementPrompts = getMissingMeasurementPrompts(context, noteText);

  return buildDetectedItem({
    projectId: project.id,
    walkthroughId: section.walkthroughId,
    sectionId: section.id,
    sectionName: getSectionName(section),
    description: noteText.slice(0, 240),
    quantity: 1,
    unit: "Each",
    confidence: 0.58,
    sourceType: section.noteMode === "voice" ? "note" : "typed_notes",
    sourceAttachmentId: section.audioNoteAttachmentId,
    sourceAttachmentIds: context.sourceAttachmentIds,
    sourcePath: section.audioNoteAttachmentId ?? section.id,
    sourceNoteText: noteText,
    extractedMeasurements: section.sectionMeasurements,
    missingMeasurementPrompts,
    manualReview: true,
    requiresReview: true,
    suggestedPriceBookMatch: findSuggestedPriceBookMatch(priceBook, [], noteText),
    extractionNotes:
      section.noteMode === "voice"
        ? "Voice transcript was captured as a section review item. Human review must confirm exact scope and quantities before pricing."
        : "Typed section notes were captured as a section review item. Human review must confirm exact scope and quantities before pricing.",
  });
}

async function extractWalkthroughSectionItems(
  project: ProjectRecord,
  section: WalkthroughSection,
  priceBook: PriceBookEntry[],
  options: ExtractDetectedWorkItemOptions,
) {
  const sectionItems: DetectedWorkItem[] = [];
  const photoAttachments = getSectionPhotoAttachments(project, section);
  const audioAttachment = getSectionAudioAttachment(project, section);
  const context = buildSectionContext(project, section);
  let producedDirectVisionItem = false;

  for (const attachment of photoAttachments) {
    if (
      isSupportedPhotoFile({
        contentType: attachment.contentType,
        fileName: attachment.name,
      })
    ) {
      const beforeCount = sectionItems.length;
      sectionItems.push(
        ...(await extractPhotoItems(project, attachment, priceBook, options, context)),
      );
      producedDirectVisionItem =
        producedDirectVisionItem ||
        sectionItems
          .slice(beforeCount)
          .some((item) => !item.extractionRequiresConversion && item.confidence > 0);
      continue;
    }

    sectionItems.push(
      unsupportedAttachmentItem(
        project,
        attachment,
        priceBook,
        `Section photo ${attachment.name} is saved, but this image format is not supported by AI extraction yet. Review it manually before estimating.`,
        {},
        context,
      ),
    );
  }

  const notesItem = buildSectionNotesItem(project, section, priceBook, context);

  if (notesItem && (!producedDirectVisionItem || photoAttachments.length === 0)) {
    sectionItems.push(notesItem);
  }

  if (audioAttachment && !context.sourceNoteText) {
    sectionItems.push(
      unsupportedAttachmentItem(
        project,
        audioAttachment,
        priceBook,
        `Section audio note ${audioAttachment.name} is saved, but no transcript is available yet. Review this audio note manually before estimating.`,
        {},
        context,
      ),
    );
  }

  if (sectionItems.length === 0) {
    sectionItems.push(
      buildDetectedItem({
        projectId: project.id,
        walkthroughId: section.walkthroughId,
        sectionId: section.id,
        sectionName: getSectionName(section),
        description: `Walkthrough section ${getSectionName(
          section,
        )} has no photos or notes available for AI extraction yet.`,
        quantity: 1,
        confidence: 0,
        sourceType: "typed_notes",
        sourceAttachmentIds: context.sourceAttachmentIds,
        sourcePath: section.id,
        manualReview: true,
        requiresReview: true,
        extractionNotes:
          "Save section photos, typed notes, or a transcript before using this section for estimating.",
      }),
    );
  }

  return sectionItems;
}

function buildExtractionStatus(
  items: DetectedWorkItem[],
  openAiCandidateAttachments: Attachment[],
  options: ExtractDetectedWorkItemOptions,
): ExtractionStatus {
  const hasManualReviewItems = items.some(
    (item) => item.manualReview || item.requiresReview,
  );
  const needsOpenAiConfiguration =
    openAiCandidateAttachments.length > 0 &&
    !options.visionExtractor &&
    !process.env.OPENAI_API_KEY?.trim();

  return {
    status:
      items.length === 0
        ? "failed"
        : needsOpenAiConfiguration
          ? "needs_configuration"
          : hasManualReviewItems
            ? "partial"
            : "complete",
    message:
      items.length === 0
        ? "No work items could be extracted from the saved intake."
        : needsOpenAiConfiguration
          ? "OpenAI photo extraction is not configured. Saved inputs remain available for manual review."
        : "Detected work items are ready for human review. Nothing has been priced.",
    updatedAt: nowIso(),
  };
}

export async function extractDetectedWorkItems(
  project: ProjectRecord,
  priceBook: PriceBookEntry[],
  options: ExtractDetectedWorkItemOptions = {},
) {
  const items: DetectedWorkItem[] = [];
  const walkthroughSections = [...(project.walkthroughSections ?? [])].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );

  if (walkthroughSections.length > 0) {
    for (const section of walkthroughSections) {
      items.push(
        ...(await extractWalkthroughSectionItems(project, section, priceBook, options)),
      );
    }

    const sectionPhotoIds = new Set(
      walkthroughSections.flatMap((section) => section.photoAttachmentIds),
    );
    const openAiCandidateAttachments = project.attachments.filter(
      (attachment) =>
        sectionPhotoIds.has(attachment.id) && isOpenAiVisionCandidate(attachment),
    );

    return {
      items,
      status: buildExtractionStatus(items, openAiCandidateAttachments, options),
    };
  }

  const notesItem = typedNotesItem(project, priceBook);

  if (notesItem) {
    items.push(notesItem);
  }

  for (const attachment of project.attachments) {
    if (
      attachment.kind === "photo" &&
      isSupportedPhotoFile({
        contentType: attachment.contentType,
        fileName: attachment.name,
      })
    ) {
      items.push(...(await extractPhotoItems(project, attachment, priceBook, options)));
      continue;
    }

    if (attachment.kind === "section_photo") {
      items.push(
        unsupportedAttachmentItem(
          project,
          attachment,
          priceBook,
          `Section photo ${attachment.name} is saved to the walkthrough section. Section-based extraction is not implemented yet, so review this photo manually before estimating.`,
        ),
      );
      continue;
    }

    if (attachment.kind === "section_audio_note") {
      items.push(
        unsupportedAttachmentItem(
          project,
          attachment,
          priceBook,
          `Section audio note ${attachment.name} is saved to the walkthrough section. Audio extraction is not implemented yet, so review this note manually before estimating.`,
        ),
      );
      continue;
    }

    if (attachment.kind === "general_attachment") {
      items.push(
        unsupportedAttachmentItem(
          project,
          attachment,
          priceBook,
          `Attachment ${attachment.name} is saved, but generic attachment extraction is not implemented yet.`,
        ),
      );
      continue;
    }

    if (attachment.kind === "video") {
      items.push(
        unsupportedAttachmentItem(
          project,
          attachment,
          priceBook,
          `Video ${attachment.name} is saved, but frame extraction is not implemented yet. Review this walkthrough video manually before estimating.`,
        ),
      );
      continue;
    }

    if (attachment.kind === "note") {
      items.push(
        unsupportedAttachmentItem(
          project,
          attachment,
          priceBook,
          `Note attachment ${attachment.name} is saved, but document text extraction is not implemented yet.`,
        ),
      );
    }
  }

  const status = buildExtractionStatus(
    items,
    project.attachments.filter(
      (attachment) => attachment.kind === "photo" && isOpenAiVisionCandidate(attachment),
    ),
    options,
  );

  return { items, status };
}
