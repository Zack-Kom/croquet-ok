-- Tighten RLS: scope committee_documents/greens_reports to club members + admins,
-- create broadcast_contributions (was only ever created ad hoc on dev, never migrated),
-- and add storage bucket policies for committee-docs/greens-reports/broadcast-media
-- (also only ever created ad hoc on dev — prod has had neither table nor bucket policies).

-- ─── Club slug helper ───────────────────────────────────────────────────────
-- Mirrors getClubId() in src/App.jsx: lowercase, spaces -> underscores, "club:" prefix.
-- user_roles.club is a free-text admin-entered name (e.g. "Merthyr Croquet Club"),
-- while committee_documents/greens_reports.club_id is the slug form
-- (e.g. "club:merthyr_croquet_club") — this normalizes the comparison.
create or replace function public.club_slug(name text)
returns text language sql immutable as $$
  select case when name is null then null
    else 'club:' || lower(regexp_replace(trim(name), '\s+', '_', 'g'))
  end
$$;

-- ─── committee_documents ────────────────────────────────────────────────────
drop policy if exists "authenticated users can view committee docs" on committee_documents;
drop policy if exists "authenticated users can upload committee docs" on committee_documents;

create policy "club members can view committee docs"
  on committee_documents for select
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = committee_documents.club_id)
    )
  );

create policy "club members can upload committee docs"
  on committee_documents for insert
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = committee_documents.club_id)
    )
  );

-- ─── greens_reports ─────────────────────────────────────────────────────────
drop policy if exists "authenticated users can view greens reports" on greens_reports;
drop policy if exists "authenticated users can upload greens reports" on greens_reports;

create policy "club members can view greens reports"
  on greens_reports for select
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = greens_reports.club_id)
    )
  );

create policy "club members can upload greens reports"
  on greens_reports for insert
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = greens_reports.club_id)
    )
  );

-- ─── broadcast_contributions ────────────────────────────────────────────────
-- Spectators submit via a QR-code deep link (#bc-join-{eventId}) with no Clerk
-- sign-in required, by design — this is unimplemented in the app today (stub),
-- but the table/policies are added now so dev and prod stay in sync and the
-- feature is safe to wire up later: anyone can insert a pending contribution,
-- but only broadcaster/admin roles can read the queue or change its status.
create table if not exists broadcast_contributions (
  id                uuid        primary key default gen_random_uuid(),
  event_id          text        not null,
  contributor_id    text        not null,
  contributor_name  text,
  storage_path      text        not null unique,
  type              text        not null,   -- 'photo' | 'video'
  label             text,
  status            text        not null default 'pending', -- 'pending' | 'approved' | 'rejected'
  created_at        timestamptz not null default now()
);

create index if not exists broadcast_contributions_event
  on broadcast_contributions (event_id, created_at desc);

alter table broadcast_contributions enable row level security;

-- Anyone (anonymous QR visitor or signed-in user) can submit a contribution,
-- but it must land as 'pending' — the client can't pre-approve its own upload.
create policy "anyone can submit a pending contribution"
  on broadcast_contributions for insert
  with check (status = 'pending');

-- Only broadcaster/admin roles can see the queue (so contributor identities
-- and unapproved media aren't world-readable).
create policy "broadcasters can view contributions"
  on broadcast_contributions for select
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or 'broadcaster' = any(ur.roles))
    )
  );

-- Only broadcaster/admin roles can approve/reject.
create policy "broadcasters can update contribution status"
  on broadcast_contributions for update
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or 'broadcaster' = any(ur.roles))
    )
  )
  with check (status in ('pending', 'approved', 'rejected'));

-- ─── Storage bucket policies ────────────────────────────────────────────────
-- Buckets themselves were created ad hoc via the Supabase dashboard on dev and
-- never migrated — create them here (idempotent) so prod has matching buckets,
-- and add storage.objects policies mirroring each table's access rules.
insert into storage.buckets (id, name, public)
values ('committee-docs', 'committee-docs', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('greens-reports', 'greens-reports', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('broadcast-media', 'broadcast-media', false)
on conflict (id) do nothing;

drop policy if exists "club members can read committee-docs objects" on storage.objects;
create policy "club members can read committee-docs objects"
  on storage.objects for select
  using (
    bucket_id = 'committee-docs'
    and exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = split_part(storage.objects.name, '/', 1))
    )
  );

drop policy if exists "club members can upload committee-docs objects" on storage.objects;
create policy "club members can upload committee-docs objects"
  on storage.objects for insert
  with check (
    bucket_id = 'committee-docs'
    and exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = split_part(storage.objects.name, '/', 1))
    )
  );

drop policy if exists "club members can read greens-reports objects" on storage.objects;
create policy "club members can read greens-reports objects"
  on storage.objects for select
  using (
    bucket_id = 'greens-reports'
    and exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = split_part(storage.objects.name, '/', 1))
    )
  );

drop policy if exists "club members can upload greens-reports objects" on storage.objects;
create policy "club members can upload greens-reports objects"
  on storage.objects for insert
  with check (
    bucket_id = 'greens-reports'
    and exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = split_part(storage.objects.name, '/', 1))
    )
  );

-- broadcast-media: anyone can upload (anonymous QR contributor flow), but only
-- broadcaster/admin roles can read objects (matches table-level policy above).
drop policy if exists "anyone can upload broadcast-media objects" on storage.objects;
create policy "anyone can upload broadcast-media objects"
  on storage.objects for insert
  with check (bucket_id = 'broadcast-media');

drop policy if exists "broadcasters can read broadcast-media objects" on storage.objects;
create policy "broadcasters can read broadcast-media objects"
  on storage.objects for select
  using (
    bucket_id = 'broadcast-media'
    and exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or 'broadcaster' = any(ur.roles))
    )
  );
