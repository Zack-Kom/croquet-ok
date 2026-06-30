import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { authedSupabase, uploadCommitteeDoc, signedUrl } from '../lib/supabase.js'

// Stores greens/turf contractor reports in their own greens_reports table and
// greens-reports storage bucket (supabase/migrations/002_greens_reports.sql).

const BUCKET = 'greens-reports'

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg'
const MAX_MB = 30

const CATEGORIES = [
  { value: 'greens_irrigation', label: 'Irrigation Audit' },
  { value: 'greens_soil',       label: 'Soil Test' },
  { value: 'greens_field',      label: 'Field Assessment' },
  { value: 'greens_general',    label: 'General' },
]

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fileIcon(contentType = '') {
  if (contentType.includes('pdf')) return 'ti-file-type-pdf'
  if (contentType.includes('word') || contentType.includes('document')) return 'ti-file-type-doc'
  if (contentType.includes('sheet') || contentType.includes('excel')) return 'ti-file-type-xls'
  if (contentType.includes('image')) return 'ti-file-type-jpg'
  return 'ti-file-description'
}

const accent = '#16A34A'

export default function GreensReports({ clubId, T }) {
  const { getToken, userId } = useAuth()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [openingId, setOpeningId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ category: 'greens_irrigation', reportDate: '', preparedBy: '', notes: '' })
  const [selectedFile, setSelectedFile] = useState(null)
  const fileRef = useRef()

  async function getClient() {
    const token = await getToken({ template: 'supabase' })
    if (!token) throw new Error('CLERK_JWT_MISSING')
    return authedSupabase(token)
  }

  function authErrMsg(e) {
    if (e?.message === 'CLERK_JWT_MISSING' || e?.code === 'PGRST301' || e?.message?.includes('signature'))
      return 'Supabase auth not configured — add the "supabase" JWT template in your Clerk dashboard (Settings → JWT Templates).'
    return null
  }

  async function load() {
    try {
      setLoading(true); setError(null)
      const client = await getClient()
      const { data, error: err } = await client
        .from('greens_reports')
        .select('*')
        .eq('club_id', clubId)
        .order('created_at', { ascending: false })
      if (err) throw err
      setReports(data || [])
    } catch (e) {
      setError(authErrMsg(e) || 'Could not load reports.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [clubId])

  async function handleUpload() {
    if (!selectedFile) return
    if (selectedFile.size > MAX_MB * 1024 * 1024) { setError(`File must be under ${MAX_MB} MB.`); return }
    try {
      setUploading(true); setError(null)
      const client = await getClient()
      const path = await uploadCommitteeDoc(client, clubId, form.category, selectedFile, BUCKET)
      await client.from('greens_reports').insert({
        club_id: clubId,
        category: form.category,
        display_name: selectedFile.name,
        storage_path: path,
        content_type: selectedFile.type,
        size_bytes: selectedFile.size,
        report_date: form.reportDate || null,
        prepared_by: form.preparedBy || null,
        notes: form.notes || null,
        uploaded_by: userId,
      })
      setShowForm(false)
      setSelectedFile(null)
      setForm({ category: 'greens_irrigation', reportDate: '', preparedBy: '', notes: '' })
      await load()
    } catch (e) {
      setError(authErrMsg(e) || 'Upload failed — please try again.')
      console.error(e)
    } finally {
      setUploading(false)
    }
  }

  async function openReport(report) {
    try {
      setOpeningId(report.id)
      const client = await getClient()
      const url = await signedUrl(client, report.storage_path, BUCKET)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setError('Could not open report.')
    } finally {
      setOpeningId(null)
    }
  }

  async function deleteReport(report) {
    if (!window.confirm(`Delete "${report.display_name}"?`)) return
    try {
      const client = await getClient()
      await client.storage.from(BUCKET).remove([report.storage_path])
      await client.from('greens_reports').delete().eq('id', report.id)
      setReports(r => r.filter(x => x.id !== report.id))
    } catch (e) {
      setError('Could not delete report.')
    }
  }

  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = reports.filter(r => r.category === cat.value)
    if (items.length > 0) acc.push({ ...cat, items })
    return acc
  }, [])

  const inp = { width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 14, padding: '9px 12px', borderRadius: 8, border: `1.5px solid ${T.cardBorder}`, marginBottom: 12, background: T.card, color: T.text }
  const lbl = { margin: '0 0 5px', fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: T.text }}>{reports.length} report{reports.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setShowForm(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: accent, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          <i className="ti ti-upload" style={{ fontSize: 12 }} /> Attach report
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 13px', marginBottom: 12, borderRadius: 9, background: '#FDF4F4', border: '1px solid #B83232', fontSize: 12, color: '#B83232' }}>{error}</div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: T.textFaint, textAlign: 'center', padding: '2rem 0' }}>Loading…</p>
      ) : reports.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', borderRadius: 12, background: accent + '0D', border: `1px dashed ${accent}55` }}>
          <i className="ti ti-file-description" style={{ fontSize: 28, color: accent, display: 'block', marginBottom: 8 }} />
          <p style={{ margin: 0, fontSize: 13, color: T.textFaint }}>No reports attached yet. Upload irrigation audits, soil tests or assessments from external contractors.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {grouped.map(cat => (
            <div key={cat.value}>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{cat.label}</p>
              <div style={{ display: 'grid', gap: 8 }}>
                {cat.items.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 10, padding: '10px 12px' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 8, background: accent + '14', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <i className={`ti ${fileIcon(r.content_type)}`} style={{ fontSize: 17, color: accent }} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.display_name}</div>
                      <div style={{ fontSize: 11, color: T.textFaint, marginTop: 1 }}>
                        {[r.size_bytes ? fmt(r.size_bytes) : null, fmtDate(r.created_at)].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => openReport(r)} disabled={openingId === r.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 11px', borderRadius: 7, border: `1.5px solid ${accent}`, background: 'transparent', color: accent, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {openingId === r.id ? '…' : <><i className="ti ti-eye" style={{ fontSize: 12 }} /> View</>}
                      </button>
                      {r.uploaded_by === userId && (
                        <button onClick={() => deleteReport(r)} aria-label="Delete"
                          style={{ padding: '6px 8px', borderRadius: 7, border: `1.5px solid ${T.cardBorder}`, background: 'transparent', color: T.textFaint, fontSize: 14, cursor: 'pointer' }}>
                          <i className="ti ti-trash" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload sheet */}
      {showForm && (
        <div onClick={() => setShowForm(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.card, width: '100%', maxWidth: 640, borderRadius: '16px 16px 0 0', padding: '1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px))', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: accent, fontFamily: "'Libre Baskerville', Georgia, serif" }}>Attach report</span>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 22, lineHeight: 1, padding: 0 }}>×</button>
            </div>

            <div onClick={() => fileRef.current?.click()}
              style={{ border: `2px dashed ${selectedFile ? accent : T.cardBorder}`, borderRadius: 10, padding: '1.2rem', textAlign: 'center', cursor: 'pointer', marginBottom: 14, background: selectedFile ? accent + '08' : 'transparent' }}>
              <i className={`ti ${selectedFile ? 'ti-file-check' : 'ti-upload'}`} style={{ fontSize: 24, color: selectedFile ? accent : T.textFaint, display: 'block', marginBottom: 6 }} />
              {selectedFile
                ? <><p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: T.text }}>{selectedFile.name}</p><p style={{ margin: 0, fontSize: 11, color: T.textFaint }}>{fmt(selectedFile.size)}</p></>
                : <><p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: T.text }}>Tap to choose a file</p><p style={{ margin: 0, fontSize: 11, color: T.textFaint }}>PDF, Word, Excel, image · max {MAX_MB} MB</p></>
              }
            </div>
            <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={e => setSelectedFile(e.target.files[0] || null)} />

            <p style={lbl}>Report type</p>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={{ ...inp }}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <p style={lbl}>Prepared by <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opt)</span></p>
                <input type="text" value={form.preparedBy} placeholder="e.g. Green Options"
                  onChange={e => setForm(f => ({ ...f, preparedBy: e.target.value }))}
                  style={{ ...inp, marginBottom: 0 }} />
              </div>
              <div>
                <p style={lbl}>Report date <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opt)</span></p>
                <input type="date" value={form.reportDate}
                  onChange={e => setForm(f => ({ ...f, reportDate: e.target.value }))}
                  style={{ ...inp, marginBottom: 0 }} />
              </div>
            </div>

            <button onClick={handleUpload} disabled={!selectedFile || uploading}
              style={{ width: '100%', background: selectedFile && !uploading ? accent : T.cardBorder, color: '#fff', border: 'none', borderRadius: 10, padding: '13px', fontSize: 15, fontWeight: 700, cursor: selectedFile && !uploading ? 'pointer' : 'default', fontFamily: 'inherit', marginTop: 6 }}>
              {uploading ? 'Uploading…' : 'Save report'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
