-- Extends the clubs table (migration 006, currently just id/slug/name/state) with the
-- core club profile fields that were previously localStorage-only (clubProfile:/clubProfile_
-- keys). Scoped to Phase 2's "core fields" pass — deliberately excludes the ladder/ranking
-- subsystem, the work-log ("register"), the policies list, and video cards, each of which
-- is substantial enough to warrant its own dedicated migration later (same reasoning as
-- deferring fixtures/games out of the events migration).
--
-- logo/photos store base64 data URLs as text, matching the existing localStorage shape —
-- moving these to Supabase Storage buckets (like committee-docs) would be a worthwhile
-- follow-up but is out of scope here.

alter table public.clubs
  -- Onboarding / admin status
  add column registered            boolean not null default false,
  add column onboarding_stage      text not null default 'uncontacted', -- uncontacted | invited | in_setup | active
  add column ob_stage_ts           jsonb,   -- {stage: timestamp} map
  add column ob_checklist          jsonb,   -- {registered, secretaryAdded, membersImported, playdayScheduled, welcomeSent}
  add column ob_checklist_ts       jsonb,
  add column onboarding_flow_sent_at timestamptz,
  add column ob_contact_name       text,
  add column ob_contact_email      text,
  add column ob_contact_phone      text,
  add column ob_notes              text,

  -- Branding
  add column logo                  text,    -- base64 data URL
  add column primary_color         text default '#1A4A2E',
  add column photos                text[] default '{}',  -- 0-2 base64 data URLs
  add column photo_position        text,    -- "X% Y%" CSS background-position

  -- About / media
  add column notes                 text,    -- description
  add column header_video          text,    -- YouTube URL
  add column featured_video        text,
  add column private_events_video  text,

  -- Contact
  add column address               text,
  add column phone                 text,
  add column email                 text,
  add column website               text,
  add column map_embed             text,    -- iframe HTML

  -- Officers / committee
  add column secretary_name        text,
  add column president_name        text,
  add column treasurer_name        text,
  add column captain_name          text,
  add column committee_members     text[] default '{}',

  -- Gameplay settings
  add column codes                 text[] default '{}',  -- AC/GC/WC/SC/EC
  add column presence_timeout_hours numeric default 4,
  add column day_start_hour        int default 3,

  -- Affiliation / misc
  add column affiliation           text,
  add column bookings_page_enabled boolean not null default false;
-- clubs already has an updated_at trigger from migration 006 — no new one needed.
