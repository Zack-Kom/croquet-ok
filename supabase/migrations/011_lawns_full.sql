-- Extends the lawns skeleton from migration 009 to match the real shape of the localStorage
-- lawn object (App.jsx getOrInitLawns/ClubLawnsTab area): number, multiple game codes per
-- lawn, status tracking with a note/expiry, surface, dimensions, ordering, and a directly-
-- stored condition rating (confirmed not derived from lawn_log — a real field set via UI).

alter table public.lawns
  add column legacy_id        text unique,  -- preserves "lawn_xxx" ids from makeLawnId()
  add column number           int,
  add column codes            text[] not null default '{}',  -- e.g. {GC,AC} — a lawn can serve multiple codes
  add column status           text not null default 'open',  -- open | closed | maintenance
  add column status_note      text,
  add column status_until     date,
  add column surface          text default 'grass',
  add column dimensions       jsonb,        -- {length, width}
  add column preference_order int,
  add column condition        int,          -- 0-5 rating, directly stored
  add column grass_type       text,
  add column usage_level      text;
