import "server-only";

import { secureProposalVariants } from "@/lib/proposal-share";
import { initializeProposalWorkflow } from "@/lib/proposal-workflow";
import { getPriceBookEntries } from "@/lib/price-book";
import { analyzeProject } from "@/lib/estimate-engine";
import { getSeedProjectInputs } from "@/lib/scenarios";
import {
  getProjectsTableName,
  getSupabaseAdmin,
  type AppProjectRow,
} from "@/lib/supabase-admin";
import type { DashboardData, ProjectRecord } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

function withSecureProposalLinks(project: ProjectRecord): ProjectRecord {
  return {
    ...project,
    proposalVariants: secureProposalVariants(project),
  };
}

function withoutSecureProposalLinks(project: ProjectRecord): ProjectRecord {
  return {
    ...project,
    proposalVariants: project.proposalVariants.map((variant) => ({
      ...variant,
      sharePath: `/proposal/${project.id}?style=${variant.style}`,
    })),
  };
}

function normalizeProjectTimestamp(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function serializeProject(project: ProjectRecord) {
  return {
    id: project.id,
    payload: withoutSecureProposalLinks(project) as unknown as AppProjectRow["payload"],
    created_at: normalizeProjectTimestamp(project.createdAt),
    updated_at: normalizeProjectTimestamp(project.updatedAt),
  } satisfies AppProjectRow;
}

function deserializeProject(row: Pick<AppProjectRow, "payload">) {
  const payload = row.payload as unknown as ProjectRecord;
  const normalizedProject = initializeProposalWorkflow(
    payload,
    payload.createdByEmail,
  );

  return withSecureProposalLinks(normalizedProject);
}

async function seedProjects() {
  const priceBook = await getPriceBookEntries();
  const projects = getSeedProjectInputs().map((project) =>
    initializeProposalWorkflow(analyzeProject(project, priceBook)),
  );
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from(getProjectsTableName()).upsert(
    projects.map(serializeProject),
    {
      onConflict: "id",
      ignoreDuplicates: false,
    },
  );

  if (error) {
    throw new Error(`Failed to seed projects: ${error.message}`);
  }

  return projects.map(withSecureProposalLinks);
}

async function readProjectRows() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(getProjectsTableName())
    .select("id, payload, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to read projects: ${error.message}`);
  }

  return (data ?? []) as AppProjectRow[];
}

export async function listProjects() {
  const rows = await readProjectRows();

  if (rows.length === 0) {
    return seedProjects();
  }

  return rows.map(deserializeProject);
}

export async function getProjectById(projectId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(getProjectsTableName())
    .select("payload")
    .eq("id", projectId)
    .maybeSingle<Pick<AppProjectRow, "payload">>();

  if (error) {
    throw new Error(`Failed to load project ${projectId}: ${error.message}`);
  }

  return data ? deserializeProject(data) : undefined;
}

export async function upsertProject(project: ProjectRecord) {
  const supabase = getSupabaseAdmin();
  const row = serializeProject(project);
  const { error } = await supabase.from(getProjectsTableName()).upsert(row, {
    onConflict: "id",
    ignoreDuplicates: false,
  });

  if (error) {
    throw new Error(`Failed to save project ${project.id}: ${error.message}`);
  }

  return withSecureProposalLinks(project);
}

export async function getDashboardData(): Promise<DashboardData> {
  const projects = await listProjects();
  const priceBook = await getPriceBookEntries();
  const totalQuoted = projects.reduce(
    (total, project) => total + project.estimateDraft.grandTotal,
    0,
  );
  const reviewRequired = projects.filter(
    (project) => project.estimateDraft.reviewStatus === "owner_review_required",
  ).length;
  const customerApproved = projects.filter(
    (project) => project.proposalWorkflow.status === "customer_approved",
  ).length;

  return {
    projects,
    stats: [
      {
        label: "Quoted pipeline",
        value: formatCurrency(totalQuoted),
        detail: "Live total across the Supabase-backed project store.",
      },
      {
        label: "Owner review",
        value: `${reviewRequired}`,
        detail: "Projects still holding manual review gates.",
      },
      {
        label: "Approved jobs",
        value: `${customerApproved}`,
        detail: "Projects already approved by the customer.",
      },
      {
        label: "Price book rows",
        value: `${priceBook.length}`,
        detail: "Entries loaded from your current price book CSV.",
      },
    ],
    priceBookPreview: priceBook.slice(0, 5),
    lastUpdated: new Date().toISOString(),
  };
}
