import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const cwd = process.cwd();
const projectsFile = join(cwd, "data", "projects.json");
const uploadsDir = join(cwd, "data", "uploads");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const projectsTable = process.env.SUPABASE_PROJECTS_TABLE?.trim() || "app_projects";
const uploadsBucket = process.env.SUPABASE_UPLOADS_BUCKET?.trim() || "project-attachments";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeProject(project) {
  return {
    ...project,
    proposalVariants: project.proposalVariants.map((variant) => ({
      ...variant,
      sharePath: `/proposal/${project.id}?style=${variant.style}`,
    })),
    attachments: project.attachments.map((attachment) =>
      attachment.storageKey
        ? {
            ...attachment,
            previewUrl: `/api/uploads/${attachment.storageKey}`,
          }
        : attachment,
    ),
  };
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectFiles(fullPath);
      }

      return [fullPath];
    }),
  );

  return files.flat();
}

function mimeTypeForPath(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "mov":
      return "video/quicktime";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

if (!supabaseUrl || !serviceRoleKey) {
  fail("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

if (!existsSync(projectsFile)) {
  fail("No local data/projects.json file was found to migrate.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const rawProjects = JSON.parse(await readFile(projectsFile, "utf8"));
const projects = rawProjects.map(normalizeProject);

if (existsSync(uploadsDir)) {
  const localFiles = await collectFiles(uploadsDir);

  for (const filePath of localFiles) {
    const storageKey = relative(uploadsDir, filePath).replaceAll("\\", "/");
    const bytes = await readFile(filePath);
    const { error } = await supabase.storage.from(uploadsBucket).upload(storageKey, bytes, {
      contentType: mimeTypeForPath(filePath),
      upsert: true,
    });

    if (error) {
      fail(`Failed to upload ${storageKey}: ${error.message}`);
    }
  }
}

const rows = projects.map((project) => ({
  id: project.id,
  payload: project,
  created_at: project.createdAt ?? new Date().toISOString(),
  updated_at: new Date().toISOString(),
}));

const { error } = await supabase.from(projectsTable).upsert(rows, {
  onConflict: "id",
  ignoreDuplicates: false,
});

if (error) {
  fail(`Failed to migrate project rows: ${error.message}`);
}

console.log(
  `Migrated ${projects.length} project records to ${projectsTable} and uploaded local files to ${uploadsBucket}.`,
);
