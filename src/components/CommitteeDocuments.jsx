import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { authedSupabase, uploadCommitteeDoc, signedUrl } from '../lib/supabase.js'

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg'
const MAX_MB = 20

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fileIcon(contentType = '') {
  if (contentType.includes('pdf')) return 'ti-file-type-pdf'
  if (contentType.includes('word') || contentType.includes('document')) return 'ti-file-type-doc'
  if (contentType.includes('sheet') || contentType.includes('excel') || contentType.includes('csv')) return 'ti-file-type-xls'
  if (contentType.includes('image')) return 'ti-file-type-jpg'
  return 'ti-file-description'
}

// Props:
//   clubId      — string, e.g. "club:my-club-name"
//   category    — 'policy' | 'report' | 'constitution' | 'other'
//   isSecretary — bool, gates upload/delete
//   color       — accent hex for this committee
//   T           — theme object from parent
export default function CommitteeDocuments({ clubId, category, isSecretary, color, T }) {
  const { getToken, userId } = useAuth()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [openingId, setOpeningId] = useState(null)
  const fileRef = useRef()

  const cardStyle = {
    background: T.card,
    borderRadius: 12,
    border: `1px solid ${T.cardBorder}`,
    overflow: 'hidden',
    marginBottom: 12,
  }
  const headStyle = {
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '10px 14px',
    background: color,
  }
  const headText = { fontSize: 13, fontWeight: 700, color: '#fff' }

  async function getClient() {
    const token = await getToken({ template: 'supabase' })
    return authedSupabase(token)
  }

  async function loadDocs() {
    try {
      setLoading(true)
      setError(null)
      const client = await getClient()
      const { data, error: err } = await client
        .from('committee_documents')
        .select('*')
        .eq('club_id', clubId)
        .eq('category', category)
        .order('created_at', { ascending: false })
      if (err) throw err
      setDocs(data || [])
    } catch (e) {
      setError('Could not load documents.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDocs() }, [clubId, category])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File must be under ${MAX_MB} MB.`)
      return
    }
    try {
      setUploading(true)
      setError(null)
      const client = await getClient()
      const path = await uploadCommitteeDoc(client, clubId, category, file)
      const { error: insertErr } = await client.from('committee_documents').insert({
        club_id: clubId,
        category,
        display_name: file.name,
        storage_path: path,
        content_type: file.type,
        size_bytes: file.size,
        uploaded_by: userId,
      })
      if (insertErr) throw insertErr
      await loadDocs()
    } catch (e) {
      setError('Upload failed. Please try again.')
      console.error(e)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleOpen(doc) {
    try {
      setOpeningId(doc.id)
      const client = await getClient()
      const url = await signedUrl(client, doc.storage_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setError('Could not open file.')
    } finally {
      setOpeningId(null)
    }
  }

  async function handleDelete(doc) {
    if (!window.confirm(`Remove "${doc.display_name}"?`)) return
    try {
      const client = await getClient()
      await client.storage.from('committee-docs').remove([doc.storage_path])
      await client.from('committee_documents').delete().eq('id', doc.id)
      setDocs(d => d.filter(x => x.id !== doc.id))
    } catch {
      setError('Could not remove file.')
    }
  }

  const emptyLabel = category === 'policy'
    ? 'Club policies, constitutions, and by-laws will appear here.'
    : 'Filed documents will appear here.'

  return (
    <div>
      {isSecretary && (
        <div style={{ marginBottom: 12 }}>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
          <button
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              width: '100%', padding: '11px',
              borderRadius: 10, border: `1.5px dashed ${color}`,
              background: color + '08', color,
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              opacity: uploading ? 0.6 : 1,
            }}
          >
            {uploading
              ? <><i className="ti ti-loader" style={{ fontSize: 15 }} /> Uploading…</>
              : <><i className="ti ti-upload" style={{ fontSize: 15 }} /> Upload document</>
            }
          </button>
        </div>
      )}

      {error && (
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#B83232', padding: '8px 12px', background: '#FEF2F2', borderRadius: 8 }}>
          {error}
        </p>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: T.textFaint, fontSize: 13 }}>
          <i className="ti ti-loader" style={{ fontSize: 24, display: 'block', marginBottom: 8 }} />
          Loading…
        </div>
      ) : docs.length === 0 ? (
        <div style={{ ...cardStyle, padding: '2rem 1.25rem', textAlign: 'center' }}>
          <i className="ti ti-files" style={{ fontSize: 32, color: T.textFaint, display: 'block', marginBottom: 10 }} />
          <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: T.text }}>No documents yet</p>
          <p style={{ margin: 0, fontSize: 12, color: T.textFaint, lineHeight: 1.5 }}>{emptyLabel}</p>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={headStyle}>
            <i className="ti ti-files" style={{ fontSize: 13, color: '#fff' }} />
            <span style={headText}>Documents</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>{docs.length}</span>
          </div>
          <div style={{ padding: '4px 0' }}>
            {docs.map((doc, i) => (
              <div key={doc.id} style={{ padding: '12px 16px', borderTop: i > 0 ? `1px solid ${T.cardBorder}` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <i
                    className={`ti ${fileIcon(doc.content_type)}`}
                    style={{ fontSize: 20, color: color, flexShrink: 0, marginTop: 1 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.display_name}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: T.textFaint }}>
                      {doc.size_bytes ? fmt(doc.size_bytes) : ''}
                      {doc.size_bytes && doc.created_at ? ' · ' : ''}
                      {doc.created_at ? fmtDate(doc.created_at) : ''}
                    </p>
                    <button
                      disabled={openingId === doc.id}
                      onClick={() => handleOpen(doc)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        marginTop: 8, padding: '5px 10px',
                        borderRadius: 6, border: `1px solid ${color}`,
                        background: 'transparent', color,
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                        opacity: openingId === doc.id ? 0.6 : 1,
                      }}
                    >
                      <i className="ti ti-external-link" style={{ fontSize: 12 }} />
                      {openingId === doc.id ? 'Opening…' : 'Open'}
                    </button>
                  </div>
                  {(isSecretary || doc.uploaded_by === userId) && (
                    <button
                      onClick={() => handleDelete(doc)}
                      style={{ flexShrink: 0, background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer', padding: 4, fontSize: 16, lineHeight: 1 }}
                      title="Remove"
                    >×</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Lightweight upload-only button for the Reports compose form.
// Uploads to committee-docs/{clubId}/report/ and calls onUploaded(signedUrl).
export function ReportFileUpload({ clubId, color, T, onUploaded }) {
  const { getToken } = useAuth()
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState(null)
  const fileRef = useRef()

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_MB * 1024 * 1024) { setErr(`Max ${MAX_MB} MB`); return }
    try {
      setUploading(true); setErr(null)
      const token = await getToken({ template: 'supabase' })
      const client = authedSupabase(token)
      const path = await uploadCommitteeDoc(client, clubId, 'report', file)
      const url = await signedUrl(client, path)
      onUploaded(url)
    } catch {
      setErr('Upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={handleFile} />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '6px 12px', borderRadius: 7,
          border: `1px solid ${color}`, background: 'transparent', color,
          fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          opacity: uploading ? 0.6 : 1,
        }}
      >
        <i className={`ti ${uploading ? 'ti-loader' : 'ti-upload'}`} style={{ fontSize: 13 }} />
        {uploading ? 'Uploading…' : 'Attach file'}
      </button>
      {err && <span style={{ marginLeft: 8, fontSize: 11, color: '#B83232' }}>{err}</span>}
    </div>
  )
}
