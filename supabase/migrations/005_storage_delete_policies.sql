-- 004_tighten_rls.sql added select/insert storage.objects policies for
-- committee-docs and greens-reports but missed delete — the delete buttons in
-- CommitteeDocuments.jsx/GreensReports.jsx call storage.remove(), which RLS
-- silently blocks without this, leaving the DB row deleted but the file orphaned.

drop policy if exists "club members can delete committee-docs objects" on storage.objects;
create policy "club members can delete committee-docs objects"
  on storage.objects for delete
  using (
    bucket_id = 'committee-docs'
    and exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = split_part(storage.objects.name, '/', 1))
    )
  );

drop policy if exists "club members can delete greens-reports objects" on storage.objects;
create policy "club members can delete greens-reports objects"
  on storage.objects for delete
  using (
    bucket_id = 'greens-reports'
    and exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = split_part(storage.objects.name, '/', 1))
    )
  );
