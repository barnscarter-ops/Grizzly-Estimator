create extension if not exists pgcrypto;

create table if not exists public.app_projects (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists app_projects_created_at_idx
  on public.app_projects (created_at desc);

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists app_sessions_expires_at_idx
  on public.app_sessions (expires_at);

alter table public.app_projects enable row level security;
alter table public.app_sessions enable row level security;

insert into storage.buckets (id, name, public)
values ('project-attachments', 'project-attachments', false)
on conflict (id) do update
set public = excluded.public;

-- Consolidated: create customers in same migration to avoid conflicts
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  company text,
  email text,
  phone text,
  billing_address text,
  service_address text,
  notes text,
  -- Expanded fields merged from later migration
  external_customer_id text,
  first_name text,
  last_name text,
  mobile_phone text,
  home_phone text,
  work_phone text,
  additional_emails text,
  customer_type text,
  lead_source text,
  tags text,
  do_not_service boolean default false,
  last_service_date timestamptz,
  lifetime_value numeric,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists customers_email_idx
  on public.customers (email);

create index if not exists customers_phone_idx
  on public.customers (phone);

create index if not exists customers_external_customer_id_idx
  on public.customers (external_customer_id);

create index if not exists customers_mobile_phone_idx
  on public.customers (mobile_phone);

create index if not exists customers_display_name_idx
  on public.customers (display_name);

alter table public.customers enable row level security;
