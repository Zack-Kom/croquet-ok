-- Duty rota (secretary's weekly volunteer duty schedule — Bar/Greenkeeper/Opening/etc).
-- Was localStorage-only under "sec-rota:{clubName}" (active weeks) and
-- "sec-rota-archive:{clubName}" (completed/removed weeks). Archiving is modeled as a
-- state flag on the same row rather than a separate table — a week transitions state,
-- it doesn't move to fundamentally different storage.
--
-- `assignee` is a free-text member name (not a player_id FK) — matches the app's current
-- claim/release mechanic, which just writes a name string, not a resolved player.

create table public.club_rota_weeks (
  id                uuid primary key default gen_random_uuid(),
  club_id           uuid not null references public.clubs(id),
  legacy_id         text,   -- preserves the original localStorage-generated id
  label             text,   -- e.g. "7–13 February"
  start_date        date not null,
  notified_ann_id   text,
  notified_at       timestamptz,
  archived          boolean not null default false,
  archived_at       timestamptz,
  archived_reason   text,   -- 'completed' | 'removed'
  auto_archived     boolean not null default false,
  created_at        timestamptz not null default now()
);

create index club_rota_weeks_club_idx on public.club_rota_weeks (club_id, start_date);

create table public.club_rota_slots (
  id          uuid primary key default gen_random_uuid(),
  week_id     uuid not null references public.club_rota_weeks(id) on delete cascade,
  duty        text not null,
  assignee    text,
  confirmed   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index club_rota_slots_week_idx on public.club_rota_slots (week_id);

alter table public.club_rota_weeks enable row level security;
alter table public.club_rota_slots enable row level security;

create policy "club members can view rota weeks"
  on public.club_rota_weeks for select
  to authenticated
  using (public.user_is_club_member(club_id));

-- Secretaries (or admins) manage the rota's structure (weeks/duties); any club member
-- can still claim/release/confirm their own slot via the slots table policy below.
create policy "secretaries can manage rota weeks"
  on public.club_rota_weeks for all
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      join public.clubs c on c.id = club_rota_weeks.club_id
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or ('secretary' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  )
  with check (
    exists (
      select 1 from public.user_roles ur
      join public.clubs c on c.id = club_rota_weeks.club_id
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or ('secretary' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  );

create policy "club members can view rota slots"
  on public.club_rota_slots for select
  to authenticated
  using (exists (select 1 from public.club_rota_weeks w where w.id = club_rota_slots.week_id and public.user_is_club_member(w.club_id)));

-- Any club member can claim/release an open slot or update their own assignment
-- (confirm), or a secretary/admin can manage any slot (add duty types, reassign, etc).
create policy "club members can update rota slots"
  on public.club_rota_slots for update
  to authenticated
  using (exists (select 1 from public.club_rota_weeks w where w.id = club_rota_slots.week_id and public.user_is_club_member(w.club_id)))
  with check (exists (select 1 from public.club_rota_weeks w where w.id = club_rota_slots.week_id and public.user_is_club_member(w.club_id)));

create policy "secretaries can insert/delete rota slots"
  on public.club_rota_slots for insert
  to authenticated
  with check (
    exists (
      select 1 from public.club_rota_weeks w
      join public.user_roles ur on ur.clerk_user_id = auth.jwt() ->> 'sub'
      join public.clubs c on c.id = w.club_id
      where w.id = club_rota_slots.week_id
        and (ur.is_admin = true or ('secretary' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  );

create policy "secretaries can delete rota slots"
  on public.club_rota_slots for delete
  to authenticated
  using (
    exists (
      select 1 from public.club_rota_weeks w
      join public.user_roles ur on ur.clerk_user_id = auth.jwt() ->> 'sub'
      join public.clubs c on c.id = w.club_id
      where w.id = club_rota_slots.week_id
        and (ur.is_admin = true or ('secretary' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  );
