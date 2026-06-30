-- Greens / turf assessment reports
-- Stores metadata for external contractor reports (irrigation audits, soil tests,
-- sports-field evaluations) uploaded to the 'greens-reports' Supabase Storage bucket.
-- Files live at: greens-reports/{club_id}/{category}/{filename}

create table if not exists greens_reports (
  id            uuid        primary key default gen_random_uuid(),
  club_id       text        not null,
  category      text        not null default 'general',
  -- 'irrigation_audit' | 'soil_test' | 'field_assessment' | 'general'
  display_name  text        not null,
  storage_path  text        not null unique,
  content_type  text,
  size_bytes    bigint,
  report_date   date,           -- date on the report (may differ from upload date)
  prepared_by   text,           -- e.g. "Green Options", "Labosport"
  notes         text,
  uploaded_by   text,           -- Clerk user ID
  created_at    timestamptz not null default now()
);

create index if not exists greens_reports_club_cat
  on greens_reports (club_id, category, created_at desc);

alter table greens_reports enable row level security;

create policy "authenticated users can view greens reports"
  on greens_reports for select
  using (auth.jwt() ->> 'sub' is not null);

create policy "authenticated users can upload greens reports"
  on greens_reports for insert
  with check (auth.jwt() ->> 'sub' is not null);

create policy "uploader can delete own greens report"
  on greens_reports for delete
  using (uploaded_by = auth.jwt() ->> 'sub');
