create table if not exists public.estimate_items (
  id uuid primary key,
  estimate_id uuid references public.estimates(id) on delete cascade,
  area text,
  name text,
  description text,
  quantity numeric,
  unit text,
  material_cost numeric,
  sell_price numeric,
  labor_hours numeric,
  status text,
  source text,
  created_at timestamptz default now()
);

create index if not exists estimate_items_estimate_id_idx
  on public.estimate_items (estimate_id);

create index if not exists estimate_items_status_idx
  on public.estimate_items (status);

create index if not exists estimate_items_source_idx
  on public.estimate_items (source);

alter table public.estimate_items enable row level security;
