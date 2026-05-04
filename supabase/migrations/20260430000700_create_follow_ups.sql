create table if not exists public.follow_ups (
  id uuid primary key,
  job_id uuid references public.jobs(id) on delete cascade,
  due_at timestamptz not null,
  completed_at timestamptz,
  channel text,
  note text,
  created_at timestamptz default now()
);

create index if not exists follow_ups_job_id_idx
  on public.follow_ups (job_id);

create index if not exists follow_ups_due_at_idx
  on public.follow_ups (due_at);

create index if not exists follow_ups_completed_at_idx
  on public.follow_ups (completed_at);

alter table public.follow_ups enable row level security;
