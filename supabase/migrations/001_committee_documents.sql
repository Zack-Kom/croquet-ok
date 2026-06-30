-- Committee documents table
-- Stores metadata for files uploaded to the 'committee-docs' Supabase Storage bucket.
-- The actual files live at: committee-docs/{club_id}/{category}/{filename}

create table if not exists committee_documents (
  id            uuid        primary key default gen_random_uuid(),
  club_id       text        not null,
  category      text        not null,   -- 'policy' | 'report' | 'constitution' | 'other'
  display_name  text        not null,
  storage_path  text        not null unique,
  content_type  text,
  size_bytes    bigint,
  uploaded_by   text,                   -- Clerk user ID (sub claim)
  created_at    timestamptz not null default now()
);

create index if not exists committee_documents_club_cat
  on committee_documents (club_id, category, created_at desc);

-- Row Level Security
alter table committee_documents enable row level security;

-- Any authenticated user can read documents (refine to club members once you have a members table)
create policy "authenticated users can view committee docs"
  on committee_documents for select
  using (auth.jwt() ->> 'sub' is not null);

-- Any authenticated user can insert (secretary check is enforced in the app layer for now)
create policy "authenticated users can upload committee docs"
  on committee_documents for insert
  with check (auth.jwt() ->> 'sub' is not null);

-- Only the uploader can delete their own doc
create policy "uploader can delete own committee doc"
  on committee_documents for delete
  using (uploaded_by = auth.jwt() ->> 'sub');
