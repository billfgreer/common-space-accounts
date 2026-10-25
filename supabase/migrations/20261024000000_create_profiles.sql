-- Profiles table: one row per Supabase Auth user.
-- Rows are created exclusively by the register Edge Function (service role),
-- after screening has already run — never by client-side signup.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  organization text,
  country text not null,
  role text not null default 'requester' check (role in ('admin', 'requester')),
  status text not null check (status in ('active', 'rejected')),
  screening_log jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users may read only their own profile (used for role/status checks after login).
create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

-- No insert/update/delete policies for regular users: profile rows are
-- written only by the Edge Function using the service role key, which
-- bypasses RLS. Role/status changes for v1 are direct DB edits by an admin.
