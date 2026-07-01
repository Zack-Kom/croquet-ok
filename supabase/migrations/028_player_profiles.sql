-- Extends the lightweight `players` table (migration 007, id/clerk_user_id/club_id/name
-- only, built for event-roster identity) with the full profile shape that has lived in
-- localStorage under playerProfile___me__ / playerProfile___<id>__ / playerProfile_<slug>
-- since the app's earliest version.
--
-- Deliberately reuses `players` rather than adding a new `player_profiles` table: a
-- player row IS a profile — migration 007's own rationale ("a player is not necessarily
-- a Clerk user... the row stays unclaimed") already anticipated exactly this. The richer
-- fields below just make an unclaimed roster row into a real, ownable profile once a
-- Clerk user claims it (clerk_user_id) or a club admin fills it in on their behalf.
--
-- Not migrated here: `myCheckIns` for real (non-stub) clubs already flows into
-- club_checkins (migration 023) — only the localStorage-only "stub club" check-in
-- fallback (no club row yet) needs my_checkins, kept small (capped at 200 client-side).

alter table public.players
  add column avatar            text,
  add column bio               text,
  add column phone             text,
  add column email             text,
  add column address           text,
  add column website           text,
  add column photos            jsonb not null default '[]'::jsonb,
  add column photo_position    jsonb not null default '{}'::jsonb,
  add column clubs             jsonb not null default '[]'::jsonb,
  add column club_memberships  jsonb not null default '{}'::jsonb,
  add column ac_handicap       numeric,
  add column gc_handicap       numeric,
  add column ac_index_points   numeric,
  add column gc_index_points   numeric,
  add column d_grade_ac        text,
  add column d_grade_gc        text,
  add column plays_ac          boolean,
  add column plays_gc          boolean,
  add column club_grade        jsonb not null default '{}'::jsonb,
  add column notes             text,
  add column coach             text,
  add column toolbelt          jsonb not null default '[]'::jsonb,
  add column roles             jsonb not null default '[]'::jsonb,
  add column is_admin          boolean not null default false,
  add column member_status     text,
  add column joined_at         timestamptz,
  add column my_checkins       jsonb not null default '[]'::jsonb,
  add column badges            jsonb not null default '[]'::jsonb,
  add column hcp_history       jsonb not null default '[]'::jsonb,
  add column upcoming_events   jsonb not null default '[]'::jsonb,
  add column highlights        jsonb not null default '[]'::jsonb,
  add column self_id           text;

-- Migration 007's update policy only covers a row that's *already* clerk-linked to the
-- caller, or club admins/managers — it never actually allowed the self-claim it
-- documented ("clerk_user_id links automatically when it matches a signed-in user").
-- getOrCreateSelfPlayer() needs exactly that: claim a fresh/unclaimed row (clerk_user_id
-- is null) by setting clerk_user_id to your own sub. Restricting via `with check` means
-- you can only ever claim a row as *yourself*, never set someone else's id on it.
create policy "authenticated users can self-claim an unclaimed player row"
  on public.players for update
  to authenticated
  using (clerk_user_id is null)
  with check (clerk_user_id = auth.jwt() ->> 'sub');
