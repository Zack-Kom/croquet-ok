import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Unauthenticated client — only for public reads if you enable them
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Returns a Supabase client authenticated with the user's Clerk JWT.
// Usage: const client = authedSupabase(await getToken({ template: 'supabase' }))
// Requires a "supabase" JWT template configured in your Clerk dashboard:
//   https://dashboard.clerk.com → JWT Templates → New → Supabase
//   Set the signing secret to your Supabase project's JWT secret
//   (Supabase Dashboard → Settings → API → JWT Secret)
export function authedSupabase(clerkToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${clerkToken}` } },
  })
}

// Uploads a file to the given bucket (defaults to committee-docs) and returns the storage path.
// Call with an authenticated client from authedSupabase().
export async function uploadCommitteeDoc(client, clubId, category, file, bucket = 'committee-docs') {
  const ext = file.name.split('.').pop()
  const path = `${clubId}/${category}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await client.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
}

// Returns a short-lived signed URL for a stored file (1 hour).
export async function signedUrl(client, storagePath, bucket = 'committee-docs') {
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(storagePath, 3600)
  if (error) throw error
  return data.signedUrl
}

// ─── Broadcast contributions ──────────────────────────────────────────────────

// Uploads a media file to the broadcast-media bucket and inserts a contribution row.
// Returns the inserted row.
export async function submitBroadcastContribution(client, { eventId, contributorId, contributorName, file, label }) {
  const ext = file.name.split('.').pop() || (file.type.startsWith('video') ? 'mp4' : 'jpg')
  const path = `${eventId}/${contributorId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await client.storage
    .from('broadcast-media')
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadErr) throw uploadErr

  const type = file.type.startsWith('video') ? 'video' : 'photo'
  const { data, error: insertErr } = await client
    .from('broadcast_contributions')
    .insert({ event_id: eventId, contributor_id: contributorId, contributor_name: contributorName, storage_path: path, type, label, status: 'pending' })
    .select()
    .single()
  if (insertErr) throw insertErr
  return data
}

// Subscribes to new pending contributions for a given event.
// Returns an unsubscribe function.
export function subscribeToBroadcastQueue(eventId, onRow) {
  const channel = supabase
    .channel('broadcast-queue-' + eventId)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'broadcast_contributions',
      filter: `event_id=eq.${eventId}`,
    }, payload => onRow(payload.new))
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'broadcast_contributions',
      filter: `event_id=eq.${eventId}`,
    }, payload => onRow(payload.new, 'update'))
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// Fetches all contributions for an event (broadcaster queue load).
export async function fetchBroadcastQueue(client, eventId) {
  const { data, error } = await client
    .from('broadcast_contributions')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// Updates the status of a contribution (approve / reject).
export async function updateContributionStatus(client, id, status) {
  const { error } = await client
    .from('broadcast_contributions')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

// ─── Clubs ─────────────────────────────────────────────────────────────────
// Mirrors the app's legacy getClubId() slug format ("club:" + lowercase, underscored)
// so it joins against existing committee_documents/greens_reports/user_roles data.
export function clubSlug(name) {
  return 'club:' + String(name || '').trim().toLowerCase().replace(/\s+/g, '_')
}

// Looks up a club by name, creating it if it doesn't exist yet. Returns the clubs row
// (with its real uuid id) — this replaces raw getClubId() calls for any new Supabase-backed
// table that takes a club_id uuid FK.
export async function getOrCreateClub(client, name) {
  const slug = clubSlug(name)
  const { data: existing, error: selErr } = await client
    .from('clubs').select('*').eq('slug', slug).maybeSingle()
  if (selErr) throw selErr
  if (existing) return existing

  const { data: created, error: insErr } = await client
    .from('clubs').insert({ slug, name }).select().single()
  if (insErr) {
    // Race: another client created it between our select and insert — re-fetch.
    if (insErr.code === '23505') {
      const { data: retry, error: retryErr } = await client
        .from('clubs').select('*').eq('slug', slug).single()
      if (retryErr) throw retryErr
      return retry
    }
    throw insErr
  }
  return created
}

// ─── Players ─────────────────────────────────────────────────────────────────
// Finds a player by (club_id, normalized name), creating one if it doesn't exist.
// This is the single chokepoint every event/registration/attendance write should go
// through instead of matching on raw name strings, so "John Smith" and "john smith"
// resolve to the same row.
export async function findOrCreatePlayer(client, clubId, name) {
  const nameNormalized = String(name || '').trim().toLowerCase()
  let query = client.from('players').select('*').eq('name_normalized', nameNormalized)
  query = clubId ? query.eq('club_id', clubId) : query.is('club_id', null)
  const { data: existing, error: selErr } = await query.maybeSingle()
  if (selErr) throw selErr
  if (existing) return existing

  const { data: created, error: insErr } = await client
    .from('players').insert({ club_id: clubId || null, name: name.trim() }).select().single()
  if (insErr) {
    if (insErr.code === '23505') {
      let retryQuery = client.from('players').select('*').eq('name_normalized', nameNormalized)
      retryQuery = clubId ? retryQuery.eq('club_id', clubId) : retryQuery.is('club_id', null)
      const { data: retry, error: retryErr } = await retryQuery.single()
      if (retryErr) throw retryErr
      return retry
    }
    throw insErr
  }
  return created
}

// Links a player row to the signed-in Clerk user (self-claim).
export async function claimPlayer(client, playerId, clerkUserId) {
  const { error } = await client.from('players').update({ clerk_user_id: clerkUserId }).eq('id', playerId)
  if (error) throw error
}

// ─── Events / fixtures / registrations / attendance ─────────────────────────

export async function createEvent(client, {
  clubId, name, format, venue, startsAt, endsAt, registrationDeadline, createdBy,
  playFormat, tieStructure, rcDay, rcFreq, rcStart, rcEnd, linkedPlayDaySlot,
  registrationsOpen, maxPlayers, capType, entryFee, waitlistEnabled, gameCode,
  description, icon, competitive, privateBooking, organiser, legacyId,
}) {
  const { data, error } = await client.from('events').insert({
    club_id: clubId || null, name, format, venue,
    starts_at: startsAt || null, ends_at: endsAt || null,
    registration_deadline: registrationDeadline || null,
    created_by: createdBy,
    legacy_id: legacyId || null,
    play_format: playFormat || 'singles',
    tie_structure: tieStructure || null,
    rc_day: rcDay || null, rc_freq: rcFreq || null, rc_start: rcStart || null, rc_end: rcEnd || null,
    linked_play_day_slot: linkedPlayDaySlot || null,
    registrations_open: registrationsOpen ?? true,
    max_players: maxPlayers ?? null,
    cap_type: capType || 'none',
    entry_fee: entryFee || null,
    waitlist_enabled: waitlistEnabled ?? false,
    game_code: gameCode || null,
    description: description || null,
    icon: icon || null,
    competitive: competitive ?? true,
    private_booking: privateBooking ?? false,
    organiser: organiser || null,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateEvent(client, eventId, patch) {
  const { data, error } = await client.from('events').update(patch).eq('id', eventId).select().single()
  if (error) throw error
  return data
}

export async function deleteEvent(client, eventId) {
  const { error } = await client.from('events').delete().eq('id', eventId)
  if (error) throw error
}

export async function fetchEvents(client, clubId) {
  let query = client.from('events').select('*').order('starts_at', { ascending: true })
  if (clubId) query = query.eq('club_id', clubId)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function fetchEvent(client, eventId) {
  const { data, error } = await client.from('events').select('*').eq('id', eventId).single()
  if (error) throw error
  return data
}

// Adds a player to an event's roster (finds-or-creates the player row first).
export async function addEventPlayer(client, eventId, clubId, playerName, { seed, source, acHcp, gcHcp } = {}) {
  const player = await findOrCreatePlayer(client, clubId, playerName)
  const { data, error } = await client.from('event_players')
    .insert({
      event_id: eventId, player_id: player.id, seed: seed ?? null,
      source: source || 'organiser', ac_hcp: acHcp || null, gc_hcp: gcHcp || null,
    })
    .select('*, player:players(*)').single()
  if (error) throw error
  return data
}

export async function removeEventPlayer(client, eventId, playerId) {
  const { error } = await client.from('event_players').delete().eq('event_id', eventId).eq('player_id', playerId)
  if (error) throw error
}

// Returns event roster with player names/ids joined — no cached name fallback needed.
export async function fetchEventPlayers(client, eventId) {
  const { data, error } = await client.from('event_players')
    .select('*, player:players(*)').eq('event_id', eventId).order('seed', { ascending: true })
  if (error) throw error
  return data
}

export async function fetchFixtures(client, eventId) {
  const { data, error } = await client.from('fixtures')
    .select('*, playerA:players!fixtures_player_a_id_fkey(*), playerA2:players!fixtures_player_a2_id_fkey(*), playerB:players!fixtures_player_b_id_fkey(*), playerB2:players!fixtures_player_b2_id_fkey(*)')
    .eq('event_id', eventId).order('round', { ascending: true })
  if (error) throw error
  return data
}

export async function createFixture(client, eventId, fixture) {
  const { data, error } = await client.from('fixtures').insert({ event_id: eventId, ...fixture }).select().single()
  if (error) throw error
  return data
}

export async function updateFixture(client, fixtureId, patch) {
  const { data, error } = await client.from('fixtures').update(patch).eq('id', fixtureId).select().single()
  if (error) throw error
  return data
}

// Registers a player for an event (self-service or manager-added — finds-or-creates the player).
export async function registerForEvent(client, eventId, clubId, playerName, { note, source } = {}) {
  const player = await findOrCreatePlayer(client, clubId, playerName)
  const { data, error } = await client.from('registrations')
    .upsert(
      { event_id: eventId, player_id: player.id, note: note || null, source: source || 'self' },
      { onConflict: 'event_id,player_id' }
    )
    .select('*, player:players(*)').single()
  if (error) throw error
  return data
}

export async function fetchRegistrations(client, eventId) {
  const { data, error } = await client.from('registrations')
    .select('*, player:players(*)').eq('event_id', eventId).order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function updateRegistrationStatus(client, registrationId, status) {
  const { error } = await client.from('registrations').update({ status }).eq('id', registrationId)
  if (error) throw error
}

// Marks a player present for an event occurrence (finds-or-creates the player).
export async function markAttendance(client, eventId, clubId, occurrenceId, playerName) {
  const player = await findOrCreatePlayer(client, clubId, playerName)
  const { data, error } = await client.from('attendance')
    .upsert({ event_id: eventId, occurrence_id: occurrenceId || null, player_id: player.id }, { onConflict: 'event_id,occurrence_id,player_id' })
    .select('*, player:players(*)').single()
  if (error) throw error
  return data
}

export async function fetchAttendance(client, eventId, occurrenceId) {
  let query = client.from('attendance').select('*, player:players(*)').eq('event_id', eventId)
  if (occurrenceId) query = query.eq('occurrence_id', occurrenceId)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function removeAttendance(client, attendanceId) {
  const { error } = await client.from('attendance').delete().eq('id', attendanceId)
  if (error) throw error
}

// ─── Event occurrences (recurring events) ────────────────────────────────────

export async function fetchEventOccurrences(client, eventId) {
  const { data, error } = await client.from('event_occurrences')
    .select('*').eq('event_id', eventId).order('date', { ascending: true })
  if (error) throw error
  return data
}

// Creates or updates an occurrence for a given date (upsert on event_id+date).
export async function upsertEventOccurrence(client, eventId, { legacyId, date, status, cancelledByClub, notes, overrides }) {
  const { data, error } = await client.from('event_occurrences')
    .upsert({
      event_id: eventId, legacy_id: legacyId || null, date,
      status: status || 'upcoming', cancelled_by_club: cancelledByClub ?? false,
      notes: notes || null, overrides: overrides || null,
    }, { onConflict: 'event_id,date' })
    .select().single()
  if (error) throw error
  return data
}

// ─── Event teams (playFormat === 'teams') ────────────────────────────────────

export async function fetchEventTeams(client, eventId) {
  const { data, error } = await client.from('event_teams')
    .select('*, players:event_team_players(*, player:players(*))').eq('event_id', eventId)
  if (error) throw error
  return data
}

export async function createEventTeam(client, eventId, clubId, name) {
  const { data, error } = await client.from('event_teams')
    .insert({ event_id: eventId, club_id: clubId || null, name }).select().single()
  if (error) throw error
  return data
}

export async function addTeamPlayer(client, teamId, clubId, playerName) {
  const player = await findOrCreatePlayer(client, clubId, playerName)
  const { data, error } = await client.from('event_team_players')
    .insert({ team_id: teamId, player_id: player.id })
    .select('*, player:players(*)').single()
  if (error) throw error
  return data
}

export async function removeTeamPlayer(client, teamId, playerId) {
  const { error } = await client.from('event_team_players').delete().eq('team_id', teamId).eq('player_id', playerId)
  if (error) throw error
}

// ─── Event managers ───────────────────────────────────────────────────────────

export async function fetchEventManagers(client, eventId) {
  const { data, error } = await client.from('event_managers')
    .select('*, player:players(*)').eq('event_id', eventId).order('added_at', { ascending: true })
  if (error) throw error
  return data
}

// Adds a manager by name — tries to link a players row via clerk_user_id if the manager
// is the signed-in user themself, otherwise just stores the display name (mirrors today's
// { id, name, avatar, role } shape, minus avatar which isn't modeled yet).
export async function addEventManager(client, eventId, { playerId, name, role }) {
  const { data, error } = await client.from('event_managers')
    .insert({ event_id: eventId, player_id: playerId || null, name, role: role || 'Manager' })
    .select('*, player:players(*)').single()
  if (error) throw error
  return data
}

export async function removeEventManager(client, managerId) {
  const { error } = await client.from('event_managers').delete().eq('id', managerId)
  if (error) throw error
}

// ─── Lawn / greens management ────────────────────────────────────────────────

export async function fetchLawns(client, clubId) {
  const { data, error } = await client.from('lawns').select('*').eq('club_id', clubId).order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function createLawn(client, clubId, {
  name, code, notes, legacyId, number, codes, status, statusNote, statusUntil,
  surface, dimensions, preferenceOrder, condition, grassType, usageLevel,
}) {
  const { data, error } = await client.from('lawns').insert({
    club_id: clubId, name, code, notes,
    legacy_id: legacyId || null,
    number: number ?? null,
    codes: codes || [],
    status: status || 'open',
    status_note: statusNote || null,
    status_until: statusUntil || null,
    surface: surface || 'grass',
    dimensions: dimensions || null,
    preference_order: preferenceOrder ?? null,
    condition: condition ?? null,
    grass_type: grassType || null,
    usage_level: usageLevel || null,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateLawn(client, lawnId, patch) {
  const { data, error } = await client.from('lawns').update(patch).eq('id', lawnId).select().single()
  if (error) throw error
  return data
}

export async function deleteLawn(client, lawnId) {
  const { error } = await client.from('lawns').delete().eq('id', lawnId)
  if (error) throw error
}

export async function fetchLawnLog(client, lawnId) {
  const { data, error } = await client.from('lawn_log').select('*').eq('lawn_id', lawnId).order('logged_at', { ascending: false })
  if (error) throw error
  return data
}

export async function addLawnLogEntry(client, lawnId, { entryType, detail, loggedBy }) {
  const { data, error } = await client.from('lawn_log')
    .insert({ lawn_id: lawnId, entry_type: entryType, detail, logged_by: loggedBy }).select().single()
  if (error) throw error
  return data
}

export async function fetchLawnContacts(client, clubId) {
  const { data, error } = await client.from('lawn_contacts').select('*').eq('club_id', clubId).order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function upsertLawnContact(client, clubId, contact) {
  const { data, error } = await client.from('lawn_contacts')
    .upsert({ club_id: clubId, ...contact }).select().single()
  if (error) throw error
  return data
}

export async function deleteLawnContact(client, contactId) {
  const { error } = await client.from('lawn_contacts').delete().eq('id', contactId)
  if (error) throw error
}

export async function fetchLawnProblems(client, lawnId) {
  const { data, error } = await client.from('lawn_problems').select('*').eq('lawn_id', lawnId).order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function reportLawnProblem(client, lawnId, { description, severity, reportedBy }) {
  const { data, error } = await client.from('lawn_problems')
    .insert({ lawn_id: lawnId, description, severity, reported_by: reportedBy }).select().single()
  if (error) throw error
  return data
}

export async function updateLawnProblemStatus(client, problemId, status) {
  const patch = { status }
  if (status === 'resolved') patch.resolved_at = new Date().toISOString()
  const { error } = await client.from('lawn_problems').update(patch).eq('id', problemId)
  if (error) throw error
}

export async function fetchLawnHoops(client, lawnId) {
  const { data, error } = await client.from('lawn_hoops').select('*').eq('lawn_id', lawnId).order('hoop_number', { ascending: true })
  if (error) throw error
  return data
}

export async function rotateLawnHoop(client, lawnId, { hoopNumber, positionX, positionY, rotatedBy }) {
  const { data, error } = await client.from('lawn_hoops')
    .insert({ lawn_id: lawnId, hoop_number: hoopNumber, position_x: positionX, position_y: positionY, rotated_by: rotatedBy })
    .select().single()
  if (error) throw error
  return data
}

