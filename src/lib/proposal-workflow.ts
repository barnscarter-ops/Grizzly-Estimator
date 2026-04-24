import "server-only";

import { createHash } from "node:crypto";
import {
  getNotificationProviderConfigurationErrors,
  normalizeUsPhoneNumber,
  sendResendEmail,
  sendTwilioSms,
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
  "notificationStatus" | "ownerApprovalStatus" | "customerSendStatus" | "lastNotificationAttemptAt"
> &
  Partial<
    Pick<
      ProjectRecord,
      "notificationStatus" | "ownerApprovalStatus" | "customerSendStatus" | "lastNotificationAttemptAt"
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
  sms: boolean;
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

  return {
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
    (current.status === "queued" || current.status === "sent")
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

function getOwnerApprovalPhones() {
  const configured = process.env.OWNER_APPROVAL_SMS_RECIPIENTS?.trim();
  if (!configured) {
    return ["469-716-9870", "469-422-2982"];
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
    ].join("\n"),
  };
}

function buildOwnerApprovalSms(project: ProjectRecord, reviewLink: string) {
  return {
    to: getOwnerApprovalPhones(),
    body: `Owner review needed for ${project.customer.name} - ${project.title}. Total $${project.estimateDraft.grandTotal.toFixed(2)}. Review: ${reviewLink}`,
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
      `Estimate total: $${project.estimateDraft.grandTotal.toFixed(2)}`,
      `Summary: ${summarizeProposal(project, project.proposalWorkflow.activeStyle)}`,
      `Review and sign: ${approvalLink}`,
      "",
      "You can approve it directly from the proposal page with your typed signature.",
    ].join("\n"),
  };
}

function buildCustomerSms(project: ProjectRecord, approvalLink: string) {
  const recipient = project.customer.phone?.trim();

  if (!recipient) {
    throw new Error("Customer phone is required before texting the proposal link.");
  }

  return {
    to: [recipient],
    body: `Your Grizzly Electrical estimate is ready. Total $${project.estimateDraft.grandTotal.toFixed(2)}. Review and sign here: ${approvalLink}`,
  };
}

function getChannelPlan(
  project: ProjectRecord,
  type: NotificationType,
  fingerprint: string,
  force?: boolean,
): NotificationDispatchPlan {
  if (force || getNotificationEntry(project, type).lastFingerprint !== fingerprint) {
    return { email: true, sms: true };
  }

  const current = getNotificationEntry(project, type);
  return {
    email: current.channels?.email !== "sent",
    sms: current.channels?.sms !== "sent",
  };
}

function formatChannelMessage(
  type: NotificationType,
  channelResults: { email?: string; sms?: string },
  succeededChannels: NotificationChannel[],
  failedChannels: NotificationChannel[],
) {
  const label = type === "owner_approval" ? "Owner approval" : "Customer delivery";

  if (failedChannels.length === 0) {
    return `${label} sent successfully by direct email/SMS providers.`;
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

  if (plan.sms) {
    try {
      const smsInput =
        type === "owner_approval"
          ? buildOwnerApprovalSms(project, reviewLink)
          : buildCustomerSms(project, approvalLink);
      const result = await sendTwilioSms({
        ...smsInput,
        to: smsInput.to.map(normalizeUsPhoneNumber),
      });
      channelResults.sms = `sent (${result.count} recipient${result.count === 1 ? "" : "s"})`;
      succeededChannels.push("sms");
    } catch (error) {
      channelResults.sms =
        error instanceof Error ? error.message : "Unknown SMS delivery error.";
      failedChannels.push("sms");
      console.error("[notifications/sms] Delivery failed", {
        projectId: project.id,
        type,
        error: channelResults.sms,
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
      sms: plan.sms
        ? succeededChannels.includes("sms")
          ? "sent"
          : "failed"
        : resolveChannelState(getNotificationEntry(project, type).channels).sms,
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
    lastNotificationAttemptAt: project.lastNotificationAttemptAt,
    integrationSyncs: project.integrationSyncs.filter(
      (sync) =>
        ![
          "owner-approval-email",
          "owner-approval-text",
          "customer-proposal-email",
          "customer-proposal-text",
          "approval-notification-email",
        ].includes(sync.system),
    ),
  };
}

export async function queueNotification(
  input: SendNotificationInput,
): Promise<WorkflowResult> {
  const { project, type, origin, force } = input;
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
    message: "Sending direct email and SMS notifications...",
    lastAttemptAt: nowIso(),
    lastFingerprint: fingerprint,
    channels: {
      email: dispatchPlan.email ? "queued" : existingChannels.email,
      sms: dispatchPlan.sms ? "queued" : existingChannels.sms,
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
        sms: dispatchPlan.sms ? "failed" : currentChannels.sms,
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
        sms: dispatchPlan.sms
          ? "failed"
          : resolveChannelState(getNotificationEntry(updatedProject, type).channels).sms,
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
  return manualOverride || current.status === "failed";
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
