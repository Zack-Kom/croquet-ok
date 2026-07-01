-- Corrects lawn_log/lawn_contacts/lawn_problems/lawn_hoops (migration 009) to match the
-- real LawnsKeeperView UI, which is substantially different from the first-pass schema:
--   - All four support an "applies to all lawns" option (lawnId "all" in the app) —
--     lawn_id needs to be nullable, with a direct club_id fallback for RLS.
--   - lawn_log needs product/quantity/unit/supplier (treat/feed/topdress/seed tasks) and
--     a by_id reference to who logged it, not just a free-text "detail" string.
--   - lawn_contacts needs kind (inhouse/contractor), an optional member_id link for
--     in-house volunteers, an organisation field, and an app_access flag.
--   - lawn_problems is keyed by a problem TYPE (nutgrass/fungi/etc, see PROBLEM_TYPES)
--     with a title/notes/first-noted-date/spatial marks — not description/severity.
--   - lawn_hoops is a simple rotation LOG (date + lawn + notes), not per-hoop x/y tracking.

-- ─── lawn_log ────────────────────────────────────────────────────────────────
alter table public.lawn_log
  add column club_id  uuid references public.clubs(id),
  add column task_type text,
  add column task_date date,
  add column by_id     uuid references public.lawn_contacts(id),
  add column note      text,
  add column product   text,
  add column quantity  text,
  add column unit      text,
  add column supplier  text,
  alter column lawn_id drop not null,
  alter column entry_type drop not null;

update public.lawn_log set club_id = (select club_id from public.lawns where lawns.id = lawn_log.lawn_id) where club_id is null and lawn_id is not null;

-- ─── lawn_contacts ───────────────────────────────────────────────────────────
alter table public.lawn_contacts
  add column kind       text not null default 'contractor', -- inhouse | contractor
  add column member_id  uuid,  -- optional link to a club member (no members table yet — stored loose)
  add column org        text,
  add column app_access boolean not null default false;

-- ─── lawn_problems ───────────────────────────────────────────────────────────
alter table public.lawn_problems
  add column club_id     uuid references public.clubs(id),
  add column problem_type text,
  add column title        text,
  add column notes        text,
  add column first_noted  date,
  add column marks        jsonb, -- spatial marker shapes on the grounds map — opaque UI state
  alter column lawn_id drop not null,
  alter column description drop not null;

update public.lawn_problems set club_id = (select club_id from public.lawns where lawns.id = lawn_problems.lawn_id) where club_id is null and lawn_id is not null;

-- ─── lawn_hoops: replace per-hoop x/y tracking with a simple rotation log ────
alter table public.lawn_hoops
  add column club_id  uuid references public.clubs(id),
  add column log_date date,
  add column notes    text,
  alter column lawn_id drop not null,
  alter column hoop_number drop not null;

update public.lawn_hoops set club_id = (select club_id from public.lawns where lawns.id = lawn_hoops.lawn_id) where club_id is null and lawn_id is not null;

-- ─── RLS: resolve club membership via lawn_id OR club_id on all four tables ──
drop policy if exists "club members can view lawn_log" on public.lawn_log;
create policy "club members can view lawn_log"
  on public.lawn_log for select to authenticated
  using (
    (lawn_id is not null and exists (select 1 from public.lawns l where l.id = lawn_log.lawn_id and public.user_is_club_member(l.club_id)))
    or (club_id is not null and public.user_is_club_member(club_id))
  );

drop policy if exists "lawns role can manage lawn_log" on public.lawn_log;
create policy "lawns role can manage lawn_log"
  on public.lawn_log for all to authenticated
  using (exists (
    select 1 from public.user_roles ur
    join public.clubs c on c.id = coalesce(lawn_log.club_id, (select club_id from public.lawns where lawns.id = lawn_log.lawn_id))
    where ur.clerk_user_id = auth.jwt() ->> 'sub'
      and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
  ))
  with check (exists (
    select 1 from public.user_roles ur
    join public.clubs c on c.id = coalesce(lawn_log.club_id, (select club_id from public.lawns where lawns.id = lawn_log.lawn_id))
    where ur.clerk_user_id = auth.jwt() ->> 'sub'
      and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
  ));

drop policy if exists "club members can view lawn_problems" on public.lawn_problems;
create policy "club members can view lawn_problems"
  on public.lawn_problems for select to authenticated
  using (
    (lawn_id is not null and exists (select 1 from public.lawns l where l.id = lawn_problems.lawn_id and public.user_is_club_member(l.club_id)))
    or (club_id is not null and public.user_is_club_member(club_id))
  );

drop policy if exists "lawns role can manage lawn_problems" on public.lawn_problems;
create policy "lawns role can manage lawn_problems"
  on public.lawn_problems for all to authenticated
  using (exists (
    select 1 from public.user_roles ur
    join public.clubs c on c.id = coalesce(lawn_problems.club_id, (select club_id from public.lawns where lawns.id = lawn_problems.lawn_id))
    where ur.clerk_user_id = auth.jwt() ->> 'sub'
      and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
  ))
  with check (exists (
    select 1 from public.user_roles ur
    join public.clubs c on c.id = coalesce(lawn_problems.club_id, (select club_id from public.lawns where lawns.id = lawn_problems.lawn_id))
    where ur.clerk_user_id = auth.jwt() ->> 'sub'
      and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
  ));

drop policy if exists "club members can view lawn_hoops" on public.lawn_hoops;
create policy "club members can view lawn_hoops"
  on public.lawn_hoops for select to authenticated
  using (
    (lawn_id is not null and exists (select 1 from public.lawns l where l.id = lawn_hoops.lawn_id and public.user_is_club_member(l.club_id)))
    or (club_id is not null and public.user_is_club_member(club_id))
  );

drop policy if exists "lawns role can manage lawn_hoops" on public.lawn_hoops;
create policy "lawns role can manage lawn_hoops"
  on public.lawn_hoops for all to authenticated
  using (exists (
    select 1 from public.user_roles ur
    join public.clubs c on c.id = coalesce(lawn_hoops.club_id, (select club_id from public.lawns where lawns.id = lawn_hoops.lawn_id))
    where ur.clerk_user_id = auth.jwt() ->> 'sub'
      and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
  ))
  with check (exists (
    select 1 from public.user_roles ur
    join public.clubs c on c.id = coalesce(lawn_hoops.club_id, (select club_id from public.lawns where lawns.id = lawn_hoops.lawn_id))
    where ur.clerk_user_id = auth.jwt() ->> 'sub'
      and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
  ));
