-- Introduces a global players table so event rosters, registrations, and attendance can
-- reference a stable player_id instead of matching on lowercased name strings (the app
-- currently does this in several places, e.g. EventRegisterTab comparing
-- r.playerName.toLowerCase() === myName.toLowerCase(), which desyncs on whitespace/casing).
--
-- A player is not necessarily a Clerk user — most event rosters are names typed in by an
-- organizer. clerk_user_id links automatically when it matches a signed-in user; otherwise
-- the row stays unclaimed, same pattern as broadcast_contributions.contributor_id/name.

create table public.players (
  id              uuid primary key default gen_random_uuid(),
  clerk_user_id   text,
  club_id         uuid references public.clubs(id),
  name            text not null,
  name_normalized text generated always as (lower(trim(name))) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index players_clerk_user_id_idx on public.players (clerk_user_id) where clerk_user_id is not null;
create index players_club_name_idx on public.players (club_id, name_normalized);

create trigger players_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

alter table public.players enable row level security;

-- Any authenticated user can read the players directory — rosters/opponent names need
-- to be visible app-wide (a player from another club can appear in your event's fixtures).
create policy "authenticated users can read players"
  on public.players for select
  to authenticated
  using (true);

-- Any authenticated user can create a player row (organizers add names on the fly).
create policy "authenticated users can create players"
  on public.players for insert
  to authenticated
  with check (true);

-- A player can update their own clerk-linked row; club admins/managers can update any
-- player row scoped to their club (e.g. fixing a typo in a roster entry).
create policy "own player or club admin/manager can update players"
  on public.players for update
  to authenticated
  using (
    clerk_user_id = auth.jwt() ->> 'sub'
    or exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (
          ur.is_admin = true
          or (
            'manager' = any(ur.roles)
            and exists (
              select 1 from public.clubs c
              where c.id = players.club_id and public.club_slug(ur.club) = c.slug
            )
          )
        )
    )
  );
