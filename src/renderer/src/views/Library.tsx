import { useState } from 'react'
import { FilmSlate, FilmStrip, Sparkle, Trash } from '@phosphor-icons/react'
import type { VideoProject } from '../../../shared/types'

interface Props {
  projects: VideoProject[]
  ready: boolean
  refresh: () => Promise<void>
  onOpen: (slug: string) => void
  onNew: () => void
  onSetup: () => void
}

export function Library({ projects, ready, refresh, onOpen, onNew, onSetup }: Props): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const del = async (slug: string) => {
    const r = await window.api.deleteProject(slug)
    if (r.ok) {
      setError(null)
      await refresh()
    } else if (!r.canceled) {
      setError(r.error || 'Could not delete the project.')
    }
  }
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>My Videos</h1>
          <div className="sub">{projects.length} project{projects.length === 1 ? '' : 's'}</div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => refresh()}>
          Refresh
        </button>
        <button className="btn primary" onClick={onNew}>
          <Sparkle size={16} weight="fill" /> New Video
        </button>
      </div>

      {error && <div className="banner warn" style={{ marginBottom: 18 }}>{error}</div>}

      {!ready && (
        <div className="banner warn" style={{ marginBottom: 18 }}>
          Setup isn’t finished — <a onClick={onSetup} style={{ cursor: 'pointer' }}>install the remaining pieces</a> to
          start making videos.
        </div>
      )}

      {projects.length === 0 ? (
        <div className="empty">
          <div style={{ marginBottom: 10, color: 'var(--muted)' }}>
            <FilmSlate size={44} />
          </div>
          <div style={{ fontSize: 16, marginBottom: 6 }}>No videos yet</div>
          <div style={{ marginBottom: 18 }}>Turn a topic into a finished explainer — script, voiceover, images and a rendered MP4.</div>
          <button className="btn primary" onClick={onNew}>
            <Sparkle size={16} weight="fill" /> Make your first video
          </button>
        </div>
      ) : (
        <div className="grid">
          {projects.map((p) => (
            <VideoCard key={p.slug} p={p} onOpen={() => onOpen(p.slug)} onDelete={() => del(p.slug)} />
          ))}
        </div>
      )}
    </div>
  )
}

function VideoCard({ p, onOpen, onDelete }: { p: VideoProject; onOpen: () => void; onDelete: () => void }): JSX.Element {
  const a = p.artifacts
  const chip = (on: boolean, label: string) => <span className={`chip ${on ? 'on' : ''}`}>{label}</span>
  return (
    <div className="card" onClick={onOpen}>
      <button
        className="del"
        title="Delete this video"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <Trash size={14} />
      </button>
      <div className="thumb">
        {p.poster ? (
          <img src={`media://${encodeURIComponent(p.slug)}/${encodeURIComponent(p.poster)}`} alt={p.slug} />
        ) : (
          <FilmStrip size={30} />
        )}
      </div>
      <div className="meta">
        <div className="title">{p.title || p.slug}</div>
        <div className="slug">{p.slug}</div>
        <div className="chips">
          {chip(a.script, 'script')}
          {chip(a.audio, 'audio')}
          {chip(a.srt, 'timings')}
          {chip(a.images > 0, a.images > 0 ? `${a.images} imgs` : 'images')}
          {chip(a.video, 'video')}
          {chip(a.description, 'desc')}
          {chip(a.thumbnails > 0, 'thumb')}
        </div>
      </div>
    </div>
  )
}
