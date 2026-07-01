// One-off backfill: converts the legacy base64 `clubs.logo` / `clubs.photos` columns
// (migration 016) into objects in the public `club-media` Storage bucket (migration
// 027), then points `logo_path` / `photo_paths` at them and nulls the base64 columns.
//
// Idempotent: rows that already have logo_path/photo_paths set are skipped (pass
// --force to reprocess). Dry-run by default — prints what it *would* do and the total
// base64 weight it would reclaim; pass --commit to actually upload + update.
//
// Requires a SERVICE ROLE key (bypasses RLS + storage policies). Never commit this key.
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/backfill-club-media.mjs --commit
//
// URL falls back to VITE_SUPABASE_URL so you can reuse .env.local for the URL and
// only supply the service-role key inline.

import { createClient } from '@supabase/supabase-js'

const COMMIT = process.argv.includes('--commit')
const FORCE  = process.argv.includes('--force')
const BUCKET = 'club-media'

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const db = createClient(URL, KEY, { auth: { persistSession: false } })

// "data:image/png;base64,AAAA..." → { buffer, contentType, ext } | null
function parseDataUrl(s) {
  if (typeof s !== 'string' || !s.startsWith('data:')) return null
  const m = s.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
  if (!m) return null
  const contentType = m[1] || 'application/octet-stream'
  const buffer = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
  const ext = (contentType.split('/')[1] || 'bin').replace(/\+.*$/, '')
  return { buffer, contentType, ext }
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / (1024 * 1024)).toFixed(2) + ' MB'
}

async function uploadOne(clubId, kind, parsed, seq) {
  const path = `${clubId}/${kind}/${Date.now()}-${seq}.${parsed.ext}`
  if (!COMMIT) return path
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, parsed.buffer, { contentType: parsed.contentType, upsert: false })
  if (error) throw error
  return path
}

async function main() {
  const { data: clubs, error } = await db
    .from('clubs')
    .select('id, slug, logo, photos, logo_path, photo_paths')
  if (error) throw error

  let converted = 0, skipped = 0, reclaimed = 0
  for (const club of clubs) {
    const clubId = 'club:' + club.slug   // matches getClubId() + storage RLS
    const patch = {}
    let seq = 0

    const hasLegacyLogo = typeof club.logo === 'string' && club.logo.startsWith('data:')
    if (hasLegacyLogo && (FORCE || !club.logo_path)) {
      const parsed = parseDataUrl(club.logo)
      if (parsed) {
        reclaimed += club.logo.length
        patch.logo_path = await uploadOne(clubId, 'logo', parsed, seq++)
        patch.logo = null
      }
    }

    const legacyPhotos = Array.isArray(club.photos) ? club.photos : []
    const hasLegacyPhotos = legacyPhotos.some(p => typeof p === 'string' && p.startsWith('data:'))
    if (hasLegacyPhotos && (FORCE || !(club.photo_paths && club.photo_paths.length))) {
      const paths = []
      for (const p of legacyPhotos) {
        const parsed = parseDataUrl(p)
        if (!parsed) continue // already a URL or malformed — drop it
        reclaimed += p.length
        paths.push(await uploadOne(clubId, 'photo', parsed, seq++))
      }
      patch.photo_paths = paths
      patch.photos = null
    }

    if (Object.keys(patch).length === 0) { skipped++; continue }

    if (COMMIT) {
      const { error: upErr } = await db.from('clubs').update(patch).eq('id', club.id)
      if (upErr) throw upErr
    }
    converted++
    console.log(`${COMMIT ? 'converted' : 'would convert'} ${clubId}: ` +
      `${patch.logo_path ? 'logo ' : ''}${patch.photo_paths ? `${patch.photo_paths.length} photo(s)` : ''}`.trim())
  }

  console.log('\n' + '─'.repeat(48))
  console.log(`${COMMIT ? 'Converted' : 'Would convert'}: ${converted} club(s), skipped ${skipped}`)
  console.log(`Base64 ${COMMIT ? 'removed from' : 'to remove from'} clubs table: ${fmtBytes(reclaimed)}`)
  if (!COMMIT) console.log('\nDry run — re-run with --commit to apply.')
}

main().catch(e => { console.error(e); process.exit(1) })
