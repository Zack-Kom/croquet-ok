-- Core event management: events, event_players, fixtures, registrations, attendance.
-- Replaces the localStorage "events"/"activeEvent" arrays and fixes several places where
-- players were matched by lowercased name string instead of a stable id (e.g.
-- EventRegisterTab, attendance quick-add, fixture opponent resolution) — fixtures now
-- reference players.id directly with no cached playerAName/playerBName fallback string;
-- display names resolve via join at read time.

-- Reusable check: is the caller an admin, or a 'manager' at the given club?
create or replace function public.user_is_club_manager(target_club_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_roles ur
    join public.clubs c on c.id = target_club_id
    where ur.clerk_user_id = auth.jwt() ->> 'sub'
      and (ur.is_admin = true or ('manager' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
  )
$$;

-- Reusable check: is the caller a member of the given club (any role) or admin?
create or replace function public.user_is_club_member(target_club_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_roles ur
    join public.clubs c on c.id = target_club_id
    where ur.clerk_user_id = auth.jwt() ->> 'sub'
      and (ur.is_admin = true or public.club_slug(ur.club) = c.slug)
  )
$$;

create table public.events (
  id                      uuid primary key default gen_random_uuid(),
  legacy_id               text unique,   -- preserves "ev_xxxx" ids from the old localStorage scheme
  club_id                 uuid references public.clubs(id),
  name                    text not null,
  format                  text,
  venue                   text,
  starts_at               date,
  ends_at                 date,
  registration_deadline   date,
  status                  text not null default 'draft',
  created_by              text,          -- Clerk user id
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger events_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

alter table public.events enable row level security;

create policy "club members can view events"
  on public.events for select
  to authenticated
  using (club_id is null or public.user_is_club_member(club_id));

create policy "club managers can create events"
  on public.events for insert
  to authenticated
  with check (club_id is null or public.user_is_club_manager(club_id));

create policy "club managers can update events"
  on public.events for update
  to authenticated
  using (club_id is null or public.user_is_club_manager(club_id));

create policy "club managers can delete events"
  on public.events for delete
  to authenticated
  using (club_id is null or public.user_is_club_manager(club_id));

-- ─── event_players ──────────────────────────────────────────────────────────
create table public.event_players (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  player_id   uuid not null references public.players(id),
  seed        int,
  created_at  timestamptz not null default now(),
  unique (event_id, player_id)
);

alter table public.event_players enable row level security;

create policy "club members can view event_players"
  on public.event_players for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_players.event_id
        and (e.club_id is null or public.user_is_club_member(e.club_id))
    )
  );

create policy "club managers can manage event_players"
  on public.event_players for all
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_players.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_players.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  );

-- ─── fixtures ────────────────────────────────────────────────────────────────
create table public.fixtures (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  round           int,
  player_a_id     uuid references public.players(id),
  player_a2_id    uuid references public.players(id),  -- doubles partner
  player_b_id     uuid references public.players(id),
  player_b2_id    uuid references public.players(id),
  score_a         int,
  score_b         int,
  status          text not null default 'scheduled',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger fixtures_updated_at
  before update on public.fixtures
  for each row execute function public.set_updated_at();

alter table public.fixtures enable row level security;

create policy "club members can view fixtures"
  on public.fixtures for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = fixtures.event_id
        and (e.club_id is null or public.user_is_club_member(e.club_id))
    )
  );

create policy "club managers can manage fixtures"
  on public.fixtures for all
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = fixtures.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = fixtures.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  );

-- ─── registrations ───────────────────────────────────────────────────────────
create table public.registrations (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  player_id     uuid not null references public.players(id),
  status        text not null default 'pending',  -- pending | accepted | waitlisted | declined
  note          text,
  created_at    timestamptz not null default now(),
  unique (event_id, player_id)
);

alter table public.registrations enable row level security;

create policy "club members can view registrations"
  on public.registrations for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = registrations.event_id
        and (e.club_id is null or public.user_is_club_member(e.club_id))
    )
  );

-- A player can register themselves (their own clerk-linked players row);
-- club managers/admins can register anyone.
create policy "self or manager can create registrations"
  on public.registrations for insert
  to authenticated
  with check (
    exists (select 1 from public.players p where p.id = registrations.player_id and p.clerk_user_id = auth.jwt() ->> 'sub')
    or exists (
      select 1 from public.events e
      where e.id = registrations.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  );

create policy "self or manager can update registrations"
  on public.registrations for update
  to authenticated
  using (
    exists (select 1 from public.players p where p.id = registrations.player_id and p.clerk_user_id = auth.jwt() ->> 'sub')
    or exists (
      select 1 from public.events e
      where e.id = registrations.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  );

create policy "self or manager can delete registrations"
  on public.registrations for delete
  to authenticated
  using (
    exists (select 1 from public.players p where p.id = registrations.player_id and p.clerk_user_id = auth.jwt() ->> 'sub')
    or exists (
      select 1 from public.events e
      where e.id = registrations.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  );

-- ─── attendance ──────────────────────────────────────────────────────────────
create table public.attendance (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  occurrence_id text,    -- mirrors existing makeOccurrenceId() "occ_xxxx" strings
  player_id     uuid not null references public.players(id),
  created_at    timestamptz not null default now(),
  unique (event_id, occurrence_id, player_id)
);

alter table public.attendance enable row level security;

create policy "club members can view attendance"
  on public.attendance for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = attendance.event_id
        and (e.club_id is null or public.user_is_club_member(e.club_id))
    )
  );

-- Matches today's app-layer-only check: attendance is manager-recorded, not self-service.
create policy "club managers can manage attendance"
  on public.attendance for all
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = attendance.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = attendance.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  );
