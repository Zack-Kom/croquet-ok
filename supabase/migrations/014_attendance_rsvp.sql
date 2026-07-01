-- The occurrence-attendance UI (OccurrenceScheduleTab) tracks RSVP status, a
-- confirmed-at-the-door flag, and an optional note per attendee — fields the
-- original attendance table (migration 008) didn't have.

alter table public.attendance
  add column rsvp      text,    -- 'yes' | 'maybe' | 'no' | null
  add column confirmed boolean not null default false,
  add column rsvp_note text;
