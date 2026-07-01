-- Follow-ups from an independent re-verification pass over the whole migration
-- (2026-07-02): a handful of genuine gaps that the original audit's per-key grep
-- didn't catch, found by tracing every direct `saveClubProfile()`/`localStorage`
-- call site rather than trusting the earlier key-pattern list alone.
--
-- member_fees (sec-fees:<club>) is a per-year, per-member fee register embedded in
-- SecMembersView — genuinely distinct from clubs.treasurer_subs (migration 025, a
-- flat club-wide array keyed by memberId), so it's its own column, not a merge.
-- notif_inbox and circuit_manual_posts are player-personal (user_prefs). river_config
-- and experimental_features are global admin settings (SuperAdminView), not per-user
-- or per-club — folded into the existing app_directory singleton alongside the
-- directory lists, same "one global admin-editable row" shape.

alter table public.clubs
  add column member_fees jsonb not null default '{}'::jsonb;

alter table public.user_prefs
  add column notif_inbox         jsonb not null default '[]'::jsonb,
  add column circuit_manual_posts jsonb not null default '[]'::jsonb;

alter table public.app_directory
  add column river_config          jsonb not null default '{}'::jsonb,
  add column experimental_features jsonb not null default '{}'::jsonb;
