import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./notification-providers", () => ({
  getNotificationProviderConfigurationErrors: vi.fn(() => []),
  sendResendEmail: vi.fn(),
}));
import {
  approveCustomerProposal,
  canResendNotification,
  initializeProposalWorkflow,
  sendCustomerProposal,
  sendOwnerApprovalRequest,
} from "./proposal-workflow";
import { createIntakeProject } from "./intake-session";
import {
  getNotificationProviderConfigurationErrors,
  sendResendEmail,
} from "./notification-providers";
import type { ProjectRecord } from "./types";

const sendResendEmailMock = vi.mocked(sendResendEmail);
const configurationErrorsMock = vi.mocked(getNotificationProviderConfigurationErrors);

function buildProject(overrides?: Partial<ProjectRecord>): ProjectRecord {
  const lineItems = [
    {
      id: "project-1-kitchen-receptacle",
      area: "Kitchen",
      name: "Add New Receptacle",
      description: "Add receptacle from nearby existing circuit.",
      quantity: 1,
      unit: "Each",
      materialCost: 120,
      sellPrice: 5200,
      laborHours: 14,
      confidence: 0.82,
      status: "verified" as const,
      source: "price_book" as const,
    },
  ];

  return {
    ...initializeProposalWorkflow(
      {
        id: "project-1",
        title: "Kitchen remodel",
        customer: {
          name: "Jamie Example",
          email: "jamie@example.com",
          phone: "469-555-1212",
          address: "123 Main Street",
        },
        propertyType: "single_family",
        projectType: "residential",
        projectSubtype: "full_remodel",
        scopeDescription: "Update kitchen lighting and receptacles.",
        blueprintIncluded: false,
        notes: [],
        attachments: [],
        transcriptSegments: [],
        requestedActions: [],
        createdAt: "2026-04-20T00:00:00.000Z",
        estimateDraft: {
          areaGroups: [
            {
              area: "Kitchen",
              lineItems,
              subtotal: 5200,
              totalLaborHours: 14,
            },
          ],
          lineItems,
          materialTotal: 1200,
          totalLaborHours: 14,
          laborRate: 118,
          grandTotal: 5200,
          averageConfidence: 0.82,
          reviewStatus: "ready_for_owner_review",
        },
        proposalVariants: [
          {
            style: "hcp",
            title: "Kitchen proposal",
            intro: "Proposal intro",
            bulletHighlights: ["Line one"],
            depositRequired: true,
            depositAmount: 1300,
            sharePath: "/proposal/project-1?style=hcp&token=test",
          },
        ],
        integrationSyncs: [],
        capturePrompts: [],
        analysisSummary: [],
        opsNextSteps: [],
      },
      "estimator@grizzlyelectric.com",
    ),
    ...overrides,
  };
}

describe("proposal workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configurationErrorsMock.mockReturnValue([]);
    sendResendEmailMock.mockResolvedValue({
      id: "email-1",
      count: 1,
    });
  });

  it("initializes notification tracking for new projects", () => {
    const project = buildProject();

    expect(project.ownerApprovalStatus.status).toBe("ready");
    expect(project.customerSendStatus.status).toBe("ready");
    expect(project.customerProposalEmailStatus).toBe("ready");
    expect(project.notificationStatus.status).toBe("ready");
    expect(project.ownerApprovalStatus.channels).toEqual({
      email: "ready",
      sms: "ready",
    });
  });

  it("does not send notifications for intake-only saves", async () => {
    const intake = createIntakeProject({
      id: "intake-only",
      title: "Field intake",
      customer: {
        name: "Field Customer",
        email: "field@example.com",
        address: "100 Field Lane",
      },
      propertyType: "single_family",
      projectType: "residential",
      projectSubtype: "receptacle_add",
      scopeDescription: "Capture photos and notes only.",
      blueprintIncluded: false,
      notes: ["Intake should remain review-only."],
      attachments: [],
      transcriptSegments: [],
      requestedActions: [],
    });

    const ownerResult = await sendOwnerApprovalRequest(intake, "http://localhost:3000");
    const customerResult = await sendCustomerProposal(intake, "http://localhost:3000");

    expect(ownerResult.ok).toBe(false);
    expect(customerResult.ok).toBe(false);
    expect(ownerResult.message).toContain("No reviewed estimate lines");
    expect(customerResult.message).toContain("No reviewed estimate lines");
    expect(ownerResult.project.ownerApprovalStatus.status).toBe("ready");
    expect(customerResult.project.customerSendStatus.status).toBe("ready");
    expect(sendResendEmailMock).not.toHaveBeenCalled();
  });

  it("blocks proposal notifications while detected work items are pending review", async () => {
    const result = await sendCustomerProposal(
      buildProject({
        detectedWorkItems: [
          {
            id: "detected-1",
            description: "Possible receptacle add",
            quantity: 1,
            confidence: 0.45,
            sourceType: "photo",
            sourceAttachmentId: "photo-1",
            sourcePath: "project-1/photo-1.jpg",
            manualReview: true,
            reviewStatus: "pending",
            detectedAt: "2026-04-28T00:00:00.000Z",
          },
        ],
      }),
      "http://localhost:3000",
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Review and approve or reject detected work items");
    expect(sendResendEmailMock).not.toHaveBeenCalled();
  });

  it("sends owner approval notifications and dedupes unchanged sends", async () => {
    const firstResult = await sendOwnerApprovalRequest(
      buildProject(),
      "http://localhost:3000",
    );
    const secondResult = await sendOwnerApprovalRequest(
      firstResult.project,
      "http://localhost:3000",
    );

    expect(firstResult.ok).toBe(true);
    expect(firstResult.project.ownerApprovalStatus.status).toBe("sent");
    expect(firstResult.project.ownerApprovalStatus.channels).toEqual({
      email: "sent",
      sms: "ready",
    });
    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(secondResult.message).toContain("already queued");
  });

  it("sends customer delivery and records sent_to_customer workflow", async () => {
    const result = await sendCustomerProposal(buildProject(), "http://localhost:3000");

    expect(result.ok).toBe(true);
    expect(result.project.customerSendStatus.status).toBe("sent");
    expect(result.project.customerProposalEmailStatus).toBe("sent");
    expect(result.project.customerProposalEmailLastAttemptAt).toBeTruthy();
    expect(result.project.customerProposalEmailError).toBeUndefined();
    expect(result.project.customerSendStatus.channels).toEqual({
      email: "sent",
      sms: "ready",
    });
    expect(result.project.proposalWorkflow.status).toBe("sent_to_customer");
    expect(sendResendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["jamie@example.com"],
        subject: "Your Grizzly Electrical estimate: Kitchen remodel",
        text: expect.stringContaining("Review and approve proposal:"),
      }),
    );
  });

  it("blocks customer proposal email when the customer email is missing", async () => {
    const result = await sendCustomerProposal(
      buildProject({
        customer: {
          name: "Jamie Example",
          address: "123 Main Street",
        },
      }),
      "http://localhost:3000",
    );

    expect(result.ok).toBe(false);
    expect(result.project.customerProposalEmailStatus).toBe("failed");
    expect(result.project.customerProposalEmailError).toContain(
      "Customer email is required",
    );
    expect(result.project.proposalWorkflow.status).toBe("owner_review_pending");
    expect(sendResendEmailMock).not.toHaveBeenCalled();
  });

  it("marks notification as failed when email delivery fails", async () => {
    sendResendEmailMock.mockRejectedValueOnce(
      new Error("Resend rejected the email."),
    );

    const result = await sendCustomerProposal(buildProject(), "http://localhost:3000");

    expect(result.ok).toBe(false);
    expect(result.project.customerSendStatus.status).toBe("failed");
    expect(result.project.customerProposalEmailStatus).toBe("failed");
    expect(result.project.customerProposalEmailError).toContain(
      "Resend rejected the email.",
    );
    expect(result.project.customerProposalEmailLastAttemptAt).toBeTruthy();
    expect(result.project.proposalWorkflow.status).toBe("owner_review_pending");
    expect(result.project.customerSendStatus.channels).toEqual({
      email: "failed",
      sms: "ready",
    });
    expect(canResendNotification(result.project, "customer_send")).toBe(true);
  });

  it("resends the failed email channel for the same unchanged project state", async () => {
    sendResendEmailMock.mockRejectedValueOnce(new Error("Resend timeout."));
    const failedResult = await sendCustomerProposal(buildProject(), "http://localhost:3000");

    sendResendEmailMock.mockResolvedValueOnce({
      id: "email-2",
      count: 1,
    });
    const retryResult = await sendCustomerProposal(
      failedResult.project,
      "http://localhost:3000",
    );

    expect(retryResult.ok).toBe(true);
    expect(sendResendEmailMock).toHaveBeenCalledTimes(2);
    expect(retryResult.project.customerProposalEmailStatus).toBe("sent");
    expect(retryResult.project.customerProposalEmailError).toBeUndefined();
    expect(retryResult.project.customerSendStatus.channels).toEqual({
      email: "sent",
      sms: "ready",
    });
  });

  it("does not let a failed Housecall Pro sync block customer proposal email", async () => {
    const result = await sendCustomerProposal(
      buildProject({
        integrationSyncs: [
          {
            system: "housecall-pro",
            status: "failed",
            message: "Housecall Pro customer sync failed.",
            updatedAt: "2026-04-24T00:00:00.000Z",
          },
        ],
      }),
      "http://localhost:3000",
    );

    expect(result.ok).toBe(true);
    expect(result.project.customerProposalEmailStatus).toBe("sent");
    expect(result.project.integrationSyncs[0]?.status).toBe("failed");
    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("does not treat queued owner approval status as a final delivered state", async () => {
    const queuedProject = buildProject({
      ownerApprovalStatus: {
        status: "queued",
        message: "Legacy queued state.",
        lastUpdatedAt: "2026-04-23T00:00:00.000Z",
        lastFingerprint: "same-fingerprint",
        channels: {
          email: "queued",
          sms: "ready",
        },
      },
    });

    const retried = await sendOwnerApprovalRequest(queuedProject, "http://localhost:3000");

    expect(retried.ok).toBe(true);
    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(retried.project.ownerApprovalStatus.status).toBe("sent");
  });

  it("fails cleanly when providers are not configured", async () => {
    configurationErrorsMock.mockReturnValue(["RESEND_API_KEY"]);

    const result = await sendOwnerApprovalRequest(buildProject(), "http://localhost:3000");

    expect(result.ok).toBe(false);
    expect(result.project.ownerApprovalStatus.status).toBe("failed");
    expect(result.message).toContain("RESEND_API_KEY");
    expect(sendResendEmailMock).not.toHaveBeenCalled();
  });

  it("removes legacy notification sync cards even when older rows used spaces", () => {
    const project = initializeProposalWorkflow({
      ...buildProject(),
      integrationSyncs: [
        {
          system: "owner approval email",
          status: "queued",
          message: "Owner review email will send as soon as delivery settings are configured.",
          updatedAt: "2026-04-23T00:00:00.000Z",
        },
        {
          system: "housecall-pro",
          status: "queued",
          message: "Manual handoff remains queued.",
          updatedAt: "2026-04-23T00:00:00.000Z",
        },
      ],
    });

    expect(project.integrationSyncs).toHaveLength(1);
    expect(project.integrationSyncs[0]?.system).toBe("housecall-pro");
  });

  it("normalizes manual housecall pro handoff from queued to ready", () => {
    const project = initializeProposalWorkflow({
      ...buildProject(),
      integrationSyncs: [
        {
          system: "housecall-pro",
          status: "queued",
          message:
            "Manual Housecall Pro handoff happens after customer approval. Direct API sync is not part of this approval workflow.",
          updatedAt: "2026-04-24T00:00:00.000Z",
        },
      ],
    });

    expect(project.integrationSyncs[0]?.system).toBe("housecall-pro");
    expect(project.integrationSyncs[0]?.status).toBe("ready");
  });

  it("allows resend when a notification is stuck queued", () => {
    const queuedProject = buildProject({
      ownerApprovalStatus: {
        status: "queued",
        message: "Queued.",
        lastUpdatedAt: "2026-04-23T00:00:00.000Z",
        channels: {
          email: "queued",
          sms: "ready",
        },
      },
    });

    expect(canResendNotification(queuedProject, "owner_approval")).toBe(true);
  });

  it("records a typed signature when the customer approves", async () => {
    const sentProject = (
      await sendCustomerProposal(buildProject(), "http://localhost:3000")
    ).project;

    const result = await approveCustomerProposal({
      project: sentProject,
      style: "hcp",
      signedByName: "Jamie Example",
      signedByEmail: "jamie@example.com",
      signatureText: "Jamie Example",
      requestIp: "203.0.113.14",
    });

    expect(result.ok).toBe(true);
    expect(result.project.proposalWorkflow.status).toBe("customer_approved");
    expect(result.project.proposalWorkflow.customerSignature?.ipAddress).toBe(
      "203.0.113.x",
    );
  });
});
