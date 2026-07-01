-- Moves club branding images (logo + banner/gallery photos) out of the base64
-- `clubs.logo` / `clubs.photos` text columns (migration 016) and into a real
-- Supabase Storage bucket, mirroring the committee-docs / greens-reports pattern.
-- Migration 016 flagged this as intended follow-up work (see its header comment).
--
-- Why a *public* bucket (unlike committee-docs/greens-reports, which are private +
-- signed URLs): logos and banners are branding, not sensitive, and they render in
-- dozens of places (event-list icons, club cards, the directory). A public bucket
-- lets the app use getPublicUrl() — a stable, cacheable, no-expiry string — instead
-- of minting a short-lived signed URL at every render site.
--
-- Objects live at: club-media/{club:slug}/logo/<ts>.<ext>
--                  club-media/{club:slug}/photo/<ts>.<ext>
-- The first path segment is the club id ("club:slug"), matching how committee-docs
-- keys objects, so the same club_slug() RLS check applies.
--
-- The legacy base64 `logo` / `photos` columns are kept for now so old rows keep
-- rendering until the one-off backfill script converts them; a later migration can
-- drop them once backfill has run everywhere.

alter table public.clubs
  add column logo_path   text,
  add column photo_paths text[] default '{}';

-- Public bucket — downloads bypass RLS; writes are still gated by the policies below.
insert into storage.buckets (id, name, public)
values ('club-media', 'club-media', true)
on conflict (id) do nothing;

drop policy if exists "club members can upload club-media objects" on storage.objects;
create policy "club members can upload club-media objects"
  on storage.objects for insert
  with check (
    bucket_id = 'club-media'
    and exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = split_part(storage.objects.name, '/', 1))
    )
  );

drop policy if exists "club members can update club-media objects" on storage.objects;
create policy "club members can update club-media objects"
  on storage.objects for update
  using (
    bucket_id = 'club-media'
    and exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = split_part(storage.objects.name, '/', 1))
    )
  );

drop policy if exists "club members can delete club-media objects" on storage.objects;
create policy "club members can delete club-media objects"
  on storage.objects for delete
  using (
    bucket_id = 'club-media'
    and exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = split_part(storage.objects.name, '/', 1))
    )
  );
