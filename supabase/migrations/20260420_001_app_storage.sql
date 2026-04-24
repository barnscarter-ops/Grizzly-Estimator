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
