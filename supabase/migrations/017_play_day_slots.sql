-- Play-day scheduling (recurring weekly slots per club, e.g. "Tuesday 9am GC/AC").
-- Was localStorage-only under "playDays_clubProfile_{venue}" keys, day-of-week keyed
-- ({Monday: [slot,...], ...}). cancelled_dates is kept as a flat date[] column matching
-- the existing per-slot array shape, rather than a child table — it's just a list of
-- "this occurrence is off" dates, no other data hangs off a cancellation.
--
-- linked_event_id points at the NEW Supabase events table (events.linkedPlayDaySlot
-- used to be {day, slotIndex} — a real FK is a strict improvement now that slots have
-- stable ids). Not yet wired into syncOccurrences/event linking this pass — see
-- App-side notes; that consumer still reads localStorage, kept in sync via dual-write.

create table public.play_day_slots (
  id               uuid primary key default gen_random_uuid(),
  club_id          uuid not null references public.clubs(id),
  day_of_week      text not null,  -- 'Monday' .. 'Sunday'
  start_time       text not null,  -- HH:MM
  end_time         text,
  approx_end       boolean not null default false,
  codes            text[] not null default '{}',  -- AC/GC/WC/SC/EC
  notes            text,
  label            text,
  cancelled_dates  date[] not null default '{}',
  linked_event_id  uuid references public.events(id) on delete set null,
  linked_event_name text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index play_day_slots_club_day_idx on public.play_day_slots (club_id, day_of_week);

create trigger play_day_slots_updated_at
  before update on public.play_day_slots
  for each row execute function public.set_updated_at();

alter table public.play_day_slots enable row level security;

create policy "club members can view play_day_slots"
  on public.play_day_slots for select
  to authenticated
  using (public.user_is_club_member(club_id));

create policy "club managers can manage play_day_slots"
  on public.play_day_slots for all
  to authenticated
  using (public.user_is_club_manager(club_id))
  with check (public.user_is_club_manager(club_id));
