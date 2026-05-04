export type ProjectType = "residential" | "commercial";

export type ProjectSubtype =
  | "full_remodel"
  | "circuit_add"
  | "receptacle_add"
  | "lighting_install"
  | "fan_replace";

export type PropertyType =
  | "single_family"
  | "townhome"
  | "office"
  | "retail"
  | "restaurant";

export type AttachmentKind =
  | "video"
  | "blueprint"
  | "note"
  | "photo"
  | "section_photo"
  | "section_audio_note"
  | "general_attachment";

export type UploadStatus = "queued" | "uploading" | "complete" | "retrying" | "failed";

export type LineItemSource = "price_book" | "ai_fallback";

export type LineItemStatus = "verified" | "best_guess" | "review_required";

export type ProposalStyle = "hcp" | "premium";

export type ReviewStatus = "ready_for_owner_review" | "owner_review_required";

export type ProposalWorkflowStatus =
  | "intake_draft"
  | "owner_review_pending"
  | "sent_to_customer"
  | "customer_approved";

export type IntakeStatus = "draft" | "saved" | "ready_for_estimate";

export type NotificationType = "owner_approval" | "customer_send";

export type NotificationDeliveryState = "ready" | "queued" | "sent" | "failed";

export type WalkthroughStatus =
  | "draft"
  | "ready_for_extraction"
  | "extracted"
  | "reviewed";

export type WalkthroughNoteMode = "voice" | "text" | "mixed";

export type WalkthroughSectionNoteMode = "voice" | "text";

export type WalkthroughSectionExtractionStatus =
  | "not_started"
  | "pending"
  | "complete"
  | "failed";

export type RouteType = "attic" | "crawlspace" | "exterior" | "interior" | "unknown";

export type RouteClass = "home_run" | "branch_extension" | "fixture_drop" | "unknown";

export interface NotificationChannelState {
  email: NotificationDeliveryState;
  sms: NotificationDeliveryState;
}

export type IntegrationStatus =
  | "ready"
  | "queued"
  | "synced"
  | "matched_duplicate"
  | "review_required"
  | "failed";

export interface PriceBookEntry {
  id: string;
  category: string;
  name: string;
  description: string;
  price: number;
  cost: number;
  sourceLabel: string;
}

export type WorkItemSourceType =
  | "photo"
  | "video"
  | "typed_notes"
  | "note"
  | "blueprint";

export type DetectedWorkItemReviewStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "edited";

export type DetectedWorkItemPricingStatus =
  | "not_ready"
  | "ready_after_review"
  | "blocked_missing_measurement";

export interface SuggestedPriceBookMatch {
  id: string;
  name: string;
  category: string;
  sourceLabel: string;
}

export interface DetectedWorkItem {
  id: string;
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
  manualReview: boolean;
  requiresReview?: boolean;
  reviewStatus: DetectedWorkItemReviewStatus;
  pricingStatus?: DetectedWorkItemPricingStatus;
  suggestedPriceBookMatch?: SuggestedPriceBookMatch;
  extractionNotes?: string;
  extractionRequiresConversion?: boolean;
  detectedAt: string;
}

export interface ExtractionStatus {
  status: "not_started" | "needs_configuration" | "partial" | "complete" | "failed";
  message: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  sizeLabel: string;
  uploadStatus: UploadStatus;
  progress: number;
  previewUrl?: string;
  storageKey?: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedAt?: string;
  errorMessage?: string;
  projectId?: string;
  walkthroughId?: string;
  sectionId?: string;
}

export interface SectionMeasurements {
  ceilingHeightFt?: number;
  wallLengthFt?: number;
  roomLengthFt?: number;
  roomWidthFt?: number;
  notes?: string;
}

export interface Walkthrough {
  id: string;
  projectId: string;
  sessionId?: string;
  status: WalkthroughStatus;
  noteModeDefault: WalkthroughNoteMode;
  createdAt: string;
  updatedAt: string;
}

export interface WalkthroughSection {
  id: string;
  walkthroughId: string;
  projectId: string;
  name: string;
  areaName: string;
  sortOrder: number;
  noteMode: WalkthroughSectionNoteMode;
  photoAttachmentIds: string[];
  audioNoteAttachmentId?: string;
  transcript?: string;
  typedNote?: string;
  sectionMeasurements?: SectionMeasurements;
  extractionStatus: WalkthroughSectionExtractionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RouteMeasurement {
  id: string;
  walkthroughId: string;
  projectId: string;
  sourceLocation: string;
  destinationSectionId?: string;
  destinationDescription?: string;
  routeType?: RouteType;
  measuredDistanceFt?: number;
  routeClass?: RouteClass;
  circuitAmpRating?: number;
  requiresMeasuredDistance: boolean;
  requiresReview: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptSegment {
  id: string;
  speaker: string;
  timestamp: string;
  text: string;
}

export interface RequestedAction {
  id: string;
  area: string;
  label: string;
  quantity: number;
  needsMeasurement?: boolean;
  feet?: number;
  amps?: number;
  ownerProvided?: boolean;
  keywords?: string[];
}

export interface CapturePrompt {
  id: string;
  area: string;
  question: string;
  context: string;
  severity: "info" | "warning" | "critical";
  dismissible: boolean;
}

export interface EstimateLineItem {
  id: string;
  area: string;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  materialCost: number;
  sellPrice: number;
  laborHours: number;
  confidence: number;
  status: LineItemStatus;
  source: LineItemSource;
}

export interface EstimateAreaGroup {
  area: string;
  lineItems: EstimateLineItem[];
  subtotal: number;
  totalLaborHours: number;
}

export interface EstimateDraft {
  areaGroups: EstimateAreaGroup[];
  lineItems: EstimateLineItem[];
  materialTotal: number;
  totalLaborHours: number;
  laborRate: number;
  grandTotal: number;
  averageConfidence: number;
  reviewStatus: ReviewStatus;
}

export interface ProposalVariant {
  style: ProposalStyle;
  title: string;
  intro: string;
  bulletHighlights: string[];
  depositRequired: boolean;
  depositAmount: number;
  sharePath: string;
  lastExportedAt?: string;
}

export interface IntegrationSync {
  system:
    | "housecall-pro"
    | "supplier-email"
    | "home-depot-cart"
    | "owner-approval-email"
    | "owner-approval-text"
    | "customer-proposal-email"
    | "customer-proposal-text"
    | "approval-notification-email";
  status: IntegrationStatus;
  message: string;
  updatedAt: string;
  remoteId?: string;
  retryable?: boolean;
  recoveryAction?: string;
  operation?: string;
  customerId?: string;
  estimateId?: string;
  jobId?: string;
}

export interface HousecallProSyncState {
  customerId?: string;
  customerAddressId?: string;
  estimateId?: string;
  jobId?: string;
  customerFingerprint?: string;
  estimateFingerprint?: string;
  jobFingerprint?: string;
  attachmentFingerprint?: string;
  lastSyncKey?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  retryCount?: number;
}

export interface ProjectIntegrationState {
  housecallPro?: HousecallProSyncState;
}

export interface NotificationDeliveryStatus {
  status: NotificationDeliveryState;
  lastUpdatedAt: string;
  message: string;
  lastAttemptAt?: string;
  lastFingerprint?: string;
  channels?: NotificationChannelState;
}

export interface ProjectNotificationStatus {
  status: NotificationDeliveryState;
  lastUpdatedAt: string;
  type?: NotificationType;
}

export interface ProposalApprovalSignature {
  signedByName: string;
  signedByEmail: string;
  signatureText: string;
  signedAt: string;
  ipAddress?: string;
}

export interface ProposalWorkflowState {
  status: ProposalWorkflowStatus;
  activeStyle: ProposalStyle;
  ownerReviewRequestedAt: string;
  ownerReviewNotifiedAt?: string;
  ownerReviewNotificationFingerprint?: string;
  ownerReviewEmailSentFingerprint?: string;
  ownerReviewSmsSentFingerprint?: string;
  ownerApprovedAt?: string;
  ownerApprovedByEmail?: string;
  customerSentAt?: string;
  customerSentByEmail?: string;
  customerDeliveryFingerprint?: string;
  customerEmailSentFingerprint?: string;
  customerSmsSentFingerprint?: string;
  customerApprovedAt?: string;
  customerSignature?: ProposalApprovalSignature;
}

export interface CustomerSummary {
  name: string;
  email?: string;
  phone?: string;
  address: string;
  company?: string;
}

export interface ProjectIntakeInput {
  id: string;
  title: string;
  customer: CustomerSummary;
  propertyType: PropertyType;
  projectType: ProjectType;
  projectSubtype: ProjectSubtype;
  scopeDescription: string;
  blueprintIncluded: boolean;
  notes: string[];
  attachments: Attachment[];
  transcriptSegments: TranscriptSegment[];
  requestedActions: RequestedAction[];
}

export interface ProjectRecord extends ProjectIntakeInput {
  createdAt: string;
  updatedAt?: string;
  createdByEmail?: string;
  intakeStatus?: IntakeStatus;
  estimateDraft: EstimateDraft;
  proposalVariants: ProposalVariant[];
  proposalWorkflow: ProposalWorkflowState;
  notificationStatus: ProjectNotificationStatus;
  ownerApprovalStatus: NotificationDeliveryStatus;
  customerSendStatus: NotificationDeliveryStatus;
  customerProposalEmailStatus: NotificationDeliveryState;
  customerProposalEmailLastAttemptAt?: string;
  customerProposalEmailError?: string;
  lastNotificationAttemptAt?: string;
  integrationSyncs: IntegrationSync[];
  integrationState?: ProjectIntegrationState;
  walkthroughs?: Walkthrough[];
  walkthroughSections?: WalkthroughSection[];
  routeMeasurements?: RouteMeasurement[];
  detectedWorkItems?: DetectedWorkItem[];
  extractionStatus?: ExtractionStatus;
  capturePrompts: CapturePrompt[];
  analysisSummary: string[];
  opsNextSteps: string[];
}

export interface DashboardStat {
  label: string;
  value: string;
  detail: string;
}

export interface DashboardData {
  projects: ProjectRecord[];
  stats: DashboardStat[];
  priceBookPreview: PriceBookEntry[];
  lastUpdated: string;
}
