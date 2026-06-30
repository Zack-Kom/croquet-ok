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

// Uploads a file to the committee-docs bucket and returns the storage path.
// Call with an authenticated client from authedSupabase().
export async function uploadCommitteeDoc(client, clubId, category, file) {
  const ext = file.name.split('.').pop()
  const path = `${clubId}/${category}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await client.storage
    .from('committee-docs')
    .upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
}

// Returns a short-lived signed URL for a stored file (1 hour).
export async function signedUrl(client, storagePath) {
  const { data, error } = await client.storage
    .from('committee-docs')
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

