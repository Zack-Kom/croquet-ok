-- Fixes a pre-existing bug in migration 003: the "admins can write user_roles" policy
-- queries user_roles from within a policy ON user_roles, which Postgres can't resolve
-- ("infinite recursion detected in policy for relation \"user_roles\"", 42P17). This was
-- dormant until now because the app never actually attached a valid Clerk JWT, so these
-- `to authenticated` policies were never evaluated (anon-role requests skip them entirely).
-- Now that auth works end-to-end, every user_roles read/write was failing with 500.
--
-- Fix: a SECURITY DEFINER function bypasses RLS for the inner admin-status lookup, avoiding
-- self-reference. Also adds a policy letting a user upsert their OWN row (clerk_user_id
-- matches their JWT sub) — needed for the app's first-sign-in self-provisioning flow,
-- which the original admin-only write policy never allowed for a brand-new non-admin user.

create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select is_admin from public.user_roles where clerk_user_id = auth.jwt() ->> 'sub'),
    false
  )
$$;

drop policy if exists "admins can write user_roles" on public.user_roles;

create policy "admins can write any user_roles row"
  on public.user_roles for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

create policy "users can upsert their own user_roles row"
  on public.user_roles for insert
  to authenticated
  with check (clerk_user_id = auth.jwt() ->> 'sub');

create policy "users can update their own user_roles row"
  on public.user_roles for update
  to authenticated
  using (clerk_user_id = auth.jwt() ->> 'sub')
  with check (clerk_user_id = auth.jwt() ->> 'sub');
