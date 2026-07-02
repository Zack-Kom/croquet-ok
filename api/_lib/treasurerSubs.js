// treasurer_subs is a jsonb array on clubs (not its own table), so payment state
// lives inline per entry — this does the read-modify-write both create-checkout-session.js
// (mark pending) and webhook.js (mark paid) need, so the array-patch logic lives in one place.
export async function patchTreasurerSub(admin, clubId, subId, patch) {
  const { data: club, error } = await admin.from('clubs').select('treasurer_subs').eq('id', clubId).single()
  if (error || !club) return { error: error || new Error('Club not found') }

  const subs = club.treasurer_subs || []
  const index = subs.findIndex((s) => s.id === subId)
  if (index === -1) return { error: new Error('Subs record not found') }

  const updated = [...subs]
  updated[index] = { ...updated[index], ...patch }

  const { error: updateError } = await admin.from('clubs').update({ treasurer_subs: updated }).eq('id', clubId)
  return { error: updateError, entry: updated[index] }
}
