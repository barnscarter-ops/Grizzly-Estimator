import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHousecallProSync } from "./hcp-sync";
import type { ProjectRecord } from "./types";

vi.mock("./upload-storage", () => ({
  createSignedUploadAccessUrl: vi.fn(async () => "https://signed-upload.example/video.mp4"),
}));

function buildProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "project-sync-test",
    title: "Panel and receptacle upgrade",
    customer: {
      name: "Jamie Customer",
      email: "jamie@example.com",
      phone: "(555) 222-1111",
      address: "123 Test Street",
      company: "Test Bakery",
    },
    propertyType: "single_family",
    projectType: "residential",
    projectSubtype: "receptacle_add",
    scopeDescription: "Add two receptacles and clean up the panel labeling.",
    blueprintIncluded: false,
    notes: [],
    attachments: [],
    transcriptSegments: [],
    requestedActions: [],
    createdAt: "2026-04-20T00:00:00.000Z",
    estimateDraft: {
      areaGroups: [],
      lineItems: [
        {
          id: "line-1",
          area: "Kitchen",
          name: "Add New Receptacle",
          description: "Add one receptacle from nearby circuit.",
          quantity: 2,
          unit: "ea",
          materialCost: 80,
          sellPrice: 418,
          laborHours: 2.5,
          confidence: 0.93,
          status: "verified",
          source: "price_book",
        },
      ],
      materialTotal: 80,
      totalLaborHours: 2.5,
      laborRate: 118,
      grandTotal: 418,
      averageConfidence: 0.93,
      reviewStatus: "ready_for_owner_review",
    },
    proposalVariants: [
      {
        style: "hcp",
        title: "Housecall Pro Proposal",
        intro: "Install two new receptacles.",
        bulletHighlights: ["Kitchen receptacles"],
        depositRequired: false,
        depositAmount: 0,
        sharePath: "/proposal/project-sync-test?style=hcp",
      },
      {
        style: "premium",
        title: "Premium Proposal",
        intro: "Install two new receptacles.",
        bulletHighlights: ["Kitchen receptacles"],
        depositRequired: false,
        depositAmount: 0,
        sharePath: "/proposal/project-sync-test?style=premium",
      },
    ],
    integrationSyncs: [],
    capturePrompts: [],
    analysisSummary: ["Kitchen receptacle add"],
    opsNextSteps: ["Schedule crew after approval"],
    ...overrides,
  };
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });
}

describe("runHousecallProSync", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.HCP_API_KEY = "test-hcp-key";
    process.env.HCP_API_BASE_URL = "https://api.housecallpro.test/public/v1";
    process.env.HCP_AUTH_SCHEME = "Bearer";
    process.env.HCP_CREATE_JOB_ON_SYNC = "false";
    process.env.HCP_ALLOW_ESTIMATE_REEXPORT_ON_CHANGE = "false";
    process.env.HCP_ALLOW_JOB_REEXPORT_ON_CHANGE = "false";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("matches an existing customer before creating the estimate", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname.endsWith("/customers") && init?.method === "GET") {
        return jsonResponse({
          customers: [
            {
              id: "cust-1",
              email: "jamie@example.com",
              mobile_number: "5552221111",
              first_name: "Jamie",
              last_name: "Customer",
              company: "Test Bakery",
            },
          ],
        });
      }

      if (url.pathname.endsWith("/customers/cust-1/addresses") && init?.method === "GET") {
        return jsonResponse({
          addresses: [{ id: "addr-1", address: "123 Test Street" }],
        });
      }

      if (url.pathname.endsWith("/estimates") && init?.method === "POST") {
        return jsonResponse({ id: "estimate-1" });
      }

      throw new Error(`Unhandled request: ${init?.method} ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await runHousecallProSync(buildProject(), "hcp");

    expect(result.sync.status).toBe("synced");
    expect(result.updatedProject.integrationState?.housecallPro?.customerId).toBe("cust-1");
    expect(result.updatedProject.integrationState?.housecallPro?.customerAddressId).toBe(
      "addr-1",
    );
    expect(result.updatedProject.integrationState?.housecallPro?.estimateId).toBe("estimate-1");
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/customers"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("stops when customer matching is ambiguous", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname.endsWith("/customers") && init?.method === "GET") {
        return jsonResponse({
          customers: [
            {
              id: "cust-1",
              email: "jamie@example.com",
              mobile_number: "5552221111",
              first_name: "Jamie",
              last_name: "Customer",
              company: "Test Bakery",
            },
            {
              id: "cust-2",
              email: "jamie@example.com",
              mobile_number: "5552221111",
              first_name: "Jamie",
              last_name: "Customer",
              company: "Test Bakery",
            },
          ],
        });
      }

      throw new Error(`Unhandled request: ${init?.method} ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await runHousecallProSync(buildProject(), "hcp");

    expect(result.sync.status).toBe("matched_duplicate");
    expect(result.sync.retryable).toBe(false);
    expect(result.sync.operation).toBe("match_customer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses an existing estimate when the synced fingerprint has not changed", async () => {
    const firstRunFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname.endsWith("/customers") && init?.method === "GET") {
        return jsonResponse({
          customers: [
            {
              id: "cust-1",
              email: "jamie@example.com",
              mobile_number: "5552221111",
              first_name: "Jamie",
              last_name: "Customer",
            },
          ],
        });
      }

      if (url.pathname.endsWith("/customers/cust-1/addresses") && init?.method === "GET") {
        return jsonResponse({
          addresses: [{ id: "addr-1", address: "123 Test Street" }],
        });
      }

      if (url.pathname.endsWith("/estimates") && init?.method === "POST") {
        return jsonResponse({ id: "estimate-1" });
      }

      throw new Error(`Unhandled request: ${init?.method} ${url.toString()}`);
    });

    vi.stubGlobal("fetch", firstRunFetch);
    const firstRun = await runHousecallProSync(buildProject(), "hcp");

    const secondRunFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname.endsWith("/customers/cust-1") && init?.method === "GET") {
        return jsonResponse({
          id: "cust-1",
          email: "jamie@example.com",
          mobile_number: "5552221111",
          first_name: "Jamie",
          last_name: "Customer",
        });
      }

      if (url.pathname.endsWith("/customers/cust-1/addresses") && init?.method === "GET") {
        return jsonResponse({
          addresses: [{ id: "addr-1", address: "123 Test Street" }],
        });
      }

      if (url.pathname.endsWith("/estimates/estimate-1") && init?.method === "GET") {
        return jsonResponse({ id: "estimate-1" });
      }

      throw new Error(`Unhandled request: ${init?.method} ${url.toString()}`);
    });

    vi.stubGlobal("fetch", secondRunFetch);
    const secondRun = await runHousecallProSync(firstRun.updatedProject, "hcp");

    expect(secondRun.sync.status).toBe("synced");
    expect(secondRun.updatedProject.integrationState?.housecallPro?.estimateId).toBe(
      "estimate-1",
    );
    expect(secondRunFetch).toHaveBeenCalledTimes(3);
    expect(
      secondRunFetch.mock.calls.some(
        ([input, init]) =>
          new URL(typeof input === "string" ? input : input.toString()).pathname.endsWith(
            "/estimates",
          ) && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("preserves the matched customer and address when estimate export fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname.endsWith("/customers") && init?.method === "GET") {
        return jsonResponse({ customers: [] });
      }

      if (url.pathname.endsWith("/customers") && init?.method === "POST") {
        return jsonResponse({ id: "cust-1" });
      }

      if (url.pathname.endsWith("/customers/cust-1/addresses") && init?.method === "GET") {
        return jsonResponse({ addresses: [] });
      }

      if (url.pathname.endsWith("/customers/cust-1/addresses") && init?.method === "POST") {
        return jsonResponse({ id: "addr-1" });
      }

      if (url.pathname.endsWith("/estimates") && init?.method === "POST") {
        return jsonResponse({ error: "temporary outage" }, { status: 503 });
      }

      throw new Error(`Unhandled request: ${init?.method} ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await runHousecallProSync(buildProject(), "hcp");

    expect(result.sync.status).toBe("failed");
    expect(result.sync.retryable).toBe(true);
    expect(result.sync.operation).toBe("estimate_export");
    expect(result.updatedProject.integrationState?.housecallPro?.customerId).toBe("cust-1");
    expect(result.updatedProject.integrationState?.housecallPro?.customerAddressId).toBe(
      "addr-1",
    );
    expect(result.updatedProject.integrationState?.housecallPro?.estimateId).toBeUndefined();
  });
});
