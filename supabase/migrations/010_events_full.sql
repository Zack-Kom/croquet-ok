-- Extends the events-core skeleton from migration 008 to match the real shape of the
-- localStorage event object (App.jsx), which is substantially richer: registrations are a
-- distinct entity from the roster, teams/ties for team events, per-manager roles, recurring
-- occurrences with their own attendance/notes/overrides, capacity/fee/waitlist fields.
--
-- Fixtures/games/live-scoring are explicitly NOT extended here — deferred to a future
-- dedicated phase given their complexity (turn-by-turn hoop/peg state, undo history).

alter table public.events
  add column play_format          text not null default 'singles', -- singles | doubles | both | teams
  add column tie_structure        jsonb,          -- teams only: [{id,type,count}, ...]
  add column rc_day               text,           -- recurring: day name
  add column rc_freq              text,           -- weekly | fortnightly | monthly
  add column rc_start             text,           -- HH:MM
  add column rc_end               text,
  add column linked_play_day_slot jsonb,          -- {day, slotIndex} — Phase-2 playDays feature, not built yet
  add column registrations_open   boolean not null default true,
  add column max_players          int,
  add column cap_type             text not null default 'none', -- none | soft | hard
  add column entry_fee            text,
  add column waitlist_enabled     boolean not null default false,
  add column game_code            text,
  add column description          text,
  add column icon                 text,
  add column competitive          boolean not null default true,
  add column private_booking      boolean not null default false,
  add column organiser            text;

alter table public.event_players
  add column source text not null default 'organiser', -- organiser | self
  add column ac_hcp  text,
  add column gc_hcp  text;

-- ─── event_occurrences ────────────────────────────────────────────────────────
create table public.event_occurrences (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events(id) on delete cascade,
  legacy_id         text unique,   -- preserves "occ_xxxx" ids from makeOccurrenceId()
  date              date not null,
  status            text not null default 'upcoming', -- upcoming | cancelled
  cancelled_by_club boolean not null default false,
  notes             text,
  overrides         jsonb,
  created_at        timestamptz not null default now(),
  unique (event_id, date)
);

alter table public.event_occurrences enable row level security;

create policy "club members can view event_occurrences"
  on public.event_occurrences for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_occurrences.event_id
        and (e.club_id is null or public.user_is_club_member(e.club_id))
    )
  );

create policy "club managers can manage event_occurrences"
  on public.event_occurrences for all
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_occurrences.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_occurrences.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  );

-- Repoint attendance at event_occurrences now that the table exists. Keep the existing
-- occurrence_id text column too (mirrors makeOccurrenceId() strings during any transitional
-- period where the app still generates local occurrence ids) — drop it in a later cleanup
-- migration once the app fully reads/writes occurrence_uuid.
alter table public.attendance
  add column occurrence_uuid uuid references public.event_occurrences(id);

-- ─── event_teams / event_team_players ─────────────────────────────────────────
create table public.event_teams (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  name        text not null,
  club_id     uuid references public.clubs(id),
  created_at  timestamptz not null default now()
);

alter table public.event_teams enable row level security;

create policy "club members can view event_teams"
  on public.event_teams for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_teams.event_id
        and (e.club_id is null or public.user_is_club_member(e.club_id))
    )
  );

create policy "club managers can manage event_teams"
  on public.event_teams for all
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_teams.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_teams.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  );

create table public.event_team_players (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.event_teams(id) on delete cascade,
  player_id   uuid not null references public.players(id),
  unique (team_id, player_id)
);

alter table public.event_team_players enable row level security;

create policy "club members can view event_team_players"
  on public.event_team_players for select
  to authenticated
  using (
    exists (
      select 1 from public.event_teams t
      join public.events e on e.id = t.event_id
      where t.id = event_team_players.team_id
        and (e.club_id is null or public.user_is_club_member(e.club_id))
    )
  );

create policy "club managers can manage event_team_players"
  on public.event_team_players for all
  to authenticated
  using (
    exists (
      select 1 from public.event_teams t
      join public.events e on e.id = t.event_id
      where t.id = event_team_players.team_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  )
  with check (
    exists (
      select 1 from public.event_teams t
      join public.events e on e.id = t.event_id
      where t.id = event_team_players.team_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  );

-- ─── event_managers ────────────────────────────────────────────────────────────
create table public.event_managers (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  player_id   uuid references public.players(id),   -- nullable: a manager may not be a claimed player
  name        text not null,                         -- display name fallback, mirrors current shape
  role        text not null default 'Manager',
  added_at    timestamptz not null default now()
);

alter table public.event_managers enable row level security;

create policy "club members can view event_managers"
  on public.event_managers for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_managers.event_id
        and (e.club_id is null or public.user_is_club_member(e.club_id))
    )
  );

create policy "club managers can manage event_managers"
  on public.event_managers for all
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_managers.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_managers.event_id
        and (e.club_id is null or public.user_is_club_manager(e.club_id))
    )
  );

-- ─── registrations: source column ────────────────────────────────────────────
alter table public.registrations
  add column source text not null default 'self'; -- self | organiser
