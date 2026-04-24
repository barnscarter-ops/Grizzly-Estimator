import { createHash } from "node:crypto";
import type {
  HousecallProSyncState,
  IntegrationStatus,
  IntegrationSync,
  ProjectRecord,
  ProposalStyle,
} from "@/lib/types";
import { createSignedUploadAccessUrl } from "@/lib/upload-storage";

type HcpConfig = {
  apiKey?: string;
  baseUrl: string;
  authScheme: string;
  customersPath: string;
  customerTemplate: string;
  customerAddressesTemplate: string;
  estimatesPath: string;
  estimateTemplate: string;
  jobsPath: string;
  jobTemplate: string;
  jobAttachmentsTemplate: string;
  enableJobCreation: boolean;
  allowEstimateReexportOnChange: boolean;
  allowJobReexportOnChange: boolean;
};

type SyncResult = {
  updatedProject: ProjectRecord;
  sync: IntegrationSync;
};

type RemoteRecord = Record<string, unknown>;

class HcpRequestError extends Error {
  status: number;
  operation: string;
  body: string;
  retryable: boolean;

  constructor(operation: string, status: number, body: string, retryable: boolean) {
    super(
      `Housecall Pro ${operation} failed (${status}): ${body || "Empty response body."}`,
    );
    this.name = "HcpRequestError";
    this.status = status;
    this.operation = operation;
    this.body = body;
    this.retryable = retryable;
  }
}

function getConfig(): HcpConfig {
  return {
    apiKey: process.env.HCP_API_KEY,
    baseUrl: process.env.HCP_API_BASE_URL ?? "https://api.housecallpro.com/public/v1",
    authScheme: process.env.HCP_AUTH_SCHEME ?? "Bearer",
    customersPath: process.env.HCP_CUSTOMERS_PATH ?? "/customers",
    customerTemplate: process.env.HCP_CUSTOMER_TEMPLATE ?? "/customers/{customerId}",
    customerAddressesTemplate:
      process.env.HCP_CUSTOMER_ADDRESSES_TEMPLATE ?? "/customers/{customerId}/addresses",
    estimatesPath: process.env.HCP_ESTIMATES_PATH ?? "/estimates",
    estimateTemplate: process.env.HCP_ESTIMATE_TEMPLATE ?? "/estimates/{estimateId}",
    jobsPath: process.env.HCP_JOBS_PATH ?? "/jobs",
    jobTemplate: process.env.HCP_JOB_TEMPLATE ?? "/jobs/{jobId}",
    jobAttachmentsTemplate:
      process.env.HCP_JOB_ATTACHMENTS_TEMPLATE ?? "/jobs/{jobId}/attachments",
    enableJobCreation: process.env.HCP_CREATE_JOB_ON_SYNC === "true",
    allowEstimateReexportOnChange:
      process.env.HCP_ALLOW_ESTIMATE_REEXPORT_ON_CHANGE === "true",
    allowJobReexportOnChange: process.env.HCP_ALLOW_JOB_REEXPORT_ON_CHANGE === "true",
  };
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string>) {
  const normalizedBase = `${baseUrl.replace(/\/+$/, "")}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(normalizedPath, normalizedBase);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`);
  return `{${entries.join(",")}}`;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizePhone(value: unknown) {
  return typeof value === "string" ? value.replace(/\D+/g, "") : "";
}

function normalizeText(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLowerCase()
    : "";
}

function normalizeAddress(value: unknown) {
  return normalizeText(value).replace(/[.,#]/g, "");
}

function pickString(
  payload: RemoteRecord | undefined,
  ...keys: string[]
): string | undefined {
  if (!payload) {
    return undefined;
  }

  for (const key of keys) {
    const value = payload[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function inferRemoteId(payload: unknown, ...extraKeys: string[]) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const candidate = payload as Record<string, unknown>;
  const keys = [
    "id",
    "customer_id",
    "estimate_id",
    "job_id",
    "address_id",
    ...extraKeys,
  ];

  for (const key of keys) {
    const value = candidate[key];

    if (typeof value === "string" && value.trim()) {
      return value;
    }

    if (typeof value === "number") {
      return `${value}`;
    }
  }

  return undefined;
}

function extractCollection(payload: unknown): RemoteRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter((entry) => entry && typeof entry === "object") as RemoteRecord[];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidate = payload as Record<string, unknown>;

  for (const key of [
    "data",
    "items",
    "results",
    "customers",
    "addresses",
    "estimates",
    "jobs",
  ]) {
    const value = candidate[key];
    if (Array.isArray(value)) {
      return value.filter((entry) => entry && typeof entry === "object") as RemoteRecord[];
    }
  }

  return [];
}

function isRetryableStatus(status: number) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

async function requestJson<TResponse>(
  config: HcpConfig,
  operation: string,
  path: string,
  init: RequestInit,
  options?: {
    allowNotFound?: boolean;
    query?: Record<string, string>;
    idempotencyKey?: string;
  },
): Promise<TResponse | null> {
  if (!config.apiKey) {
    throw new Error("Missing HCP_API_KEY.");
  }

  const response = await fetch(buildUrl(config.baseUrl, path, options?.query), {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `${config.authScheme} ${config.apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(options?.idempotencyKey
        ? {
            "Idempotency-Key": options.idempotencyKey,
            "X-Grizzly-Sync-Key": options.idempotencyKey,
          }
        : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const expectsJson =
    !text || contentType.includes("application/json") || contentType.includes("+json");
  const json = expectsJson && text ? (JSON.parse(text) as TResponse) : null;

  if (options?.allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new HcpRequestError(operation, response.status, text, isRetryableStatus(response.status));
  }

  if (!expectsJson) {
    throw new Error(
      `Housecall Pro ${operation} returned ${contentType || "a non-JSON response"} instead of JSON. Check HCP_API_BASE_URL, endpoint paths, and API access.`,
    );
  }

  return json;
}

function buildCustomerPayload(project: ProjectRecord) {
  return {
    first_name: project.customer.name.split(" ")[0] ?? project.customer.name,
    last_name: project.customer.name.split(" ").slice(1).join(" "),
    email: project.customer.email,
    mobile_number: project.customer.phone,
    company: project.customer.company,
  };
}

function buildAddressPayload(project: ProjectRecord) {
  return {
    address: project.customer.address,
    description: `${project.projectType} ${project.projectSubtype.replaceAll("_", " ")}`,
  };
}

function buildEstimatePayload(project: ProjectRecord, proposalStyle: ProposalStyle, customerId?: string) {
  return {
    customer_id: customerId,
    name: project.title,
    description: project.scopeDescription,
    proposal_style: proposalStyle,
    options: [
      {
        name: proposalStyle === "hcp" ? "Housecall Pro style" : "Premium style",
        option_number: 1,
        total: project.estimateDraft.grandTotal,
        line_items: project.estimateDraft.lineItems.map((lineItem) => ({
          name: lineItem.name,
          description: lineItem.description,
          quantity: lineItem.quantity,
          unit_price: Math.round(lineItem.sellPrice / Math.max(lineItem.quantity, 1)),
          amount: lineItem.sellPrice,
        })),
      },
    ],
    notes: project.analysisSummary.join(" "),
  };
}

function buildJobPayload(project: ProjectRecord, customerId?: string) {
  return {
    customer_id: customerId,
    description: project.scopeDescription,
    work_status: "scheduled",
    notes: project.opsNextSteps.join(" "),
  };
}

function buildAttachmentPayload(project: ProjectRecord, fileUrl: string) {
  return {
    file_url: fileUrl,
    description: `Uploaded from Grizzly Estimator for ${project.title}`,
  };
}

function getHousecallState(project: ProjectRecord): HousecallProSyncState {
  return {
    ...(project.integrationState?.housecallPro ?? {}),
  };
}

function updateProjectState(project: ProjectRecord, state: HousecallProSyncState) {
  return {
    ...project,
    integrationState: {
      ...(project.integrationState ?? {}),
      housecallPro: state,
    },
  };
}

function withSync(project: ProjectRecord, sync: IntegrationSync) {
  return {
    ...project,
    integrationSyncs: [
      sync,
      ...project.integrationSyncs.filter((existingSync) => existingSync.system !== "housecall-pro"),
    ],
  };
}

function buildFailureResult(input: {
  project: ProjectRecord;
  state: HousecallProSyncState;
  status: IntegrationStatus;
  message: string;
  updatedAt: string;
  operation: string;
  retryable: boolean;
  recoveryAction?: string;
}) {
  const sync: IntegrationSync = {
    system: "housecall-pro",
    status: input.status,
    message: input.message,
    updatedAt: input.updatedAt,
    retryable: input.retryable,
    recoveryAction: input.recoveryAction,
    operation: input.operation,
    remoteId:
      input.state.estimateId ?? input.state.jobId ?? input.state.customerId,
    customerId: input.state.customerId,
    estimateId: input.state.estimateId,
    jobId: input.state.jobId,
  };

  return {
    sync,
    updatedProject: withSync(
      updateProjectState(input.project, {
        ...input.state,
        lastFailureAt: input.updatedAt,
      }),
      sync,
    ),
  } satisfies SyncResult;
}

function buildSuccessResult(input: {
  project: ProjectRecord;
  state: HousecallProSyncState;
  updatedAt: string;
  message: string;
}) {
  const sync: IntegrationSync = {
    system: "housecall-pro",
    status: "synced",
    message: input.message,
    updatedAt: input.updatedAt,
    remoteId: input.state.estimateId ?? input.state.jobId ?? input.state.customerId,
    customerId: input.state.customerId,
    estimateId: input.state.estimateId,
    jobId: input.state.jobId,
  };

  return {
    sync,
    updatedProject: withSync(
      updateProjectState(input.project, {
        ...input.state,
        lastSuccessAt: input.updatedAt,
      }),
      sync,
    ),
  } satisfies SyncResult;
}

function findAttachmentUrl(project: ProjectRecord) {
  return project.attachments.find(
    (attachment) => attachment.kind === "video" && (attachment.storageKey || attachment.previewUrl),
  );
}

type CustomerMatch = {
  customer?: RemoteRecord;
  ambiguous?: boolean;
};

function getRemoteCustomerName(customer: RemoteRecord) {
  const fullName = pickString(customer, "name", "display_name");

  if (fullName) {
    return fullName;
  }

  return [pickString(customer, "first_name"), pickString(customer, "last_name")]
    .filter(Boolean)
    .join(" ");
}

function getRemoteCustomerAddress(customer: RemoteRecord) {
  return pickString(
    customer,
    "address",
    "address_line_1",
    "street",
    "street1",
    "line1",
  );
}

function scoreCustomerMatch(project: ProjectRecord, customer: RemoteRecord) {
  const localEmail = normalizeEmail(project.customer.email);
  const remoteEmail = normalizeEmail(pickString(customer, "email", "email_address"));
  const localPhone = normalizePhone(project.customer.phone);
  const remotePhone = normalizePhone(
    pickString(customer, "mobile_number", "mobile_phone", "phone", "phone_number"),
  );
  const localName = normalizeText(project.customer.name);
  const remoteName = normalizeText(getRemoteCustomerName(customer));
  const localCompany = normalizeText(project.customer.company);
  const remoteCompany = normalizeText(pickString(customer, "company", "company_name"));
  const localAddress = normalizeAddress(project.customer.address);
  const remoteAddress = normalizeAddress(getRemoteCustomerAddress(customer));

  const exactEmail = Boolean(localEmail && remoteEmail && localEmail === remoteEmail);
  const exactPhone = Boolean(localPhone && remotePhone && localPhone === remotePhone);
  const exactName = Boolean(localName && remoteName && localName === remoteName);
  const exactCompany = Boolean(
    localCompany && remoteCompany && localCompany === remoteCompany,
  );
  const exactAddress = Boolean(
    localAddress && remoteAddress && localAddress === remoteAddress,
  );

  const verified =
    exactEmail ||
    (exactPhone && (exactName || exactCompany || exactAddress)) ||
    (exactName && exactCompany && exactAddress);

  const score =
    (exactEmail ? 5 : 0) +
    (exactPhone ? 4 : 0) +
    (exactName ? 3 : 0) +
    (exactCompany ? 2 : 0) +
    (exactAddress ? 2 : 0);

  return {
    score,
    verified,
  };
}

async function tryFindCustomer(
  config: HcpConfig,
  project: ProjectRecord,
): Promise<CustomerMatch> {
  const searchRequests: Array<{
    query: Record<string, string>;
    operation: string;
  }> = [];

  if (project.customer.email?.trim()) {
    searchRequests.push({
      query: { email: project.customer.email.trim() },
      operation: "search customer by email",
    });
  }

  if (project.customer.phone?.trim()) {
    searchRequests.push({
      query: { mobile_number: project.customer.phone.trim() },
      operation: "search customer by phone",
    });
  }

  const candidates: RemoteRecord[] = [];

  for (const request of searchRequests) {
    try {
      const payload = await requestJson<unknown>(config, request.operation, config.customersPath, {
        method: "GET",
      }, {
        query: request.query,
      });

      candidates.push(...extractCollection(payload));
    } catch (error) {
      if (error instanceof HcpRequestError && [400, 404, 405].includes(error.status)) {
        continue;
      }

      throw error;
    }
  }

  const scoredCandidates = candidates
    .filter((customer, index, allCustomers) => {
      const customerId = inferRemoteId(customer);

      if (!customerId) {
        return allCustomers.indexOf(customer) === index;
      }

      return (
        allCustomers.findIndex((candidate) => inferRemoteId(candidate) === customerId) === index
      );
    })
    .map((customer) => ({
      customer,
      ...scoreCustomerMatch(project, customer),
    }))
    .filter((candidate) => candidate.verified)
    .sort((left, right) => right.score - left.score);

  if (scoredCandidates.length === 0) {
    return {};
  }

  const topScore = scoredCandidates[0]?.score ?? 0;
  const topCandidates = scoredCandidates.filter((candidate) => candidate.score === topScore);

  if (topCandidates.length > 1) {
    return {
      ambiguous: true,
    };
  }

  return {
    customer: topCandidates[0]?.customer,
  };
}

async function getCustomerById(config: HcpConfig, customerId?: string) {
  if (!customerId) {
    return null;
  }

  return requestJson<RemoteRecord>(
    config,
    "get customer",
    config.customerTemplate.replace("{customerId}", customerId),
    {
      method: "GET",
    },
    {
      allowNotFound: true,
    },
  );
}

async function getCustomerAddresses(config: HcpConfig, customerId: string) {
  const payload = await requestJson<unknown>(
    config,
    "list customer addresses",
    config.customerAddressesTemplate.replace("{customerId}", customerId),
    {
      method: "GET",
    },
    {
      allowNotFound: true,
    },
  );

  return extractCollection(payload);
}

function findMatchingAddress(project: ProjectRecord, addresses: RemoteRecord[]) {
  const normalizedAddress = normalizeAddress(project.customer.address);

  return addresses.find((address) => {
    const remoteAddress = normalizeAddress(
      pickString(address, "address", "address_line_1", "street", "street1", "line1"),
    );
    return Boolean(normalizedAddress && remoteAddress && normalizedAddress === remoteAddress);
  });
}

async function getEstimateById(config: HcpConfig, estimateId?: string) {
  if (!estimateId) {
    return null;
  }

  return requestJson<RemoteRecord>(
    config,
    "get estimate",
    config.estimateTemplate.replace("{estimateId}", estimateId),
    {
      method: "GET",
    },
    {
      allowNotFound: true,
    },
  );
}

async function getJobById(config: HcpConfig, jobId?: string) {
  if (!jobId) {
    return null;
  }

  return requestJson<RemoteRecord>(
    config,
    "get job",
    config.jobTemplate.replace("{jobId}", jobId),
    {
      method: "GET",
    },
    {
      allowNotFound: true,
    },
  );
}

function buildSyncKey(projectId: string, operation: string, value: unknown) {
  return fingerprint({
    projectId,
    operation,
    value,
  });
}

function toRecoveryAction(error: unknown) {
  if (error instanceof HcpRequestError) {
    if (error.status === 401 || error.status === 403) {
      return "Verify the Housecall Pro API key and confirm the account still has Public API access.";
    }

    if (error.status === 404) {
      return "Verify the configured Housecall Pro endpoint paths and confirm the API resource still exists.";
    }

    if (error.status === 409) {
      return "Retry after checking whether a duplicate customer, estimate, or job was created in Housecall Pro.";
    }

    if (error.status === 429) {
      return "Housecall Pro rate-limited this request. Wait and retry the sync.";
    }

    if (error.retryable) {
      return "Retry the sync. The project now keeps partial remote IDs so the next attempt can resume safely.";
    }
  }

  return "Review the sync error details, then retry once the upstream issue is resolved.";
}

function toFailureMessage(operation: string, error: unknown) {
  if (error instanceof Error) {
    return `Housecall Pro ${operation} failed: ${error.message}`;
  }

  return `Housecall Pro ${operation} failed because of an unknown integration error.`;
}

export async function runHousecallProSync(
  project: ProjectRecord,
  proposalStyle: ProposalStyle,
): Promise<SyncResult> {
  const config = getConfig();
  const updatedAt = new Date().toISOString();
  const state = getHousecallState(project);
  let workingState: HousecallProSyncState = {
    ...state,
    lastAttemptAt: updatedAt,
    retryCount: (state.retryCount ?? 0) + 1,
  };

  if (!config.apiKey) {
    return buildFailureResult({
      project,
      state: workingState,
      status: "failed",
      message:
        "Housecall Pro sync is configured for live API mode, but HCP_API_KEY is missing. Add your admin-generated API key to enable customer and estimate export.",
      updatedAt,
      operation: "authenticate",
      retryable: false,
      recoveryAction:
        "Add HCP_API_KEY and confirm the Housecall Pro account is on a MAX plan with Public API access.",
    });
  }

  const customerPayload = buildCustomerPayload(project);
  const addressPayload = buildAddressPayload(project);
  const primaryAttachment = findAttachmentUrl(project);

  try {
    let customer = await getCustomerById(config, workingState.customerId);

    if (!customer) {
      const customerMatch = await tryFindCustomer(config, project);

      if (customerMatch.ambiguous) {
        return buildFailureResult({
          project,
          state: workingState,
          status: "matched_duplicate",
          message:
            "Housecall Pro returned multiple matching customers for this project. Sync stopped to avoid creating or attaching the estimate to the wrong customer.",
          updatedAt,
          operation: "match_customer",
          retryable: false,
          recoveryAction:
            "Open Housecall Pro, confirm the correct customer record, then clean up or merge the duplicates before retrying.",
        });
      }

      customer = customerMatch.customer ?? null;
    }

    if (!customer) {
      const createdCustomer = await requestJson<RemoteRecord>(
        config,
        "create customer",
        config.customersPath,
        {
          method: "POST",
          body: JSON.stringify(customerPayload),
        },
        {
          idempotencyKey: buildSyncKey(project.id, "create-customer", customerPayload),
        },
      );

      workingState = {
        ...workingState,
        customerId: inferRemoteId(createdCustomer) ?? workingState.customerId,
        customerFingerprint: fingerprint(customerPayload),
      };
      customer = createdCustomer;
    } else {
      workingState = {
        ...workingState,
        customerId: inferRemoteId(customer) ?? workingState.customerId,
        customerFingerprint: fingerprint(customerPayload),
      };
    }
  } catch (error) {
    return buildFailureResult({
      project,
      state: workingState,
      status: "failed",
      message: toFailureMessage("customer sync", error),
      updatedAt,
      operation: "customer_sync",
      retryable:
        error instanceof HcpRequestError ? error.retryable : true,
      recoveryAction: toRecoveryAction(error),
    });
  }

  try {
    if (workingState.customerId) {
      let matchingAddress: RemoteRecord | undefined;

      if (workingState.customerAddressId) {
        const addresses = await getCustomerAddresses(config, workingState.customerId);
        matchingAddress = addresses.find(
          (address) => inferRemoteId(address) === workingState.customerAddressId,
        );
      } else {
        const addresses = await getCustomerAddresses(config, workingState.customerId);
        matchingAddress = findMatchingAddress(project, addresses);
      }

      if (matchingAddress) {
        workingState = {
          ...workingState,
          customerAddressId: inferRemoteId(matchingAddress, "address_id") ?? workingState.customerAddressId,
        };
      } else {
        const createdAddress = await requestJson<RemoteRecord>(
          config,
          "create customer address",
          config.customerAddressesTemplate.replace("{customerId}", workingState.customerId),
          {
            method: "POST",
            body: JSON.stringify(addressPayload),
          },
          {
            idempotencyKey: buildSyncKey(project.id, "create-customer-address", addressPayload),
          },
        );

        workingState = {
          ...workingState,
          customerAddressId:
            inferRemoteId(createdAddress, "address_id") ?? workingState.customerAddressId,
        };
      }
    }
  } catch (error) {
    return buildFailureResult({
      project,
      state: workingState,
      status: "failed",
      message: toFailureMessage("address sync", error),
      updatedAt,
      operation: "address_sync",
      retryable:
        error instanceof HcpRequestError ? error.retryable : true,
      recoveryAction: toRecoveryAction(error),
    });
  }

  const finalizedEstimatePayload = buildEstimatePayload(
    project,
    proposalStyle,
    workingState.customerId,
  );
  const estimateFingerprint = fingerprint(finalizedEstimatePayload);

  try {
    const remoteEstimate = await getEstimateById(config, workingState.estimateId);

    if (remoteEstimate && workingState.estimateFingerprint === estimateFingerprint) {
      workingState = {
        ...workingState,
        estimateId: inferRemoteId(remoteEstimate) ?? workingState.estimateId,
        estimateFingerprint,
        lastSyncKey: buildSyncKey(project.id, "estimate", finalizedEstimatePayload),
      };
    } else if (remoteEstimate && !config.allowEstimateReexportOnChange) {
      return buildFailureResult({
        project,
        state: workingState,
        status: "review_required",
        message:
          "The project changed after the last Housecall Pro estimate export. Sync stopped to avoid creating a duplicate estimate automatically.",
        updatedAt,
        operation: "reconcile_estimate",
        retryable: false,
        recoveryAction:
          "Review the existing estimate in Housecall Pro. If you want automatic re-export on changed drafts, set HCP_ALLOW_ESTIMATE_REEXPORT_ON_CHANGE=true.",
      });
    } else {
      const createdEstimate = await requestJson<RemoteRecord>(
        config,
        remoteEstimate ? "re-export estimate" : "create estimate",
        config.estimatesPath,
        {
          method: "POST",
          body: JSON.stringify(finalizedEstimatePayload),
        },
        {
          idempotencyKey: buildSyncKey(project.id, "create-estimate", finalizedEstimatePayload),
        },
      );

      workingState = {
        ...workingState,
        estimateId: inferRemoteId(createdEstimate) ?? workingState.estimateId,
        estimateFingerprint,
        lastSyncKey: buildSyncKey(project.id, "estimate", finalizedEstimatePayload),
      };
    }
  } catch (error) {
    return buildFailureResult({
      project,
      state: workingState,
      status: "failed",
      message: toFailureMessage("estimate export", error),
      updatedAt,
      operation: "estimate_export",
      retryable:
        error instanceof HcpRequestError ? error.retryable : true,
      recoveryAction: toRecoveryAction(error),
    });
  }

  if (!config.enableJobCreation) {
    return buildSuccessResult({
      project: {
        ...project,
        proposalVariants: project.proposalVariants.map((variant) =>
          variant.style === proposalStyle
            ? {
                ...variant,
                lastExportedAt: updatedAt,
              }
            : variant,
        ),
      },
      state: workingState,
      updatedAt,
      message:
        "Customer matching and estimate export completed in Housecall Pro. Job creation remains disabled for this workspace.",
    });
  }

  const finalizedJobPayload = buildJobPayload(project, workingState.customerId);
  const jobFingerprint = fingerprint(finalizedJobPayload);

  try {
    const remoteJob = await getJobById(config, workingState.jobId);

    if (remoteJob && workingState.jobFingerprint === jobFingerprint) {
      workingState = {
        ...workingState,
        jobId: inferRemoteId(remoteJob) ?? workingState.jobId,
        jobFingerprint,
      };
    } else if (remoteJob && !config.allowJobReexportOnChange) {
      return buildFailureResult({
        project,
        state: workingState,
        status: "review_required",
        message:
          "The project changed after the last Housecall Pro job export. Sync stopped to avoid creating a duplicate job automatically.",
        updatedAt,
        operation: "reconcile_job",
        retryable: false,
        recoveryAction:
          "Review the existing job in Housecall Pro. If you want automatic re-export on changed jobs, set HCP_ALLOW_JOB_REEXPORT_ON_CHANGE=true.",
      });
    } else {
      const createdJob = await requestJson<RemoteRecord>(
        config,
        remoteJob ? "re-export job" : "create job",
        config.jobsPath,
        {
          method: "POST",
          body: JSON.stringify(finalizedJobPayload),
        },
        {
          idempotencyKey: buildSyncKey(project.id, "create-job", finalizedJobPayload),
        },
      );

      workingState = {
        ...workingState,
        jobId: inferRemoteId(createdJob) ?? workingState.jobId,
        jobFingerprint,
      };
    }
  } catch (error) {
    return buildFailureResult({
      project,
      state: workingState,
      status: "failed",
      message: toFailureMessage("job export", error),
      updatedAt,
      operation: "job_export",
      retryable:
        error instanceof HcpRequestError ? error.retryable : true,
      recoveryAction: toRecoveryAction(error),
    });
  }

  try {
    const attachmentFingerprint = primaryAttachment
      ? fingerprint({
          storageKey: primaryAttachment.storageKey,
          previewUrl: primaryAttachment.previewUrl,
          jobId: workingState.jobId,
        })
      : undefined;

    if (
      workingState.jobId &&
      primaryAttachment &&
      attachmentFingerprint &&
      workingState.attachmentFingerprint !== attachmentFingerprint
    ) {
      const attachmentUrl = primaryAttachment.storageKey
        ? await createSignedUploadAccessUrl(primaryAttachment.storageKey, 60 * 60 * 24)
        : primaryAttachment.previewUrl?.startsWith("http")
          ? primaryAttachment.previewUrl
          : undefined;

      if (attachmentUrl) {
        await requestJson<RemoteRecord>(
          config,
          "attach file to job",
          config.jobAttachmentsTemplate.replace("{jobId}", workingState.jobId),
          {
            method: "POST",
            body: JSON.stringify(buildAttachmentPayload(project, attachmentUrl)),
          },
          {
            idempotencyKey: buildSyncKey(project.id, "create-job-attachment", {
              jobId: workingState.jobId,
              attachmentUrl,
            }),
          },
        );

        workingState = {
          ...workingState,
          attachmentFingerprint,
        };
      }
    }
  } catch (error) {
    return buildFailureResult({
      project,
      state: workingState,
      status: "failed",
      message: toFailureMessage("job attachment export", error),
      updatedAt,
      operation: "job_attachment_export",
      retryable:
        error instanceof HcpRequestError ? error.retryable : true,
      recoveryAction: toRecoveryAction(error),
    });
  }

  return buildSuccessResult({
    project: {
      ...project,
      proposalVariants: project.proposalVariants.map((variant) =>
        variant.style === proposalStyle
          ? {
              ...variant,
              lastExportedAt: updatedAt,
            }
          : variant,
      ),
    },
    state: workingState,
    updatedAt,
    message:
      "Customer matching, estimate export, and job sync completed in Housecall Pro.",
  });
}
