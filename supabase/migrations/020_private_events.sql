-- Private event bookings: hire enquiries, per-club form/pricing/availability config,
-- and the confirmed-bookings list used for play-day clash detection. Previously three
-- localStorage systems: sec-pe-enquiries:<club> (enquiries), sec-pe-config:<club> (form
-- builder + pricing + custom fields), pe-availability:<clubId> / pe-availability:club:
-- <slug> (availability engine — a known split-key bug, two different key formats used
-- inconsistently across call sites), and privateEvents_<clubKey> (the simple
-- clash-detection list).
--
-- pe_config folds the form-builder/pricing/custom-fields config AND the availability
-- engine (hours/slots/closures/conflict policy) into one jsonb column on clubs — both
-- are single-writer (secretary only) so a blob matches the committee_portal precedent,
-- and having ONE column keyed by the real club_id eliminates the split-key ambiguity
-- going forward.
--
-- private_events (the simple clash-detection list) turned out to be a genuine 2-writer
-- feature — peSyncToClubPage() (secretary side, mirrors a confirmed enquiry here) AND
-- direct member edits on the club page (add/remove a booking, toggle volunteers) both
-- write it — the same shape duty rota turned out to have, hence a real table with RLS
-- open to any club member, not a single-editor dual-write shim.

alter table public.clubs
  add column pe_config jsonb not null default '{}'::jsonb;

create table public.private_event_enquiries (
  id                uuid primary key default gen_random_uuid(),
  club_id           uuid not null references public.clubs(id),
  legacy_id         text,   -- preserves the "pe_<timestamp>" localStorage id
  client_name       text,
  email             text,
  phone             text,
  facility          text,
  nature            text,
  nature_other      text,
  date              date,
  start_time        text,
  duration          text,
  guests            int,
  external_vendors  text,   -- 'yes' | 'no'
  vendor_details    text,
  how_heard         text,
  how_heard_other   text,
  notes             text,
  status            text not null default 'new', -- new | replied | confirmed | declined
  volunteers        jsonb not null default '[]'::jsonb,  -- [{key, name}]
  messages          jsonb not null default '[]'::jsonb,  -- [{from, name, text, at}]
  custom_fields     jsonb not null default '{}'::jsonb,  -- arbitrary custom-field-id -> value map
  conflict_policy   text,   -- snapshot of the play-day conflict status at submission time
  source            text default 'public_form',
  created_at        timestamptz not null default now()
);

create index private_event_enquiries_club_idx on public.private_event_enquiries (club_id, created_at);

create table public.private_events (
  id            uuid primary key default gen_random_uuid(),
  club_id       uuid not null references public.clubs(id),
  legacy_id     text,
  enquiry_id    uuid references public.private_event_enquiries(id),
  date          date,
  start_time    text,
  end_time      text,
  label         text,
  assisting     jsonb not null default '[]'::jsonb, -- [{key, name}]
  created_at    timestamptz not null default now()
);

create index private_events_club_idx on public.private_events (club_id, date);

alter table public.private_event_enquiries enable row level security;
alter table public.private_events enable row level security;

-- Enquiries are secretary/admin-only to view and manage — submitted via the public hire
-- form by any authenticated app user (not necessarily a club member), so insert is open
-- to any authenticated user but view/update/delete are secretary-scoped per club.
create policy "secretaries can view enquiries"
  on public.private_event_enquiries for select
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      join public.clubs c on c.id = private_event_enquiries.club_id
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or ('secretary' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  );

create policy "authenticated users can submit enquiries"
  on public.private_event_enquiries for insert
  to authenticated
  with check (true);

create policy "secretaries can update enquiries"
  on public.private_event_enquiries for update
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      join public.clubs c on c.id = private_event_enquiries.club_id
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or ('secretary' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  );

create policy "secretaries can delete enquiries"
  on public.private_event_enquiries for delete
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      join public.clubs c on c.id = private_event_enquiries.club_id
      where ur.clerk_user_id = auth.jwt() ->> 'sub'
        and (ur.is_admin = true or ('secretary' = any(ur.roles) and public.club_slug(ur.club) = c.slug))
    )
  );

-- Confirmed bookings list: any club member can view (clash detection on the public club
-- page) and any club member can add/edit/remove (matches the existing member-facing
-- volunteer-toggle write path) — secretary sync writes through the same policy.
create policy "club members can view private events"
  on public.private_events for select
  to authenticated
  using (public.user_is_club_member(club_id));

create policy "club members can manage private events"
  on public.private_events for all
  to authenticated
  using (public.user_is_club_member(club_id))
  with check (public.user_is_club_member(club_id));
