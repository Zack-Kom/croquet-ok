-- Club Grade (Elo-style rating config) and Club Ladder (challenge-based rung
-- competition) — previously the two remaining localStorage-only pieces of the club
-- profile object (profile.clubGrade / profile.ladder), deliberately excluded from
-- migration 016. Both are single-code-path writers: every mutation (secretary config
-- changes, and member-issued/resolved/cancelled ladder challenges alike) funnels
-- through the existing saveClubProfileBoth() dual-write function already wired for
-- migration 016/019/020's fields, so this is a pure schema + field-map addition — no
-- new writer surfaces to reconcile, unlike duty rota or private events.
--
-- club_grade is almost entirely a config blob (grades themselves are computed
-- on-the-fly from members+games, not stored). ladder additionally carries the only
-- durable state in this feature — rungs (ordered member-key array), challenges
-- (history of every challenge ever issued), and lastActivity (idle-detection map) — but
-- none of it benefits from being normalized into real tables (no independent lifecycle
-- per row beyond what the parent blob already tracks), so it stays jsonb like
-- committee_portal/pe_config.

alter table public.clubs
  add column club_grade jsonb not null default '{}'::jsonb,
  add column ladder     jsonb not null default '{}'::jsonb;
