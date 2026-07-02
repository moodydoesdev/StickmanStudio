import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Check, Play, Trash } from '@phosphor-icons/react'
import type { AppConfig, StageId, StageInfo, VideoProject } from '../../../shared/types'
import { RunConsole, StageTracker, useRun } from '../components/Run'
import { Timeline } from '../components/Timeline'

interface Props {
  slug: string
  config: AppConfig
  onBack: () => void
  refresh: () => Promise<void>
}

type Tab = 'overview' | 'script' | 'images' | 'timeline' | 'description'

export function VideoDetail({ slug, config, onBack, refresh }: Props): JSX.Element {
  const [project, setProject] = useState<VideoProject | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  const [script, setScript] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)
  const [meta, setMeta] = useState<StageInfo[]>([])
  const [stageToRun, setStageToRun] = useState<StageId>('narrate')
  const [srtOpen, setSrtOpen] = useState(false)
  const [srtDraft, setSrtDraft] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setProject(await window.api.getProject(slug))
    setImages(await window.api.listImages(slug))
  }, [slug])

  const ctl = useRun(async () => {
    await load()
    await refresh()
  })

  useEffect(() => {
    load()
    window.api.stages().then(setMeta)
  }, [load])

  useEffect(() => {
    if (tab === 'script') window.api.readArtifact(slug, 'script').then(setScript)
    if (tab === 'description') window.api.readArtifact(slug, 'description').then(setDescription)
  }, [tab, slug])

  if (!project) return <div className="empty">Loading…</div>
  const a = project.artifacts
  const running = ctl.status === 'running' || ctl.status === 'paused'

  return (
    <div>
      <div className="page-head">
        <button className="btn ghost" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
        <div>
          <h1>{project.title || project.slug}</h1>
          <div className="sub">{project.slug}</div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => window.api.openFolder(slug)}>
          Open folder
        </button>
        <button
          className="btn danger"
          title="Delete this video"
          onClick={async () => {
            const r = await window.api.deleteProject(slug)
            if (r.ok) {
              await refresh()
              onBack()
            } else if (!r.canceled) {
              setDeleteError(r.error || 'Could not delete the project.')
            }
          }}
        >
          <Trash size={15} /> Delete
        </button>
      </div>

      {deleteError && <div className="banner warn" style={{ marginBottom: 18 }}>{deleteError}</div>}

      <div className="seg" style={{ marginBottom: 18 }}>
        {(['overview', 'script', 'images', ...(a.audio && a.images > 0 ? (['timeline'] as Tab[]) : []), 'description'] as Tab[]).map(
          (t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
              {t === 'images' && a.images > 0 ? ` (${a.images})` : ''}
            </button>
          )
        )}
      </div>

      {tab === 'overview' && (
        <div className="col" style={{ maxWidth: 920 }}>
          {project.videoFile ? (
            <video
              controls
              style={{ width: '100%', borderRadius: 12, background: '#000', maxHeight: 460 }}
              src={`media://${encodeURIComponent(slug)}/${encodeURIComponent(project.videoFile)}`}
            />
          ) : (
            <div className="banner info">No rendered video yet. Run the pipeline through the render stage.</div>
          )}

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Artifacts</h3>
            <div className="chips">
              <ArtChip on={a.script} label="script" />
              <ArtChip on={a.title} label="title" />
              <ArtChip on={a.audio} label="narration mp3" />
              <ArtChip on={a.srt} label="timings srt" />
              <ArtChip on={a.prompts} label="image prompts" />
              <ArtChip on={a.images > 0} label={`${a.images} images`} />
              <ArtChip on={a.video} label="video mp4" />
              <ArtChip on={a.description} label="description" />
              <ArtChip on={a.thumbnails > 0} label={`${a.thumbnails} thumbnails`} />
            </div>
          </div>

          {/* Timings / SRT */}
          <div className="panel col">
            <div className="row">
              <h3 style={{ margin: 0, flex: 1 }}>Timings (SRT)</h3>
              <span className={`pill ${a.srt ? 'ok' : 'missing'}`}>{a.srt ? 'present' : 'not yet'}</span>
            </div>
            <div className="sub">
              Auto-transcribe via the pipeline, or provide your own (e.g. from Mictoo). The image-prompt + render stages
              need these timings.
            </div>
            <div className="row">
              <button
                className="btn"
                onClick={async () => {
                  if (await window.api.importSrt(slug)) await load()
                }}
              >
                Import .srt file…
              </button>
              <button
                className="btn"
                onClick={async () => {
                  setSrtDraft((await window.api.readArtifact(slug, 'srt')) || '')
                  setSrtOpen((v) => !v)
                }}
              >
                {srtOpen ? 'Hide paste box' : 'Paste SRT'}
              </button>
            </div>
            {srtOpen && (
              <>
                <textarea
                  value={srtDraft}
                  onChange={(e) => setSrtDraft(e.target.value)}
                  placeholder={'1\\n00:00:00,000 --> 00:00:04,000\\nFirst beat…'}
                  style={{ minHeight: 180, fontFamily: 'ui-monospace, monospace' }}
                />
                <div className="row">
                  <button
                    className="btn primary"
                    disabled={!srtDraft.trim()}
                    onClick={async () => {
                      await window.api.saveSrt(slug, srtDraft)
                      setSrtOpen(false)
                      await load()
                    }}
                  >
                    Save SRT
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Stage runner */}
          <div className="panel col">
            <h3 style={{ marginTop: 0 }}>Run a stage</h3>
            <div className="sub">Generate or regenerate from any stage onward. Existing finished stages are skipped.</div>
            <div className="row">
              <select value={stageToRun} onChange={(e) => setStageToRun(e.target.value as StageId)} disabled={running}>
                {meta.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.paid ? ' — spends credits' : ''}
                  </option>
                ))}
              </select>
              {running ? (
                <button className="btn" onClick={() => ctl.cancel()}>
                  Cancel
                </button>
              ) : (
                <button
                  className="btn primary"
                  onClick={() =>
                    ctl.start({
                      topic: project.title || project.slug,
                      slug,
                      length: config.defaults.length,
                      vertical: config.defaults.vertical,
                      captions: config.defaults.captions,
                      transcription: config.defaults.transcription,
                      pauseAfterScript: false,
                      startStage: stageToRun
                    })
                  }
                >
                  <Play size={14} weight="fill" /> Run from “{meta.find((m) => m.id === stageToRun)?.label}”
                </button>
              )}
            </div>

            {ctl.status !== 'idle' && (
              <>
                <StageTracker ctl={ctl} meta={meta} />
                {ctl.error && <div className="banner warn">{ctl.error}</div>}
                <RunConsole ctl={ctl} />
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'script' && (
        <div className="panel">
          <pre style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: 0 }}>{script || 'No script yet.'}</pre>
        </div>
      )}

      {tab === 'images' && (
        <div className="imggrid">
          {images.length === 0 && <div className="empty">No images yet.</div>}
          {images.map((f) => (
            <img
              key={f}
              src={`media://${encodeURIComponent(slug)}/${encodeURIComponent(f)}`}
              title={f}
              onClick={() => window.api.reveal(slug, f)}
            />
          ))}
        </div>
      )}

      {tab === 'timeline' && (
        <Timeline
          slug={slug}
          hasSrt={a.srt}
          onRendered={async () => {
            await load()
            await refresh()
          }}
        />
      )}

      {tab === 'description' && (
        <div className="panel">
          <pre style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: 0 }}>{description || 'No description yet.'}</pre>
        </div>
      )}
    </div>
  )
}

function ArtChip({ on, label }: { on: boolean; label: string }): JSX.Element {
  return (
    <span className={`chip ${on ? 'on' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {on && <Check size={11} weight="bold" />}
      {label}
    </span>
  )
}
