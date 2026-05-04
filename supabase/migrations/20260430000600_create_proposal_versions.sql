create table if not exists public.proposal_versions (
  id uuid primary key,
  estimate_id uuid references public.estimates(id) on delete cascade,
  style text,
  status text not null default 'draft',
  sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  share_token_hash text,
  snapshot jsonb,
  created_at timestamptz default now()
);

create index if not exists proposal_versions_estimate_id_idx
  on public.proposal_versions (estimate_id);

create index if not exists proposal_versions_status_idx
  on public.proposal_versions (status);

create index if not exists proposal_versions_sent_at_idx
  on public.proposal_versions (sent_at);

alter table public.proposal_versions enable row level security;
