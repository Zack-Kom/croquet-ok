-- User roles table — managed by superadmin via app UI, read by the app at sign-in
-- clerk_user_id is the Clerk user ID (user_xxxxx) — authoritative key
-- roles is a text array of role IDs from ROLE_DEFS (e.g. ['player','coach','referee'])
-- is_admin grants superadmin access

create table if not exists public.user_roles (
  id              uuid primary key default gen_random_uuid(),
  clerk_user_id   text unique not null,
  email           text,
  display_name    text,
  roles           text[] not null default '{}',
  is_admin        boolean not null default false,
  club            text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Keep updated_at current automatically
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger user_roles_updated_at
  before update on public.user_roles
  for each row execute function public.set_updated_at();

-- Anyone can read (app needs this to load roles for the signed-in user).
-- Only service_role (used by the backend/edge function) can insert/update/delete.
-- For now we keep it simple: anon read, no client-side writes.
-- The superadmin panel calls upsert via the anon key but we'll add a policy that
-- allows writes when the caller is authenticated and their own row has is_admin=true.

alter table public.user_roles enable row level security;

-- All authenticated users can read all rows (needed to list users in admin panel)
create policy "authenticated users can read user_roles"
  on public.user_roles for select
  to authenticated
  using (true);

-- Admins can insert/update/delete — admin status is checked against their own row
create policy "admins can write user_roles"
  on public.user_roles for all
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = (auth.jwt() ->> 'sub')
        and ur.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = (auth.jwt() ->> 'sub')
        and ur.is_admin = true
    )
  );

-- Seed the superadmin row so the policy can bootstrap
-- (replace clerk_user_id with real value from Clerk dashboard if needed)
-- insert into public.user_roles (clerk_user_id, email, display_name, roles, is_admin)
-- values ('user_REPLACE_ME', 'zach@kominar.com', 'Zach', array['superadmin'], true)
-- on conflict (clerk_user_id) do nothing;
