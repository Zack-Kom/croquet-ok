-- Batch of small, previously-localStorage-only personal/shared data structures:
-- starred games, player/club follows, notification prefs (all per-user, keyed by Clerk
-- identity directly since none of this maps cleanly to a "club member" concept), user
-- feedback (needs cross-device visibility for admin review), the app-wide directory
-- (players/coaches/equipment/affiliations — admin-curated, globally readable), and
-- club check-ins (a lighter-weight "I'm at the club today" concept, distinct from the
-- already-migrated event-specific `attendance` table).
--
-- circuit_seen/circuit_dismissed/circuit_total_unread deliberately NOT migrated here —
-- genuinely per-device read-state with no cross-device sync need, confirmed by reading
-- the actual code before deciding.

-- One row per signed-in user. clerk_user_id is the stable identity already used
-- elsewhere (user_roles.clerk_user_id) — simpler than resolving a players.id for
-- preference data that isn't inherently club-scoped.
create table public.user_prefs (
  clerk_user_id       text primary key,
  starred_games       jsonb not null default '[]'::jsonb,
  following_players   jsonb not null default '[]'::jsonb,  -- [{key, name, followedAt}]
  following_clubs     jsonb not null default '[]'::jsonb,  -- [{name, followedAt, autoFollowed}]
  notif_prefs         jsonb not null default '{}'::jsonb,
  updated_at          timestamptz not null default now()
);

create trigger user_prefs_updated_at
  before update on public.user_prefs
  for each row execute function public.set_updated_at();

alter table public.user_prefs enable row level security;

create policy "users can view own prefs"
  on public.user_prefs for select
  to authenticated
  using (clerk_user_id = auth.jwt() ->> 'sub');

create policy "users can upsert own prefs"
  on public.user_prefs for insert
  to authenticated
  with check (clerk_user_id = auth.jwt() ->> 'sub');

create policy "users can update own prefs"
  on public.user_prefs for update
  to authenticated
  using (clerk_user_id = auth.jwt() ->> 'sub')
  with check (clerk_user_id = auth.jwt() ->> 'sub');

-- Feedback: submitted by any authenticated user, reviewed/replied-to by admins across
-- devices — the whole reason this needed to leave localStorage in the first place.
create table public.feedback (
  id              uuid primary key default gen_random_uuid(),
  clerk_user_id   text,
  type            text,
  body            text,
  created_at      timestamptz not null default now(),
  read            boolean not null default false,
  reply_text      text,
  reply_icon      text,
  reply_at        timestamptz
);

alter table public.feedback enable row level security;

create policy "users can view own feedback"
  on public.feedback for select
  to authenticated
  using (clerk_user_id = auth.jwt() ->> 'sub');

create policy "admins can view all feedback"
  on public.feedback for select
  to authenticated
  using (exists (select 1 from public.user_roles ur where ur.clerk_user_id = auth.jwt() ->> 'sub' and ur.is_admin = true));

create policy "authenticated users can submit feedback"
  on public.feedback for insert
  to authenticated
  with check (true);

create policy "admins can update feedback"
  on public.feedback for update
  to authenticated
  using (exists (select 1 from public.user_roles ur where ur.clerk_user_id = auth.jwt() ->> 'sub' and ur.is_admin = true));

-- App-wide directory (players/coaches/equipment/affiliations) — admin-curated via
-- SuperAdminView, globally readable. Singleton row, jsonb per category (same shape
-- as the localStorage arrays) rather than 4 separate tables — nothing here has an
-- independent per-row lifecycle beyond what SuperAdminView already manages as whole
-- lists, matching the committee_portal/pe_config precedent.
create table public.app_directory (
  id                uuid primary key default gen_random_uuid(),
  dir_players       jsonb not null default '[]'::jsonb,
  dir_coaches       jsonb not null default '[]'::jsonb,
  dir_equipment     jsonb not null default '[]'::jsonb,
  dir_affiliations  jsonb not null default '[]'::jsonb,
  updated_at        timestamptz not null default now()
);

create trigger app_directory_updated_at
  before update on public.app_directory
  for each row execute function public.set_updated_at();

alter table public.app_directory enable row level security;

create policy "authenticated users can view directory"
  on public.app_directory for select
  to authenticated
  using (true);

create policy "admins can manage directory"
  on public.app_directory for all
  to authenticated
  using (exists (select 1 from public.user_roles ur where ur.clerk_user_id = auth.jwt() ->> 'sub' and ur.is_admin = true))
  with check (exists (select 1 from public.user_roles ur where ur.clerk_user_id = auth.jwt() ->> 'sub' and ur.is_admin = true));

-- Club check-ins: a lighter "I'm at the club today" record (reason: Play/Coaching/
-- Social/etc), distinct from the event-specific `attendance` table. Used for the
-- club's presence sheet and "checked in recently" prompts.
create table public.club_checkins (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references public.clubs(id),
  clerk_user_id   text,
  name            text,
  reason          text,
  created_at      timestamptz not null default now()
);

create index club_checkins_club_idx on public.club_checkins (club_id, created_at);

alter table public.club_checkins enable row level security;

create policy "club members can view checkins"
  on public.club_checkins for select
  to authenticated
  using (public.user_is_club_member(club_id));

create policy "authenticated users can check in"
  on public.club_checkins for insert
  to authenticated
  with check (true);
