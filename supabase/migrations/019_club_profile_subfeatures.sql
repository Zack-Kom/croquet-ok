-- Extends the clubs table (migration 016 core fields) with the four sub-features that
-- migration explicitly deferred: work-log ("register"), the policies list, video cards
-- (promo cards), and the committee portal. All four are secretary/president-edited lists
-- or small nested objects with no cross-table relational need (matches the existing
-- lawn_problems.marks / event_occurrences.overrides precedent of using jsonb for this
-- shape of data rather than normalizing into new tables). No new RLS needed — the
-- existing "club members and admins can update clubs" policy (migration 006) already
-- covers whatever columns exist on the row.
--
-- Committee portal's reports already reference uploaded files via the existing
-- committee_documents table/storage bucket (migration 001) by url — that integration is
-- unchanged; this column just persists the reports list metadata alongside meetings/
-- assets/contacts, matching the app's existing single committeePortal object shape.

alter table public.clubs
  add column register          jsonb not null default '[]'::jsonb,
  add column policies          jsonb not null default '[]'::jsonb,
  add column video_cards       jsonb not null default '[]'::jsonb,
  add column committee_portal  jsonb not null default '{}'::jsonb;
