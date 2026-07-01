-- Medium-tier batch: club lawn layout, duty rota's duty-type palette (both club-scoped
-- config, single-writer, folded into `clubs` matching the jsonb-blob precedent already
-- used for committee_portal/pe_config/club_grade/ladder), coaching/squad tooling (all
-- player-scoped and single-writer — added as new columns on the existing `user_prefs`
-- table from migration 023 rather than new tables, since it's the same
-- one-row-per-clerk-user shape), and live-session state (the one genuinely multi-writer,
-- cross-device-live item in this batch — a real table, same architecture as `games`:
-- structured identity columns + one `state` jsonb blob for the fast-changing internals).

alter table public.clubs
  add column lawn_layout jsonb not null default '{}'::jsonb,
  add column duty_types  jsonb not null default '[]'::jsonb;

alter table public.user_prefs
  add column practice_data   jsonb not null default '{}'::jsonb,
  add column coach_data      jsonb not null default '{}'::jsonb,
  add column squad_data      jsonb not null default '{}'::jsonb,
  add column coach_requests  jsonb not null default '[]'::jsonb;

create table public.live_sessions (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs(id),
  session_date date not null,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  unique (club_id, session_date)
);

create index live_sessions_club_idx on public.live_sessions (club_id, session_date);

create trigger live_sessions_updated_at
  before update on public.live_sessions
  for each row execute function public.set_updated_at();

alter table public.live_sessions enable row level security;

create policy "club members can view live sessions"
  on public.live_sessions for select
  to authenticated
  using (public.user_is_club_member(club_id));

create policy "club members can manage live sessions"
  on public.live_sessions for all
  to authenticated
  using (public.user_is_club_member(club_id))
  with check (public.user_is_club_member(club_id));
