create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id),
  project_record_id text references public.app_projects(id),
  status text not null default 'draft',
  subtotal numeric,
  material_total numeric,
  labor_hours numeric,
  grand_total numeric,
  review_status text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint estimates_status_check check (
    status in (
      'draft',
      'needs_review',
      'ready_to_send',
      'sent',
      'accepted',
      'declined'
    )
  )
);

create index if not exists estimates_job_id_idx
  on public.estimates (job_id);

create index if not exists estimates_project_record_id_idx
  on public.estimates (project_record_id);

create index if not exists estimates_status_idx
  on public.estimates (status);

alter table public.estimates enable row level security;
