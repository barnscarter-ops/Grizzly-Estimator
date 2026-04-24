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

export type AttachmentKind = "video" | "blueprint" | "note" | "photo";

export type UploadStatus = "queued" | "uploading" | "complete" | "retrying";

export type LineItemSource = "price_book" | "ai_fallback";

export type LineItemStatus = "verified" | "best_guess" | "review_required";

export type ProposalStyle = "hcp" | "premium";

export type ReviewStatus = "ready_for_owner_review" | "owner_review_required";

export type ProposalWorkflowStatus =
  | "owner_review_pending"
  | "sent_to_customer"
  | "customer_approved";

export type NotificationType = "owner_approval" | "customer_send";

export type NotificationDeliveryState = "ready" | "queued" | "sent" | "failed";

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
  createdByEmail?: string;
  estimateDraft: EstimateDraft;
  proposalVariants: ProposalVariant[];
  proposalWorkflow: ProposalWorkflowState;
  notificationStatus: ProjectNotificationStatus;
  ownerApprovalStatus: NotificationDeliveryStatus;
  customerSendStatus: NotificationDeliveryStatus;
  lastNotificationAttemptAt?: string;
  integrationSyncs: IntegrationSync[];
  integrationState?: ProjectIntegrationState;
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
