import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./notification-providers", () => ({
  getNotificationProviderConfigurationErrors: vi.fn(() => []),
  normalizeUsPhoneNumber: vi.fn((value: string) => value),
  sendResendEmail: vi.fn(),
  sendTwilioSms: vi.fn(),
}));
import {
  approveCustomerProposal,
  canResendNotification,
  initializeProposalWorkflow,
  sendCustomerProposal,
  sendOwnerApprovalRequest,
} from "./proposal-workflow";
import {
  getNotificationProviderConfigurationErrors,
  sendResendEmail,
  sendTwilioSms,
} from "./notification-providers";
import type { ProjectRecord } from "./types";

const sendResendEmailMock = vi.mocked(sendResendEmail);
const sendTwilioSmsMock = vi.mocked(sendTwilioSms);
const configurationErrorsMock = vi.mocked(getNotificationProviderConfigurationErrors);

function buildProject(overrides?: Partial<ProjectRecord>): ProjectRecord {
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
          areaGroups: [],
          lineItems: [],
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
    sendTwilioSmsMock.mockResolvedValue({
      id: "sms-1",
      count: 1,
    });
  });

  it("initializes notification tracking for new projects", () => {
    const project = buildProject();

    expect(project.ownerApprovalStatus.status).toBe("ready");
    expect(project.customerSendStatus.status).toBe("ready");
    expect(project.notificationStatus.status).toBe("ready");
    expect(project.ownerApprovalStatus.channels).toEqual({
      email: "ready",
      sms: "ready",
    });
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
      sms: "sent",
    });
    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendTwilioSmsMock).toHaveBeenCalledTimes(1);
    expect(secondResult.message).toContain("already queued");
  });

  it("sends customer delivery and records sent_to_customer workflow", async () => {
    const result = await sendCustomerProposal(buildProject(), "http://localhost:3000");

    expect(result.ok).toBe(true);
    expect(result.project.customerSendStatus.status).toBe("sent");
    expect(result.project.customerSendStatus.channels).toEqual({
      email: "sent",
      sms: "sent",
    });
    expect(result.project.proposalWorkflow.status).toBe("sent_to_customer");
  });

  it("marks notification as failed when one provider fails", async () => {
    sendTwilioSmsMock.mockRejectedValueOnce(
      new Error("Twilio rejected the message."),
    );

    const result = await sendCustomerProposal(buildProject(), "http://localhost:3000");

    expect(result.ok).toBe(false);
    expect(result.project.customerSendStatus.status).toBe("failed");
    expect(result.project.customerSendStatus.channels).toEqual({
      email: "sent",
      sms: "failed",
    });
    expect(canResendNotification(result.project, "customer_send")).toBe(true);
  });

  it("resends only the failed channel for the same unchanged project state", async () => {
    sendTwilioSmsMock.mockRejectedValueOnce(new Error("Twilio timeout."));
    const failedResult = await sendCustomerProposal(buildProject(), "http://localhost:3000");

    sendTwilioSmsMock.mockResolvedValueOnce({
      id: "sms-2",
      count: 1,
    });
    const retryResult = await sendCustomerProposal(
      failedResult.project,
      "http://localhost:3000",
    );

    expect(retryResult.ok).toBe(true);
    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendTwilioSmsMock).toHaveBeenCalledTimes(2);
    expect(retryResult.project.customerSendStatus.channels).toEqual({
      email: "sent",
      sms: "sent",
    });
  });

  it("fails cleanly when providers are not configured", async () => {
    configurationErrorsMock.mockReturnValue([
      "RESEND_API_KEY",
      "TWILIO_ACCOUNT_SID",
    ]);

    const result = await sendOwnerApprovalRequest(buildProject(), "http://localhost:3000");

    expect(result.ok).toBe(false);
    expect(result.project.ownerApprovalStatus.status).toBe("failed");
    expect(result.message).toContain("RESEND_API_KEY");
    expect(sendResendEmailMock).not.toHaveBeenCalled();
    expect(sendTwilioSmsMock).not.toHaveBeenCalled();
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
