-- Introduces a real clubs table with a generated UUID primary key. Club "identity"
-- today is derived purely from the display name string (getClubId() in src/App.jsx:
-- "club:" + name.toLowerCase().replace(/\s+/g,'_')) — two clubs whose names differ only
-- by case/whitespace collide, and renaming a club silently forks its data.
--
-- This is purely additive: committee_documents/greens_reports/user_roles keep working
-- exactly as-is via the existing club_slug() helper (migration 004) — no RLS rewrite,
-- no breakage. `clubs` is the join key new tables (players, events, lawns, ...) use.

create table public.clubs (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,        -- 'club:merthyr_croquet_club' — joins to existing club_id text data
  name        text not null,
  state       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger clubs_updated_at
  before update on public.clubs
  for each row execute function public.set_updated_at();

alter table public.clubs enable row level security;

-- Any authenticated user can read the clubs directory (needed to look up/join a club).
create policy "authenticated users can read clubs"
  on public.clubs for select
  to authenticated
  using (true);

-- Any authenticated user can create a club row (organizers/secretaries set up their own
-- club on first use); updates restricted to admins or members of that club.
create policy "authenticated users can create clubs"
  on public.clubs for insert
  to authenticated
  with check (true);

create policy "club members and admins can update clubs"
  on public.clubs for update
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or public.club_slug(ur.club) = clubs.slug)
    )
  );

-- Backfill from existing data sources so committee_documents/greens_reports.club_id
-- and user_roles.club already resolve to a clubs row.
insert into public.clubs (slug, name)
select distinct public.club_slug(ur.club), ur.club
from public.user_roles ur
where ur.club is not null
on conflict (slug) do nothing;

insert into public.clubs (slug, name)
select distinct cd.club_id, cd.club_id
from public.committee_documents cd
where cd.club_id is not null
  and not exists (select 1 from public.clubs c where c.slug = cd.club_id)
on conflict (slug) do nothing;

insert into public.clubs (slug, name)
select distinct gr.club_id, gr.club_id
from public.greens_reports gr
where gr.club_id is not null
  and not exists (select 1 from public.clubs c where c.slug = gr.club_id)
on conflict (slug) do nothing;
