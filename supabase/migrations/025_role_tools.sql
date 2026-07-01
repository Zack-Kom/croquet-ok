-- Five newly-discovered role-specific tools, surfaced by the full-file localStorage
-- audit — none were in the original migration scope. All 5 confirmed single-writer
-- (no concurrent-edit complexity), so straight jsonb columns on the existing
-- per-user/per-club tables rather than new tables, matching the established fast path
-- (see club_grade/ladder, migration 021) for confirmed single-write-funnel features.
--
-- Strategy/training library, referee's personal appointment+ruling log, private
-- organizer's personal event planner, and coordinator's federation calendar/rankings
-- are all genuinely PLAYER-personal (not club-scoped, confirmed by reading the actual
-- key derivation — global keys, one writer per login) — added to user_prefs.
--
-- Treasurer subs/ledger are club-scoped (treasKey() derives from the club) — added to
-- clubs, alongside the other club-scoped jsonb blobs (pe_config, club_grade, ladder).
--
-- Two things confirmed NOT to be duplicates of already-migrated systems, despite
-- similar names: cq-private-org-events (a personal party-planning tool) is unrelated
-- to private_events/private_event_enquiries (the club's commercial hire-enquiry
-- pipeline, migration 020); cq-coord-rankings (federation-wide published grading) is
-- unrelated to profile.ladder (a club's internal challenge ladder, migration 021).

alter table public.user_prefs
  add column strategy_cards      jsonb not null default '[]'::jsonb,
  add column strategy_books      jsonb not null default '[]'::jsonb,
  add column strategy_diagrams   jsonb not null default '{}'::jsonb,  -- keyed by card title
  add column library_drills      jsonb not null default '[]'::jsonb,
  add column referee_appts       jsonb not null default '[]'::jsonb,
  add column referee_rulings     jsonb not null default '[]'::jsonb,
  add column private_org_events  jsonb not null default '[]'::jsonb,
  add column coord_calendar      jsonb not null default '[]'::jsonb,
  add column coord_rankings      jsonb not null default '[]'::jsonb;

alter table public.clubs
  add column treasurer_subs    jsonb not null default '[]'::jsonb,
  add column treasurer_ledger  jsonb not null default '[]'::jsonb;
