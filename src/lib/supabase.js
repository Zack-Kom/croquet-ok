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

// ─── Club media (logo / banner photos — migration 027) ──────────────────────────

// Uploads a club branding image to the public 'club-media' bucket and returns the
// storage path. clubId is the "club:slug" form (getClubId()), matching the first
// path segment the storage RLS policy checks. kind is 'logo' or 'photo'.
export async function uploadClubMedia(client, clubId, kind, file) {
  const ext = (file.type && file.type.split('/')[1]) || 'png'
  const path = `${clubId}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await client.storage
    .from('club-media')
    .upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
}

// Resolves a club-media storage path to a stable public URL (bucket is public, so
// no auth or expiry). Returns null for empty input. Safe to call with the plain
// unauthenticated client since downloads bypass RLS on a public bucket.
export function clubMediaUrl(path) {
  if (!path) return null
  return supabase.storage.from('club-media').getPublicUrl(path).data.publicUrl
}

// Bulk logo+banner lookup for club-listing screens (directory, venue search) that
// render many clubs at once and can't afford a fetchClubProfileCore() round-trip per
// card. Returns { [slug]: { logo: url|null, banner: url|null } }, applying the same
// logo_path/photo_paths-over-legacy-base64 precedence as fetchClubProfileCore. Safe
// with the unauthenticated client — clubs are publicly readable. Callers should
// re-call this periodically (not just once at mount) since clubs update their own
// branding at any time and there's no realtime push for it.
export async function fetchAllClubMedia(client) {
  const { data, error } = await client.from('clubs').select('slug, logo, logo_path, photos, photo_paths')
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    const logo = row.logo_path ? clubMediaUrl(row.logo_path) : (row.logo || null)
    const banner = (row.photo_paths && row.photo_paths.length)
      ? clubMediaUrl(row.photo_paths[0])
      : ((row.photos || []).filter(Boolean)[0] || null)
    map[row.slug] = { logo, banner }
  }
  return map
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

// ─── Player profiles ─────────────────────────────────────────────────────────
// The rich profile data that used to live only in localStorage under
// playerProfile___me__ / playerProfile___<id>__ / playerProfile_<slug>. Lives on the
// same `players` row created above (migration 027) — a player row IS a profile once
// it's filled in, whether or not it's ever claimed by a signed-in Clerk user.

const PLAYER_PROFILE_FIELD_MAP = {
  avatar: 'avatar', bio: 'bio', phone: 'phone', email: 'email', address: 'address',
  website: 'website', photos: 'photos', photoPosition: 'photo_position',
  clubs: 'clubs', clubMemberships: 'club_memberships',
  acHandicap: 'ac_handicap', gcHandicap: 'gc_handicap',
  acIndexPoints: 'ac_index_points', gcIndexPoints: 'gc_index_points',
  dGradeAC: 'd_grade_ac', dGradeGC: 'd_grade_gc', playsAC: 'plays_ac', playsGC: 'plays_gc',
  clubGrade: 'club_grade', notes: 'notes', coach: 'coach', toolbelt: 'toolbelt',
  roles: 'roles', isAdmin: 'is_admin', memberStatus: 'member_status', joinedAt: 'joined_at',
  myCheckIns: 'my_checkins', badges: 'badges', hcpHistory: 'hcp_history',
  upcomingEvents: 'upcoming_events', highlights: 'highlights', selfId: 'self_id',
  name: 'name',
}

function playerRowToProfile(row) {
  if (!row) return null
  const out = { id: row.id, _playerId: row.id }
  for (const [camel, snake] of Object.entries(PLAYER_PROFILE_FIELD_MAP)) out[camel] = row[snake]
  return out
}

// Finds the signed-in user's own player row by clerk_user_id (no create — the row is
// created lazily on first write via getOrCreateSelfPlayer).
export async function fetchPlayerProfileByClerkId(client, clerkUserId) {
  if (!clerkUserId) return null
  const { data, error } = await client.from('players').select('*').eq('clerk_user_id', clerkUserId).maybeSingle()
  if (error) throw error
  return playerRowToProfile(data)
}

// Get-or-create the signed-in user's own player row: prefer an existing clerk-linked
// row; otherwise claim an unclaimed row matching their name, or create a fresh one.
export async function getOrCreateSelfPlayer(client, clerkUserId, name) {
  const { data: existing, error: selErr } = await client.from('players').select('*').eq('clerk_user_id', clerkUserId).maybeSingle()
  if (selErr) throw selErr
  if (existing) return existing
  const player = await findOrCreatePlayer(client, null, name || 'Me')
  if (!player.clerk_user_id) await claimPlayer(client, player.id, clerkUserId)
  const { data: claimed, error: reselErr } = await client.from('players').select('*').eq('id', player.id).single()
  if (reselErr) throw reselErr
  return claimed
}

// Writes only the fields present in PLAYER_PROFILE_FIELD_MAP; anything else (derived
// display-only fields) is silently ignored — the caller keeps those in localStorage.
export async function updatePlayerProfileFields(client, playerId, profile) {
  const patch = {}
  for (const [camel, snake] of Object.entries(PLAYER_PROFILE_FIELD_MAP)) {
    if (profile[camel] !== undefined) patch[snake] = profile[camel]
  }
  if (Object.keys(patch).length === 0) return null
  const { data, error } = await client.from('players').update(patch).eq('id', playerId).select().single()
  if (error) throw error
  return playerRowToProfile(data)
}

// Bulk-fetches every player with any profile content, for the mount-time pull that
// mirrors the whole directory into localStorage's playerProfile_<slug> keys (matches
// the app_directory pattern — global content pulled for every signed-in user).
export async function fetchAllPlayerProfiles(client) {
  const { data, error } = await client.from('players').select('*')
  if (error) throw error
  return (data || []).map(playerRowToProfile)
}

// ─── Events / fixtures / registrations / attendance ─────────────────────────

export async function createEvent(client, {
  clubId, name, format, venue, startsAt, endsAt, registrationDeadline, createdBy,
  playFormat, tieStructure, rcDay, rcFreq, rcStart, rcEnd, linkedPlayDaySlot,
  registrationsOpen, maxPlayers, capType, entryFee, entryFeeCents, waitlistEnabled, gameCode,
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
    entry_fee_cents: entryFeeCents ?? null,
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
// occurrenceId is a plain string (matches the localStorage-generated occurrence id) —
// occurrences themselves aren't Supabase-backed yet, but attendance rows can still be
// scoped to one via this text column.
export async function markAttendance(client, eventId, clubId, occurrenceId, playerName, { rsvp, confirmed, rsvpNote } = {}) {
  const player = await findOrCreatePlayer(client, clubId, playerName)
  const { data, error } = await client.from('attendance')
    .upsert({
      event_id: eventId, occurrence_id: occurrenceId || null, player_id: player.id,
      rsvp: rsvp ?? null, confirmed: confirmed ?? false, rsvp_note: rsvpNote ?? null,
    }, { onConflict: 'event_id,occurrence_id,player_id' })
    .select('*, player:players(*)').single()
  if (error) throw error
  return data
}

export async function updateAttendanceFields(client, attendanceId, { rsvp, confirmed, rsvpNote }) {
  const patch = {}
  if (rsvp !== undefined) patch.rsvp = rsvp
  if (confirmed !== undefined) patch.confirmed = confirmed
  if (rsvpNote !== undefined) patch.rsvp_note = rsvpNote
  const { error } = await client.from('attendance').update(patch).eq('id', attendanceId)
  if (error) throw error
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

// Bulk variant for views (week-ahead, event lists, live session) that need
// occurrences across every event in a club at once rather than one at a time.
export async function fetchOccurrencesForEvents(client, eventIds) {
  if (!eventIds || eventIds.length === 0) return []
  const { data, error } = await client.from('event_occurrences')
    .select('*').in('event_id', eventIds).order('date', { ascending: true })
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

export async function createEventTeam(client, eventId, name) {
  const { data, error } = await client.from('event_teams')
    .insert({ event_id: eventId, name }).select().single()
  if (error) throw error
  return data
}

export async function updateEventTeam(client, teamId, { name, clubName }) {
  const patch = {}
  if (name !== undefined) patch.name = name
  if (clubName !== undefined) patch.club_name = clubName
  const { error } = await client.from('event_teams').update(patch).eq('id', teamId)
  if (error) throw error
}

export async function deleteEventTeam(client, teamId) {
  const { error } = await client.from('event_teams').delete().eq('id', teamId)
  if (error) throw error
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

// All four of these are club-scoped (not just lawn-scoped) since the UI supports an
// "applies to all lawns" option — lawnId null/undefined means club-wide.

export async function fetchLawnLog(client, clubId) {
  const { data, error } = await client.from('lawn_log').select('*').eq('club_id', clubId).order('task_date', { ascending: false })
  if (error) throw error
  return data
}

export async function upsertLawnLogEntry(client, clubId, { id, lawnId, taskType, taskDate, byId, note, product, quantity, unit, supplier }) {
  const { data, error } = await client.from('lawn_log')
    .upsert({
      id: id || undefined, club_id: clubId, lawn_id: lawnId || null,
      task_type: taskType, task_date: taskDate, by_id: byId || null, note: note || null,
      product: product || null, quantity: quantity || null, unit: unit || null, supplier: supplier || null,
    }).select().single()
  if (error) throw error
  return data
}

export async function deleteLawnLogEntry(client, entryId) {
  const { error } = await client.from('lawn_log').delete().eq('id', entryId)
  if (error) throw error
}

export async function fetchLawnContacts(client, clubId) {
  const { data, error } = await client.from('lawn_contacts').select('*').eq('club_id', clubId).order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function upsertLawnContact(client, clubId, { id, kind, memberId, name, role, org, phone, email, note, appAccess }) {
  const { data, error } = await client.from('lawn_contacts')
    .upsert({
      id: id || undefined, club_id: clubId, kind: kind || 'contractor', member_id: memberId || null,
      name, role: role || null, org: org || null, phone: phone || null, email: email || null,
      note: note || null, app_access: appAccess ?? false,
    }).select().single()
  if (error) throw error
  return data
}

export async function deleteLawnContact(client, contactId) {
  const { error } = await client.from('lawn_contacts').delete().eq('id', contactId)
  if (error) throw error
}

export async function fetchLawnProblems(client, clubId) {
  const { data, error } = await client.from('lawn_problems').select('*').eq('club_id', clubId).order('first_noted', { ascending: false })
  if (error) throw error
  return data
}

export async function upsertLawnProblem(client, clubId, { id, lawnId, problemType, status, title, notes, firstNoted, marks, reportedBy }) {
  const { data, error } = await client.from('lawn_problems')
    .upsert({
      id: id || undefined, club_id: clubId, lawn_id: lawnId && lawnId !== 'all' ? lawnId : null,
      problem_type: problemType, status: status || 'active', title: title || null, notes: notes || null,
      first_noted: firstNoted || null, marks: marks || [], reported_by: reportedBy || null,
    }).select().single()
  if (error) throw error
  return data
}

export async function deleteLawnProblem(client, problemId) {
  const { error } = await client.from('lawn_problems').delete().eq('id', problemId)
  if (error) throw error
}

export async function fetchLawnHoops(client, clubId) {
  const { data, error } = await client.from('lawn_hoops').select('*').eq('club_id', clubId).order('log_date', { ascending: false })
  if (error) throw error
  return data
}

export async function addLawnHoopEntry(client, clubId, { lawnId, logDate, notes, rotatedBy }) {
  const { data, error } = await client.from('lawn_hoops')
    .insert({ club_id: clubId, lawn_id: lawnId || null, log_date: logDate, notes: notes || null, rotated_by: rotatedBy || null })
    .select().single()
  if (error) throw error
  return data
}

export async function deleteLawnHoopEntry(client, entryId) {
  const { error } = await client.from('lawn_hoops').delete().eq('id', entryId)
  if (error) throw error
}

// ─── Club profile (core fields — migration 016; sub-features — 019/020/021) ──────
// Every remaining club-profile piece is now Supabase-backed jsonb: work-log
// ("register"), policies, video cards, and the committee portal (migration 019),
// private-event config (migration 020), and club grade / ladder (migration 021).

const CLUB_PROFILE_FIELD_MAP = {
  registered: 'registered', onboardingStage: 'onboarding_stage', obStageTs: 'ob_stage_ts',
  obChecklist: 'ob_checklist', obChecklistTs: 'ob_checklist_ts',
  onboardingFlowSentAt: 'onboarding_flow_sent_at', obNotes: 'ob_notes',
  // NB: logo/photos (base64 columns, migration 016) are handled explicitly in
  // fetch/update below, not through this blind map — they now derive from the
  // logo_path/photo_paths storage columns (migration 027). photoPosition still maps.
  primaryColor: 'primary_color', photoPosition: 'photo_position',
  logoPath: 'logo_path', photoPaths: 'photo_paths',
  notes: 'notes', headerVideo: 'header_video', featuredVideo: 'featured_video',
  privateEventsVideo: 'private_events_video',
  address: 'address', phone: 'phone', email: 'email', website: 'website', mapEmbed: 'map_embed',
  secretaryName: 'secretary_name', presidentName: 'president_name', treasurerName: 'treasurer_name',
  captainName: 'captain_name', committeeMembers: 'committee_members',
  codes: 'codes', presenceTimeoutHours: 'presence_timeout_hours', dayStartHour: 'day_start_hour',
  affiliation: 'affiliation', bookingsPageEnabled: 'bookings_page_enabled',
  register: 'register', policies: 'policies', videoCards: 'video_cards',
  committeePortal: 'committee_portal', peConfig: 'pe_config',
  clubGrade: 'club_grade', ladder: 'ladder',
  lawnLayout: 'lawn_layout', dutyTypes: 'duty_types',
  treasurerSubs: 'treasurer_subs', treasurerLedger: 'treasurer_ledger',
  memberFees: 'member_fees',
}

// Fetches the core club profile row by slug (creating a stub clubs row if needed via
// getOrCreateClub), mapped back to the camelCase shape the app already uses.
export async function fetchClubProfileCore(client, clubNameOrSlug) {
  const club = await getOrCreateClub(client, clubNameOrSlug)
  const out = { _clubId: club.slug, _id: club.id }
  for (const [camel, snake] of Object.entries(CLUB_PROFILE_FIELD_MAP)) out[camel] = club[snake]
  out.obContact = { name: club.ob_contact_name, email: club.ob_contact_email, phone: club.ob_contact_phone }
  // logo/photos: prefer the storage-backed paths (migration 027), falling back to the
  // legacy base64 columns (migration 016) for rows not yet backfilled. The app keeps
  // consuming `logo`/`photos` as display srcs — now short public URLs, not data URLs.
  out.logo = club.logo_path ? clubMediaUrl(club.logo_path) : (club.logo || null)
  out.photos = (club.photo_paths && club.photo_paths.length)
    ? club.photo_paths.map(clubMediaUrl)
    : (club.photos || [])
  return out
}

// Writes only the fields present in CLUB_PROFILE_FIELD_MAP; anything else (highlightClips,
// legacy courts/variant) is silently ignored here — the caller keeps those in localStorage.
export async function updateClubProfileCore(client, clubNameOrSlug, profile) {
  const club = await getOrCreateClub(client, clubNameOrSlug)
  const patch = {}
  for (const [camel, snake] of Object.entries(CLUB_PROFILE_FIELD_MAP)) {
    if (profile[camel] !== undefined) patch[snake] = profile[camel]
  }
  if (profile.obContact) {
    if (profile.obContact.name !== undefined) patch.ob_contact_name = profile.obContact.name
    if (profile.obContact.email !== undefined) patch.ob_contact_email = profile.obContact.email
    if (profile.obContact.phone !== undefined) patch.ob_contact_phone = profile.obContact.phone
  }
  // Whenever a storage path is written (including a null on removal), clear the legacy
  // base64 column so fetch's fallback can't resurrect a stale data URL. Also guards
  // against ever re-persisting a megabyte data URL into these columns.
  if (profile.logoPath !== undefined) patch.logo = null
  if (profile.photoPaths !== undefined) patch.photos = null
  if (Object.keys(patch).length === 0) return club
  const { data, error } = await client.from('clubs').update(patch).eq('id', club.id).select().single()
  if (error) throw error
  return data
}

// ─── Play-day scheduling ──────────────────────────────────────────────────────

export async function fetchPlayDaySlots(client, clubId) {
  const { data, error } = await client.from('play_day_slots').select('*').eq('club_id', clubId)
  if (error) throw error
  return data
}

export async function createPlayDaySlot(client, clubId, { dayOfWeek, start, end, approxEnd, codes, notes, label }) {
  const { data, error } = await client.from('play_day_slots')
    .insert({
      club_id: clubId, day_of_week: dayOfWeek, start_time: start, end_time: end || null,
      approx_end: approxEnd ?? false, codes: codes || [], notes: notes || null, label: label || null,
    }).select().single()
  if (error) throw error
  return data
}

export async function updatePlayDaySlot(client, slotId, patch) {
  const { data, error } = await client.from('play_day_slots').update(patch).eq('id', slotId).select().single()
  if (error) throw error
  return data
}

export async function deletePlayDaySlot(client, slotId) {
  const { error } = await client.from('play_day_slots').delete().eq('id', slotId)
  if (error) throw error
}

export async function cancelPlayDaySlotDate(client, slotId, dateStr) {
  const { data: row, error: selErr } = await client.from('play_day_slots').select('cancelled_dates').eq('id', slotId).single()
  if (selErr) throw selErr
  const next = Array.from(new Set([...(row.cancelled_dates || []), dateStr]))
  const { error } = await client.from('play_day_slots').update({ cancelled_dates: next }).eq('id', slotId)
  if (error) throw error
}

export async function uncancelPlayDaySlotDate(client, slotId, dateStr) {
  const { data: row, error: selErr } = await client.from('play_day_slots').select('cancelled_dates').eq('id', slotId).single()
  if (selErr) throw selErr
  const next = (row.cancelled_dates || []).filter(d => d !== dateStr)
  const { error } = await client.from('play_day_slots').update({ cancelled_dates: next }).eq('id', slotId)
  if (error) throw error
}

// ─── Duty rota ─────────────────────────────────────────────────────────────

export async function fetchRotaWeeks(client, clubId, { archived = false } = {}) {
  const { data, error } = await client.from('club_rota_weeks')
    .select('*, slots:club_rota_slots(*)').eq('club_id', clubId).eq('archived', archived)
    .order('start_date', { ascending: true })
  if (error) throw error
  return data
}

export async function createRotaWeek(client, clubId, { legacyId, label, startDate }) {
  const { data, error } = await client.from('club_rota_weeks')
    .insert({ club_id: clubId, legacy_id: legacyId || null, label: label || null, start_date: startDate })
    .select().single()
  if (error) throw error
  return data
}

export async function updateRotaWeek(client, weekId, patch) {
  const { error } = await client.from('club_rota_weeks').update(patch).eq('id', weekId)
  if (error) throw error
}

export async function archiveRotaWeek(client, weekId, { reason, auto } = {}) {
  const { error } = await client.from('club_rota_weeks')
    .update({ archived: true, archived_at: new Date().toISOString(), archived_reason: reason || 'completed', auto_archived: auto ?? false })
    .eq('id', weekId)
  if (error) throw error
}

export async function addRotaSlot(client, weekId, { duty, assignee }) {
  const { data, error } = await client.from('club_rota_slots')
    .insert({ week_id: weekId, duty, assignee: assignee || null }).select().single()
  if (error) throw error
  return data
}

export async function updateRotaSlot(client, slotId, patch) {
  const { error } = await client.from('club_rota_slots').update(patch).eq('id', slotId)
  if (error) throw error
}

export async function deleteRotaSlot(client, slotId) {
  const { error } = await client.from('club_rota_slots').delete().eq('id', slotId)
  if (error) throw error
}

export async function deleteRotaWeek(client, weekId) {
  const { error } = await client.from('club_rota_weeks').delete().eq('id', weekId)
  if (error) throw error
}

// ─── Private event enquiries (migration 020) ─────────────────────────────────

export async function fetchPeEnquiries(client, clubId) {
  const { data, error } = await client.from('private_event_enquiries')
    .select('*').eq('club_id', clubId).order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createPeEnquiry(client, clubId, fields) {
  const { data, error } = await client.from('private_event_enquiries')
    .insert({ club_id: clubId, ...fields }).select().single()
  if (error) throw error
  return data
}

export async function updatePeEnquiry(client, enquiryId, patch) {
  const { data, error } = await client.from('private_event_enquiries')
    .update(patch).eq('id', enquiryId).select().single()
  if (error) throw error
  return data
}

export async function deletePeEnquiry(client, enquiryId) {
  const { error } = await client.from('private_event_enquiries').delete().eq('id', enquiryId)
  if (error) throw error
}

// ─── Private events — confirmed-bookings clash-detection list (migration 020) ──

export async function fetchPrivateEvents(client, clubId) {
  const { data, error } = await client.from('private_events')
    .select('*').eq('club_id', clubId).order('date', { ascending: true })
  if (error) throw error
  return data
}

export async function createPrivateEvent(client, clubId, fields) {
  const { data, error } = await client.from('private_events')
    .insert({ club_id: clubId, ...fields }).select().single()
  if (error) throw error
  return data
}

export async function updatePrivateEvent(client, id, patch) {
  const { data, error } = await client.from('private_events')
    .update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deletePrivateEvent(client, id) {
  const { error } = await client.from('private_events').delete().eq('id', id)
  if (error) throw error
}

// ─── Games — live-play/scoring engine (migration 022) ────────────────────────
// Structured columns for identity/status/players/links; everything else (turn-by-turn
// progress/pegged/currentTurn/eventLog/history/gc*/bisques/ballPositions) lives in one
// `state` jsonb column — that data has no independent per-row lifecycle, it only ever
// makes sense read/written as a whole snapshot of "the game right now".
const GAME_FIELD_MAP = {
  playerAB: 'player_ab', playerRY: 'player_ry', gameType: 'game_type', variant: 'variant',
  venue: 'venue', visibility: 'visibility', lawn: 'lawn', title: 'title',
  maxHoops: 'max_hoops', winner: 'winner', turnCount: 'turn_count',
  isDraw: 'is_draw', endedByTime: 'ended_by_time', sidesConfirmed: 'sides_confirmed',
  advancedFlow: 'advanced_flow', timeLimit: 'time_limit',
  playerIds: 'player_ids', partners: 'partners',
}
const GAME_STATE_FIELDS = [
  'progress', 'pegged', 'currentTurn', 'eventLog', 'history', 'gcCurrentHoop',
  'gcBallOrder', 'gcHoopsThisTurn', 'bisques', 'halfBisqueUsed', 'ballPositions',
]

// Maps the app's in-memory game object to a games-table row. clubId may be null (no
// resolvable club yet, e.g. a practice game with no venue). game.eventId, when present,
// is already a real Supabase event uuid (events are fully Supabase-backed), so it's
// usable as event_id directly — no legacy-id mapping needed there.
export function gameToRow(game, clubId) {
  const row = { legacy_id: String(game.id), club_id: clubId || null, event_id: game.eventId || null }
  for (const [camel, snake] of Object.entries(GAME_FIELD_MAP)) {
    if (game[camel] !== undefined) row[snake] = game[camel]
  }
  const state = {}
  GAME_STATE_FIELDS.forEach(k => { if (game[k] !== undefined) state[k] = game[k] })
  row.state = state
  return row
}

// Upserts by legacy_id so every persist() call (i.e. every turn mutation) updates the
// same row instead of inserting a new one each time.
export async function upsertGame(client, row) {
  const { data, error } = await client.from('games')
    .upsert(row, { onConflict: 'legacy_id' })
    .select().single()
  if (error) throw error
  return data
}

export async function fetchGameByLegacyId(client, legacyId) {
  const { data, error } = await client.from('games').select('*').eq('legacy_id', String(legacyId)).maybeSingle()
  if (error) throw error
  return data
}

// Live-updates for a single game row — not wired to any UI yet (no spectator view
// exists in the app), but ready for one: same postgres_changes pattern as
// subscribeToBroadcastQueue. Returns an unsubscribe function.
export function subscribeToGame(gameRowId, onChange) {
  const channel = supabase
    .channel('game-' + gameRowId)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameRowId}`,
    }, payload => onChange(payload.new))
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// ─── User prefs — starred games, follows, notification prefs (migration 023) ─────
// One row per Clerk user; none of this is club-scoped so clerk_user_id is the natural
// key rather than resolving a players.id.

export async function fetchUserPrefs(client, clerkUserId) {
  const { data, error } = await client.from('user_prefs').select('*').eq('clerk_user_id', clerkUserId).maybeSingle()
  if (error) throw error
  return data
}

export async function upsertUserPrefs(client, clerkUserId, patch) {
  const { data, error } = await client.from('user_prefs')
    .upsert({ clerk_user_id: clerkUserId, ...patch }, { onConflict: 'clerk_user_id' })
    .select().single()
  if (error) throw error
  return data
}

// ─── Feedback (migration 023) ─────────────────────────────────────────────────
// Submitted by any authenticated user; admins review/reply across devices — the whole
// reason this needed to leave localStorage.

export async function fetchFeedback(client) {
  const { data, error } = await client.from('feedback').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createFeedback(client, { id, clerkUserId, type, body, createdAt }) {
  const row = { clerk_user_id: clerkUserId, type, body }
  if (id) row.id = id
  if (createdAt) row.created_at = createdAt
  const { data, error } = await client.from('feedback').insert(row).select().single()
  if (error) throw error
  return data
}

export async function updateFeedback(client, id, patch) {
  const { data, error } = await client.from('feedback').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

// ─── App directory — players/coaches/equipment/affiliations (migration 023) ──────
// Admin-curated singleton row, globally readable. getOrCreateAppDirectory mirrors
// getOrCreateClub's create-if-missing shape since there's no natural "id" callers
// already have for this one.

export async function getOrCreateAppDirectory(client) {
  const { data: existing, error: selErr } = await client.from('app_directory').select('*').limit(1).maybeSingle()
  if (selErr) throw selErr
  if (existing) return existing
  const { data, error } = await client.from('app_directory').insert({}).select().single()
  if (error) throw error
  return data
}

export async function updateAppDirectory(client, id, patch) {
  const { data, error } = await client.from('app_directory').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

// ─── Club check-ins (migration 023) ────────────────────────────────────────────
// A lighter "I'm at the club today" record, distinct from the event-specific
// `attendance` table.

export async function fetchClubCheckins(client, clubId) {
  const { data, error } = await client.from('club_checkins')
    .select('*').eq('club_id', clubId).order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createCheckin(client, clubId, { clerkUserId, name, reason }) {
  const { data, error } = await client.from('club_checkins')
    .insert({ club_id: clubId, clerk_user_id: clerkUserId, name, reason }).select().single()
  if (error) throw error
  return data
}

// ─── Live sessions (migration 024) ─────────────────────────────────────────────
// One row per (club, date) — the live-scoring board's fast-changing internals
// (assignments/availability/managers/activity/overrides), same `state` jsonb shape
// as `games`. Genuinely 2-writer (organiser board + the presence/check-in bridge),
// so this is a real table upserted by (club_id, session_date), not a dual-write shim.

export async function fetchLiveSession(client, clubId, sessionDate) {
  const { data, error } = await client.from('live_sessions')
    .select('*').eq('club_id', clubId).eq('session_date', sessionDate).maybeSingle()
  if (error) throw error
  return data
}

export async function upsertLiveSession(client, clubId, sessionDate, state) {
  const { data, error } = await client.from('live_sessions')
    .upsert({ club_id: clubId, session_date: sessionDate, state }, { onConflict: 'club_id,session_date' })
    .select().single()
  if (error) throw error
  return data
}

// ─── Payments — club-connected Stripe/PayPal/Square accounts (migration 029) ─────
// club_payment_accounts is read via the normal authed client (RLS: club members
// can SELECT). Linking/onboarding and checkout-session creation go through the
// api/payments/* serverless endpoints instead of Supabase directly, since those
// need a Stripe secret key and a trusted manager/secretary/treasurer-role check
// that RLS alone can't express for a service-role connection.

export async function fetchClubPaymentAccount(client, clubId) {
  const { data, error } = await client.from('club_payment_accounts').select('*').eq('club_id', clubId).maybeSingle()
  if (error) throw error
  return data
}

export async function startConnectOnboarding(clubId, clerkToken) {
  const res = await fetch('/api/payments/connect-onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clerkToken}` },
    body: JSON.stringify({ clubId }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not start Stripe onboarding')
  return data.url
}

export async function fetchConnectStatus(clubId, clerkToken) {
  const res = await fetch(`/api/payments/connect-status?clubId=${encodeURIComponent(clubId)}`, {
    headers: { Authorization: `Bearer ${clerkToken}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not check payment account status')
  return data.account
}

// clerkToken may be omitted for flows the endpoint allows anonymously (currently
// none do — private-event deposit links and treasurer subs are generated by an
// authenticated secretary/treasurer, event registration by the registrant/manager).
export async function createCheckoutSession(flow, refId, clubId, clerkToken) {
  const res = await fetch('/api/payments/create-checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(clerkToken ? { Authorization: `Bearer ${clerkToken}` } : {}),
    },
    body: JSON.stringify({ flow, refId, clubId }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not start checkout')
  return data.url
}

// Live-updates for payment status on a single registrations row — same
// postgres_changes pattern as subscribeToGame, for reflecting the webhook's
// write back into the UI right after a Checkout redirect returns.
export function subscribeToRegistrationPayment(registrationId, onChange) {
  const channel = supabase
    .channel('registration-payment-' + registrationId)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'registrations', filter: `id=eq.${registrationId}`,
    }, payload => onChange(payload.new))
    .subscribe()
  return () => supabase.removeChannel(channel)
}

