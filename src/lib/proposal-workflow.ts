import "server-only";

import { createHash } from "node:crypto";
import {
  getNotificationProviderConfigurationErrors,
  sendResendEmail,
} from "@/lib/notification-providers";
import type {
  NotificationDeliveryState,
  NotificationDeliveryStatus,
  NotificationType,
  ProjectRecord,
  ProposalApprovalSignature,
  ProposalStyle,
} from "@/lib/types";

type ProjectNotificationSeed = Omit<
  ProjectRecord,
  | "notificationStatus"
  | "ownerApprovalStatus"
  | "customerSendStatus"
  | "customerProposalEmailStatus"
  | "customerProposalEmailLastAttemptAt"
  | "customerProposalEmailError"
  | "lastNotificationAttemptAt"
> &
  Partial<
    Pick<
      ProjectRecord,
      | "notificationStatus"
      | "ownerApprovalStatus"
      | "customerSendStatus"
      | "customerProposalEmailStatus"
      | "customerProposalEmailLastAttemptAt"
      | "customerProposalEmailError"
      | "lastNotificationAttemptAt"
    >
  >;

type WorkflowResult = {
  project: ProjectRecord;
  ok: boolean;
  message: string;
};

type SendNotificationInput = {
  project: ProjectRecord;
  type: NotificationType;
  origin: string;
  force?: boolean;
};

type ApproveCustomerProposalInput = {
  project: ProjectRecord;
  style: ProposalStyle;
  signedByName: string;
  signedByEmail: string;
  signatureText: string;
  requestIp?: string;
};

type NotificationChannel = "email" | "sms";

type NotificationDispatchPlan = {
  email: boolean;
};

function nowIso() {
  return new Date().toISOString();
}

function resolveChannelState(channels?: NotificationDeliveryStatus["channels"]) {
  return {
    email: channels?.email ?? "ready",
    sms: channels?.sms ?? "ready",
  };
}

function defaultNotificationEntry(
  status: NotificationDeliveryState,
  message: string,
): NotificationDeliveryStatus {
  return {
    status,
    message,
    lastUpdatedAt: nowIso(),
    channels: resolveChannelState(),
  };
}

function buildCustomerApprovalUrl(project: ProjectRecord, style: ProposalStyle, origin: string) {
  const proposal =
    project.proposalVariants.find((variant) => variant.style === style) ??
    project.proposalVariants[0];
  return new URL(proposal.sharePath, origin).toString();
}

function buildOwnerReviewUrl(project: ProjectRecord, origin: string) {
  return new URL(`/?projectId=${encodeURIComponent(project.id)}`, origin).toString();
}

function summarizeProposal(project: ProjectRecord, style: ProposalStyle) {
  const proposal =
    project.proposalVariants.find((variant) => variant.style === style) ??
    project.proposalVariants[0];
  const bulletSummary = proposal?.bulletHighlights.slice(0, 2).join(" ");
  return bulletSummary || project.scopeDescription;
}

function buildFingerprint(
  type: NotificationType,
  project: ProjectRecord,
  style: ProposalStyle,
  approvalLink: string,
) {
  return createHash("sha256")
    .update(
      [
        type,
        project.id,
        project.customer.name,
        project.customer.email ?? "",
        project.customer.phone ?? "",
        project.estimateDraft.grandTotal,
        summarizeProposal(project, style),
        approvalLink,
      ].join("|"),
    )
    .digest("hex");
}

function getNotificationEntry(
  project: ProjectRecord,
  type: NotificationType,
) {
  return type === "owner_approval"
    ? project.ownerApprovalStatus
    : project.customerSendStatus;
}

function withNotificationEntry(
  project: ProjectRecord,
  type: NotificationType,
  updates: Partial<NotificationDeliveryStatus>,
) {
  const current = getNotificationEntry(project, type);
  const nextEntry = {
    ...current,
    ...updates,
    channels: resolveChannelState({
      ...resolveChannelState(current.channels),
      ...updates.channels,
    }),
    lastUpdatedAt: updates.lastUpdatedAt ?? nowIso(),
  };

  const nextProject = {
    ...project,
    ownerApprovalStatus:
      type === "owner_approval" ? nextEntry : project.ownerApprovalStatus,
    customerSendStatus:
      type === "customer_send" ? nextEntry : project.customerSendStatus,
    notificationStatus: {
      status: nextEntry.status,
      lastUpdatedAt: nextEntry.lastUpdatedAt,
      type,
    },
    lastNotificationAttemptAt:
      updates.lastAttemptAt ?? project.lastNotificationAttemptAt,
  };

  if (type !== "customer_send") {
    return nextProject;
  }

  return {
    ...nextProject,
    customerProposalEmailStatus: nextEntry.status,
    customerProposalEmailLastAttemptAt:
      updates.lastAttemptAt ?? project.customerProposalEmailLastAttemptAt,
    customerProposalEmailError:
      nextEntry.status === "failed" ? nextEntry.message : undefined,
  };
}

function buildNotificationPayload(
  project: ProjectRecord,
  type: NotificationType,
  origin: string,
) {
  const style = project.proposalWorkflow.activeStyle;
  const approvalLink =
    type === "owner_approval"
      ? buildOwnerReviewUrl(project, origin)
      : buildCustomerApprovalUrl(project, style, origin);

  return {
    projectId: project.id,
    customerName: project.customer.name,
    customerEmail: project.customer.email ?? "",
    customerPhone: project.customer.phone ?? "",
    estimateTotal: project.estimateDraft.grandTotal,
    approvalLink,
    type,
    projectName: project.title,
    proposalSummary: summarizeProposal(project, style),
  };
}

function canSkipSend(
  project: ProjectRecord,
  type: NotificationType,
  fingerprint: string,
  force: boolean | undefined,
) {
  if (force) {
    return false;
  }

  const current = getNotificationEntry(project, type);
  return (
    current.lastFingerprint === fingerprint &&
    current.status === "sent"
  );
}

function getOwnerApprovalEmails() {
  const configured = process.env.OWNER_APPROVAL_EMAIL_RECIPIENTS?.trim();
  if (!configured) {
    return [
      "jaime@grizzlyelectrical.net",
      "carterbarns@grizzlyelectrical.net",
    ];
  }

  return configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildOwnerApprovalEmail(project: ProjectRecord, reviewLink: string) {
  return {
    to: getOwnerApprovalEmails(),
    subject: `Owner review needed: ${project.customer.name} - ${project.title}`,
    text: [
      "A new Grizzly Estimator proposal is waiting for owner review.",
      "",
      `Customer: ${project.customer.name}`,
      `Project: ${project.title}`,
      `Estimate total: $${project.estimateDraft.grandTotal.toFixed(2)}`,
      `Summary: ${summarizeProposal(project, project.proposalWorkflow.activeStyle)}`,
      `Review link: ${reviewLink}`,
      "",
      "Email delivery is active now. SMS delivery is being added later.",
    ].join("\n"),
  };
}

function buildCustomerEmail(project: ProjectRecord, approvalLink: string) {
  const recipient = project.customer.email?.trim();

  if (!recipient) {
    throw new Error("Customer email is required before sending the proposal.");
  }

  return {
    to: [recipient],
    subject: `Your Grizzly Electrical estimate: ${project.title}`,
    text: [
      `Hi ${project.customer.name},`,
      "",
      "Your estimate is ready for review and signature.",
      "",
      `Project: ${project.title}`,
      `Estimate total: $${project.estimateDraft.grandTotal.toFixed(2)}`,
      `Summary: ${summarizeProposal(project, project.proposalWorkflow.activeStyle)}`,
      "",
      "Review and approve proposal:",
      approvalLink,
      "",
      "You can approve it directly from the proposal page with your typed signature.",
      "Email delivery is active now. SMS delivery is being added later.",
    ].join("\n"),
  };
}

function getChannelPlan(
  project: ProjectRecord,
  type: NotificationType,
  fingerprint: string,
  force?: boolean,
): NotificationDispatchPlan {
  if (force || getNotificationEntry(project, type).lastFingerprint !== fingerprint) {
    return { email: true };
  }

  const current = getNotificationEntry(project, type);
  return {
    email: current.channels?.email !== "sent",
  };
}

function getProposalNotificationBlocker(project: ProjectRecord) {
  if (project.estimateDraft.lineItems.length === 0) {
    return "No reviewed estimate lines are ready for proposal notifications yet.";
  }

  if (project.proposalVariants.length === 0) {
    return "No reviewed proposal variants are ready for proposal notifications yet.";
  }

  if ((project.detectedWorkItems ?? []).some((item) => item.reviewStatus === "pending")) {
    return "Review and approve or reject detected work items before sending proposal notifications.";
  }

  return undefined;
}

function formatChannelMessage(
  type: NotificationType,
  channelResults: { email?: string; sms?: string },
  succeededChannels: NotificationChannel[],
  failedChannels: NotificationChannel[],
) {
  const label = type === "owner_approval" ? "Owner approval" : "Customer delivery";

  if (failedChannels.length === 0) {
    return `${label} email sent successfully. SMS delivery is disabled for now.`;
  }

  if (succeededChannels.length === 0) {
    return `${label} failed. ${failedChannels
      .map((channel) => `${channel}: ${channelResults[channel]}`)
      .join(" ")}`.trim();
  }

  return `${label} partially sent. ${succeededChannels.join(" + ")} succeeded. ${failedChannels
    .map((channel) => `${channel} failed: ${channelResults[channel]}`)
    .join(" ")}`.trim();
}

async function sendDirectNotification(
  project: ProjectRecord,
  type: NotificationType,
  origin: string,
  plan: NotificationDispatchPlan,
) {
  const style = project.proposalWorkflow.activeStyle;
  const reviewLink = buildOwnerReviewUrl(project, origin);
  const approvalLink = buildCustomerApprovalUrl(project, style, origin);
  const channelResults: { email?: string; sms?: string } = {};
  const succeededChannels: NotificationChannel[] = [];
  const failedChannels: NotificationChannel[] = [];

  if (plan.email) {
    try {
      const emailInput =
        type === "owner_approval"
          ? buildOwnerApprovalEmail(project, reviewLink)
          : buildCustomerEmail(project, approvalLink);
      const result = await sendResendEmail(emailInput);
      channelResults.email = `sent (${result.count} recipient${result.count === 1 ? "" : "s"})`;
      succeededChannels.push("email");
    } catch (error) {
      channelResults.email =
        error instanceof Error ? error.message : "Unknown email delivery error.";
      failedChannels.push("email");
      console.error("[notifications/email] Delivery failed", {
        projectId: project.id,
        type,
        error: channelResults.email,
      });
    }
  }

  return {
    ok: failedChannels.length === 0,
    message: formatChannelMessage(type, channelResults, succeededChannels, failedChannels),
    channels: {
      email: plan.email
        ? succeededChannels.includes("email")
          ? "sent"
          : "failed"
        : resolveChannelState(getNotificationEntry(project, type).channels).email,
      sms: resolveChannelState(getNotificationEntry(project, type).channels).sms,
    } satisfies NotificationDeliveryStatus["channels"],
  };
}

function maskIpAddress(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  if (value.includes(".")) {
    const segments = value.split(".");
    return `${segments.slice(0, 3).join(".")}.x`;
  }

  if (value.includes(":")) {
    const segments = value.split(":");
    return `${segments.slice(0, 4).join(":")}:x`;
  }

  return value;
}

function normalizeIntegrationSystem(value: string) {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "-");
}

function isLegacyNotificationSync(system: string) {
  return new Set([
    "owner-approval-email",
    "owner-approval-text",
    "customer-proposal-email",
    "customer-proposal-text",
    "approval-notification-email",
  ]).has(normalizeIntegrationSystem(system));
}

function normalizeManualHousecallSync(sync: ProjectRecord["integrationSyncs"][number]) {
  const normalizedSystem = normalizeIntegrationSystem(sync.system);
  if (
    normalizedSystem === "housecall-pro" &&
    sync.status === "queued" &&
    sync.message.includes("Manual Housecall Pro handoff happens after customer approval")
  ) {
    return {
      ...sync,
      status: "ready" as const,
    };
  }

  return sync;
}

export function initializeProposalWorkflow(
  project: ProjectNotificationSeed,
  createdByEmail?: string,
): ProjectRecord {
  const currentTime = nowIso();

  return {
    ...project,
    createdByEmail: project.createdByEmail ?? createdByEmail,
    proposalWorkflow: project.proposalWorkflow ?? {
      status: "owner_review_pending",
      activeStyle: project.proposalVariants[0]?.style ?? "hcp",
      ownerReviewRequestedAt: currentTime,
    },
    notificationStatus: project.notificationStatus ?? {
      status: "ready",
      lastUpdatedAt: currentTime,
    },
    ownerApprovalStatus:
      project.ownerApprovalStatus ??
      defaultNotificationEntry("ready", "Owner approval notification has not been sent yet."),
    customerSendStatus:
      project.customerSendStatus ??
      defaultNotificationEntry("ready", "Customer delivery has not been sent yet."),
    customerProposalEmailStatus:
      project.customerProposalEmailStatus ??
      project.customerSendStatus?.status ??
      "ready",
    customerProposalEmailLastAttemptAt:
      project.customerProposalEmailLastAttemptAt ??
      project.customerSendStatus?.lastAttemptAt,
    customerProposalEmailError:
      project.customerProposalEmailError ??
      (project.customerSendStatus?.status === "failed"
        ? project.customerSendStatus.message
        : undefined),
    lastNotificationAttemptAt: project.lastNotificationAttemptAt,
    integrationSyncs: (project.integrationSyncs ?? [])
      .filter((sync) => !isLegacyNotificationSync(sync.system))
      .map((sync) => normalizeManualHousecallSync(sync)),
  };
}

export async function queueNotification(
  input: SendNotificationInput,
): Promise<WorkflowResult> {
  const { project, type, origin, force } = input;
  const blocker = getProposalNotificationBlocker(project);

  if (blocker) {
    return {
      ok: false,
      message: blocker,
      project,
    };
  }

  const payload = buildNotificationPayload(project, type, origin);
  const fingerprint = buildFingerprint(
    type,
    project,
    project.proposalWorkflow.activeStyle,
    payload.approvalLink,
  );

  if (canSkipSend(project, type, fingerprint, force)) {
    return {
      ok: true,
      message: `${type === "owner_approval" ? "Owner approval" : "Customer send"} notification already queued for this unchanged project state.`,
      project,
    };
  }

  const configurationErrors = getNotificationProviderConfigurationErrors();
  const dispatchPlan = getChannelPlan(project, type, fingerprint, force);
  const existingChannels = resolveChannelState(getNotificationEntry(project, type).channels);

  let updatedProject = withNotificationEntry(project, type, {
    status: "queued",
    message: "Sending direct email notification...",
    lastAttemptAt: nowIso(),
    lastFingerprint: fingerprint,
    channels: {
      email: dispatchPlan.email ? "queued" : existingChannels.email,
      sms: existingChannels.sms,
    },
  });

  if (configurationErrors.length > 0) {
    const configurationError = `Direct notifications are not configured. Add ${configurationErrors.join(", ")}.`;
    const currentChannels = resolveChannelState(getNotificationEntry(updatedProject, type).channels);
    updatedProject = withNotificationEntry(updatedProject, type, {
      status: "failed",
      message: configurationError,
      lastAttemptAt: nowIso(),
      lastFingerprint: fingerprint,
      channels: {
        email: dispatchPlan.email ? "failed" : currentChannels.email,
        sms: currentChannels.sms,
      },
    });
    console.error("[notifications] Provider configuration error", {
      projectId: updatedProject.id,
      type,
      error: configurationError,
    });
    return {
      ok: false,
      message: configurationError,
      project: updatedProject,
    };
  }

  try {
    console.info("[notifications] Sending direct notifications", {
      projectId: updatedProject.id,
      type,
      dispatchPlan,
      payload,
    });
    const deliveryResult = await sendDirectNotification(
      updatedProject,
      type,
      origin,
      dispatchPlan,
    );

    updatedProject = withNotificationEntry(updatedProject, type, {
      status: deliveryResult.ok ? "sent" : "failed",
      message: deliveryResult.message,
      lastAttemptAt: nowIso(),
      lastFingerprint: fingerprint,
      channels: deliveryResult.channels,
    });

    if (type === "customer_send" && deliveryResult.ok) {
      updatedProject = {
        ...updatedProject,
        proposalWorkflow: {
          ...updatedProject.proposalWorkflow,
          status: "sent_to_customer",
          ownerApprovedAt:
            updatedProject.proposalWorkflow.ownerApprovedAt ?? nowIso(),
          ownerApprovedByEmail:
            updatedProject.proposalWorkflow.ownerApprovedByEmail ??
            updatedProject.createdByEmail ??
            process.env.APP_ADMIN_EMAIL ??
            "owner",
          customerSentAt:
            updatedProject.proposalWorkflow.customerSentAt ?? nowIso(),
          customerSentByEmail:
            updatedProject.proposalWorkflow.customerSentByEmail ??
            updatedProject.createdByEmail ??
            process.env.APP_ADMIN_EMAIL ??
            "owner",
        },
      };
    }

    return {
      ok: deliveryResult.ok,
      message: deliveryResult.message,
      project: updatedProject,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown direct notification error.";
    console.error("[notifications] Direct notification dispatch failed", {
      projectId: updatedProject.id,
      type,
      error: message,
    });
    updatedProject = withNotificationEntry(updatedProject, type, {
      status: "failed",
      message,
      lastAttemptAt: nowIso(),
      lastFingerprint: fingerprint,
      channels: {
        email: dispatchPlan.email
          ? "failed"
          : resolveChannelState(getNotificationEntry(updatedProject, type).channels).email,
        sms: resolveChannelState(getNotificationEntry(updatedProject, type).channels).sms,
      },
    });

    return {
      ok: false,
      message,
      project: updatedProject,
    };
  }
}

export function canResendNotification(
  project: ProjectRecord,
  type: NotificationType,
  manualOverride?: boolean,
) {
  const current = getNotificationEntry(project, type);
  return manualOverride || current.status === "failed" || current.status === "queued";
}

export async function sendOwnerApprovalRequest(
  project: ProjectRecord,
  origin: string,
  force?: boolean,
) {
  return queueNotification({
    project,
    type: "owner_approval",
    origin,
    force,
  });
}

export async function sendCustomerProposal(
  project: ProjectRecord,
  origin: string,
  force?: boolean,
) {
  return queueNotification({
    project,
    type: "customer_send",
    origin,
    force,
  });
}

export async function approveCustomerProposal(
  input: ApproveCustomerProposalInput,
): Promise<WorkflowResult> {
  const { project, style, signedByName, signedByEmail, signatureText, requestIp } = input;

  if (project.proposalWorkflow.status !== "sent_to_customer") {
    return {
      ok: false,
      message: "This proposal is not open for customer approval yet.",
      project,
    };
  }

  if (project.proposalWorkflow.customerSignature) {
    return {
      ok: true,
      message: "This proposal has already been approved.",
      project,
    };
  }

  const signature: ProposalApprovalSignature = {
    signedByName,
    signedByEmail,
    signatureText,
    signedAt: nowIso(),
    ipAddress: maskIpAddress(requestIp),
  };

  return {
    ok: true,
    message: "Customer approval recorded.",
    project: {
      ...project,
      proposalWorkflow: {
        ...project.proposalWorkflow,
        activeStyle: style,
        status: "customer_approved",
        customerApprovedAt: signature.signedAt,
        customerSignature: signature,
      },
    },
  };
}
