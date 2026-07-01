-- event_teams.club_id (migration 010) assumed a real club FK, but the Team Builder UI
-- treats "club" as a free-text label per team (e.g. an inter-club tie's away team name),
-- not a relational link. Add a text column for that; club_id stays available if a real
-- link is ever wanted later.
alter table public.event_teams add column club_name text;
