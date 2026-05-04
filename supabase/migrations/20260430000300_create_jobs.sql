create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  project_record_id text references public.app_projects(id),
  title text not null,
  service_address text,
  job_type text,
  stage text not null default 'new',
  status text not null default 'open',
  source text,
  next_follow_up_at timestamptz,
  proposal_sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists jobs_customer_id_idx
  on public.jobs (customer_id);

create index if not exists jobs_stage_idx
  on public.jobs (stage);

create index if not exists jobs_next_follow_up_at_idx
  on public.jobs (next_follow_up_at);

create index if not exists jobs_project_record_id_idx
  on public.jobs (project_record_id);

alter table public.jobs enable row level security;
