-- Lawn/greens management: lawns, treatment log, contacts, problem areas, hoop rotation.
-- Different, older feature than the already-Supabase-backed greens_reports contractor-
-- report uploader — this is the lawn tracker (was localStorage keys lawns:{clubId},
-- lawnlog:{clubId}, lawncontacts:{clubId}, lawnproblems:{clubId}, lawnhoops:{clubId}).
-- RLS mirrors greens_reports: club members read, 'lawns' role or admin write.

create table public.lawns (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs(id),
  name        text not null,
  code        text,        -- GC / AC / Ricochet / Gateball
  notes       text,
  created_at  timestamptz not null default now()
);

create index lawns_club_idx on public.lawns (club_id);
alter table public.lawns enable row level security;

create policy "club members can view lawns"
  on public.lawns for select
  to authenticated
  using (public.user_is_club_member(club_id));

create policy "lawns role can manage lawns"
  on public.lawns for all
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      join public.clubs c on c.id = lawns.club_id
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  )
  with check (
    exists (
      select 1 from public.user_roles ur
      join public.clubs c on c.id = lawns.club_id
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  );

-- ─── lawn_log ────────────────────────────────────────────────────────────────
create table public.lawn_log (
  id          uuid primary key default gen_random_uuid(),
  lawn_id     uuid not null references public.lawns(id) on delete cascade,
  entry_type  text not null,   -- mow / treatment / water / etc
  detail      text,
  logged_by   text,            -- Clerk user id
  logged_at   timestamptz not null default now()
);

create index lawn_log_lawn_idx on public.lawn_log (lawn_id, logged_at desc);
alter table public.lawn_log enable row level security;

create policy "club members can view lawn_log"
  on public.lawn_log for select
  to authenticated
  using (exists (select 1 from public.lawns l where l.id = lawn_log.lawn_id and public.user_is_club_member(l.club_id)));

create policy "lawns role can manage lawn_log"
  on public.lawn_log for all
  to authenticated
  using (
    exists (
      select 1 from public.lawns l
      join public.user_roles ur on ur.clerk_user_id = auth.jwt() ->> 'sub'
      join public.clubs c on c.id = l.club_id
      where l.id = lawn_log.lawn_id
        and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  )
  with check (
    exists (
      select 1 from public.lawns l
      join public.user_roles ur on ur.clerk_user_id = auth.jwt() ->> 'sub'
      join public.clubs c on c.id = l.club_id
      where l.id = lawn_log.lawn_id
        and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  );

-- ─── lawn_contacts ───────────────────────────────────────────────────────────
create table public.lawn_contacts (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs(id),
  name        text not null,
  role        text,
  phone       text,
  email       text,
  created_at  timestamptz not null default now()
);

create index lawn_contacts_club_idx on public.lawn_contacts (club_id);
alter table public.lawn_contacts enable row level security;

create policy "club members can view lawn_contacts"
  on public.lawn_contacts for select
  to authenticated
  using (public.user_is_club_member(club_id));

create policy "lawns role can manage lawn_contacts"
  on public.lawn_contacts for all
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      join public.clubs c on c.id = lawn_contacts.club_id
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  )
  with check (
    exists (
      select 1 from public.user_roles ur
      join public.clubs c on c.id = lawn_contacts.club_id
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  );

-- ─── lawn_problems ───────────────────────────────────────────────────────────
create table public.lawn_problems (
  id          uuid primary key default gen_random_uuid(),
  lawn_id     uuid not null references public.lawns(id) on delete cascade,
  description text not null,
  severity    text,
  status      text not null default 'open',
  reported_by text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index lawn_problems_lawn_idx on public.lawn_problems (lawn_id, status);
alter table public.lawn_problems enable row level security;

create policy "club members can view lawn_problems"
  on public.lawn_problems for select
  to authenticated
  using (exists (select 1 from public.lawns l where l.id = lawn_problems.lawn_id and public.user_is_club_member(l.club_id)));

create policy "lawns role can manage lawn_problems"
  on public.lawn_problems for all
  to authenticated
  using (
    exists (
      select 1 from public.lawns l
      join public.user_roles ur on ur.clerk_user_id = auth.jwt() ->> 'sub'
      join public.clubs c on c.id = l.club_id
      where l.id = lawn_problems.lawn_id
        and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  )
  with check (
    exists (
      select 1 from public.lawns l
      join public.user_roles ur on ur.clerk_user_id = auth.jwt() ->> 'sub'
      join public.clubs c on c.id = l.club_id
      where l.id = lawn_problems.lawn_id
        and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  );

-- ─── lawn_hoops ──────────────────────────────────────────────────────────────
create table public.lawn_hoops (
  id          uuid primary key default gen_random_uuid(),
  lawn_id     uuid not null references public.lawns(id) on delete cascade,
  hoop_number int not null,
  position_x  numeric,
  position_y  numeric,
  rotated_at  timestamptz not null default now(),
  rotated_by  text
);

create index lawn_hoops_lawn_idx on public.lawn_hoops (lawn_id);
alter table public.lawn_hoops enable row level security;

create policy "club members can view lawn_hoops"
  on public.lawn_hoops for select
  to authenticated
  using (exists (select 1 from public.lawns l where l.id = lawn_hoops.lawn_id and public.user_is_club_member(l.club_id)));

create policy "lawns role can manage lawn_hoops"
  on public.lawn_hoops for all
  to authenticated
  using (
    exists (
      select 1 from public.lawns l
      join public.user_roles ur on ur.clerk_user_id = auth.jwt() ->> 'sub'
      join public.clubs c on c.id = l.club_id
      where l.id = lawn_hoops.lawn_id
        and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  )
  with check (
    exists (
      select 1 from public.lawns l
      join public.user_roles ur on ur.clerk_user_id = auth.jwt() ->> 'sub'
      join public.clubs c on c.id = l.club_id
      where l.id = lawn_hoops.lawn_id
        and (ur.is_admin = true or ('lawns' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  );
