-- Fixtures/live-scoring — the highest-stakes, most stateful area of the app (turn-by-turn
-- hoop/peg state, undo history), explicitly deferred out of migration 010 pending a
-- dedicated design pass. Games were 100% IndexedDB-backed (no Supabase presence at all)
-- until now.
--
-- Note: an unrelated `public.fixtures` table already exists (migration 008) but was never
-- wired up in the app — event.fixtures[] (the real, richer fixture model with rounds/
-- byes/doubles) stayed localStorage-only, and this dormant table has zero callers in
-- App.jsx. Left untouched here; reconciling it is a separate future concern, not part of
-- this migration.
--
-- Structured columns for identity/status/players/links (per the design direction noted
-- when this was first deferred), plus a single `state` jsonb column for the live-play
-- engine internals (progress/pegged/currentTurn/eventLog/history/bisques/gc*) — that
-- state has no independent per-row lifecycle of its own; it only ever makes sense
-- read/written as a whole snapshot of "the game right now" (same reasoning as
-- committee_portal/pe_config). `legacy_id` preserves the local Date.now()-string id so
-- every persist() call upserts the same row instead of duplicating (onConflict: legacy_id).
--
-- club_id may be null — a game played without an event (practice/casual) may have no
-- resolvable club at all if venue is blank.

create table public.games (
  id                uuid primary key default gen_random_uuid(),
  legacy_id         text unique not null,
  event_id          uuid references public.events(id) on delete set null,
  club_id           uuid references public.clubs(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  player_ab         text,
  player_ry         text,
  game_type         text,
  variant           text,      -- 'AC' | 'GC'
  venue             text,
  visibility        text not null default 'private',
  lawn              text,
  title             text,

  max_hoops         int,
  winner            text,      -- 'AB' | 'RY' | null
  turn_count        int not null default 0,
  is_draw           boolean not null default false,
  ended_by_time     boolean not null default false,
  sides_confirmed   boolean not null default false,
  advanced_flow     boolean not null default false,
  time_limit        int,

  player_ids        jsonb,     -- { blue, black, red, yellow: player uuid }
  partners          jsonb,     -- { blue, black, red, yellow: partner name }

  state             jsonb not null default '{}'::jsonb
);

create index games_event_idx on public.games (event_id);
create index games_club_idx on public.games (club_id);

create trigger games_updated_at
  before update on public.games
  for each row execute function public.set_updated_at();

alter table public.games enable row level security;

-- Matches the app's existing (lax) trust model for live scoring — any authenticated
-- club member can view or update a game at their club; games with no club (practice,
-- no venue set) are visible/writable to any authenticated user, mirroring how the app
-- doesn't restrict who may pick up a device and score a casual game today.
create policy "club members can view games"
  on public.games for select
  to authenticated
  using (club_id is null or public.user_is_club_member(club_id));

create policy "authenticated users can create games"
  on public.games for insert
  to authenticated
  with check (true);

create policy "club members can update games"
  on public.games for update
  to authenticated
  using (club_id is null or public.user_is_club_member(club_id))
  with check (club_id is null or public.user_is_club_member(club_id));

create policy "club members can delete games"
  on public.games for delete
  to authenticated
  using (club_id is null or public.user_is_club_member(club_id));
