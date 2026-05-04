create table if not exists public.attachments (
  id uuid primary key,
  customer_id uuid references public.customers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  project_record_id text references public.app_projects(id) on delete set null,
  storage_key text not null,
  kind text,
  file_name text,
  content_type text,
  size_bytes bigint,
  created_at timestamptz default now()
);

create index if not exists attachments_customer_id_idx
  on public.attachments (customer_id);

create index if not exists attachments_job_id_idx
  on public.attachments (job_id);

create index if not exists attachments_project_record_id_idx
  on public.attachments (project_record_id);

create index if not exists attachments_storage_key_idx
  on public.attachments (storage_key);

alter table public.attachments enable row level security;
