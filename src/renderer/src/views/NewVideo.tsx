import { useEffect, useState } from 'react'
import { Play } from '@phosphor-icons/react'
import type { AppConfig, StageInfo, TranscriptionMode, VideoDefaults } from '../../../shared/types'
import { RunConsole, StageTracker, useRun } from '../components/Run'

interface Props {
  config: AppConfig
  ready: boolean
  onSetup: () => void
  onCreated: (slug: string) => void
}

export function NewVideo({ config, ready, onSetup, onCreated }: Props): JSX.Element {
  const [topic, setTopic] = useState('')
  const [slug, setSlug] = useState('')
  const [length, setLength] = useState<VideoDefaults['length']>(config.defaults.length)
  const [vertical, setVertical] = useState(config.defaults.vertical)
  const [captions, setCaptions] = useState(config.defaults.captions)
  const [transcription, setTranscription] = useState<TranscriptionMode>(config.defaults.transcription)
  const [pause, setPause] = useState(true)
  const [meta, setMeta] = useState<StageInfo[]>([])
  const [scriptDraft, setScriptDraft] = useState('')
  const [srtDraft, setSrtDraft] = useState('')
  const [activeSlug, setActiveSlug] = useState<string | null>(null)

  const ctl = useRun()

  useEffect(() => {
    window.api.stages().then(setMeta)
  }, [])

  // Load the right draft when the run pauses (script vs SRT checkpoint).
  useEffect(() => {
    if (ctl.status !== 'paused' || !activeSlug) return
    if (ctl.pausedStage === 'research') window.api.readArtifact(activeSlug, 'script').then((t) => setScriptDraft(t || ''))
    else window.api.readArtifact(activeSlug, 'srt').then((t) => setSrtDraft(t || ''))
  }, [ctl.status, ctl.pausedStage, activeSlug])

  const missingVoice = !config.voiceId
  const missingOpenai = !config.openaiApiKey

  function derivedSlug(): string {
    return (slug || topic)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
  }

  async function start(): Promise<void> {
    const s = derivedSlug()
    setActiveSlug(s)
    await ctl.start({ topic: topic.trim(), slug: s, length, vertical, captions, transcription, pauseAfterScript: pause })
  }

  async function approveScript(saveEdits: boolean): Promise<void> {
    if (saveEdits && activeSlug) await window.api.saveScript(activeSlug, scriptDraft)
    await ctl.resume()
  }

  async function importSrt(): Promise<void> {
    if (!activeSlug) return
    const ok = await window.api.importSrt(activeSlug)
    if (ok) setSrtDraft((await window.api.readArtifact(activeSlug, 'srt')) || '')
  }

  async function continueWithSrt(): Promise<void> {
    if (activeSlug && srtDraft.trim()) await window.api.saveSrt(activeSlug, srtDraft)
    await ctl.resume()
  }

  const running = ctl.status === 'running'
  const idle = ctl.status === 'idle'

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>New Video</h1>
          <div className="sub">Topic in → finished, upload-ready explainer out.</div>
        </div>
      </div>

      {!ready && idle && (
        <div className="banner warn" style={{ marginBottom: 18 }}>
          Setup isn’t finished, so some stages may fail. <a style={{ cursor: 'pointer' }} onClick={onSetup}>Open Setup</a>{' '}
          — or fill this in now and install as you go.
        </div>
      )}

      {idle ? (
        <div className="col" style={{ maxWidth: 720 }}>
          <div className="panel col">
            <label className="field">
              Topic
              <input
                type="text"
                placeholder="e.g. the history of the lighthouse"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </label>
            <label className="field">
              Project name (optional)
              <input
                type="text"
                placeholder={derivedSlug() || 'auto from topic'}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </label>
            <label className="field">
              Length
              <div className="seg">
                {(['short', 'standard', 'long'] as const).map((l) => (
                  <button key={l} className={length === l ? 'active' : ''} onClick={() => setLength(l)}>
                    {l === 'short' ? 'Short (~1m)' : l === 'standard' ? 'Standard (7–10m)' : 'Long (12–18m)'}
                  </button>
                ))}
              </div>
            </label>
            <label className="field">
              Timings (SRT)
              <div className="seg">
                <button className={transcription === 'auto' ? 'active' : ''} onClick={() => setTranscription('auto')}>
                  Auto-transcribe{config.useGpu ? ' (GPU)' : ''}
                </button>
                <button className={transcription === 'manual' ? 'active' : ''} onClick={() => setTranscription('manual')}>
                  I’ll provide an SRT
                </button>
              </div>
              <span className="sub">
                {transcription === 'auto'
                  ? 'Transcribes the narration to get per-beat timings.'
                  : 'Skips transcription — paste or import your own SRT (e.g. from Mictoo) after narration.'}
              </span>
            </label>
            <div className="row" style={{ gap: 20 }}>
              <label className="check">
                <input type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} /> Vertical (9:16)
              </label>
              <label className="check">
                <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Burn captions
              </label>
              <label className="check">
                <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} /> Pause to approve
                script
              </label>
            </div>
          </div>

          {(missingVoice || missingOpenai) && (
            <div className="banner warn">
              {missingOpenai && <div>• No OpenAI key set — the image + thumbnail stages will fail. Add it in Settings.</div>}
              {missingVoice && <div>• No ElevenLabs voice ID set — narration will fail. Add it in Settings.</div>}
            </div>
          )}

          <div className="row">
            <button className="btn primary" disabled={!topic.trim()} onClick={start}>
              <Play size={15} weight="fill" /> Generate video
            </button>
            <span className="sub">
              ~{length === 'short' ? '8–12' : length === 'long' ? '120–180' : '60–100'} beats. Narration & images spend API
              credits.
            </span>
          </div>
        </div>
      ) : (
        <div className="col" style={{ maxWidth: 920 }}>
          <div className="row">
            <div style={{ flex: 1 }}>
              <strong>{activeSlug}</strong> · <span className="sub">{statusLabel(ctl.status)}</span>
            </div>
            {running && (
              <button className="btn" onClick={() => ctl.cancel()}>
                Cancel
              </button>
            )}
            {(ctl.status === 'done' || ctl.status === 'error' || ctl.status === 'canceled') && (
              <>
                <button className="btn" onClick={ctl.reset}>
                  New run
                </button>
                {activeSlug && (
                  <button className="btn primary" onClick={() => onCreated(activeSlug)}>
                    Open project
                  </button>
                )}
              </>
            )}
          </div>

          <StageTracker ctl={ctl} meta={meta} />

          {ctl.status === 'paused' && ctl.pausedStage === 'research' && (
            <div className="panel col">
              <div className="banner info">{ctl.pausedReason}</div>
              <label className="field">
                Script (edit if you like)
                <textarea value={scriptDraft} onChange={(e) => setScriptDraft(e.target.value)} style={{ minHeight: 240 }} />
              </label>
              <div className="row">
                <button className="btn primary" onClick={() => approveScript(true)}>
                  Save & continue
                </button>
                <button className="btn" onClick={() => approveScript(false)}>
                  Continue without changes
                </button>
              </div>
            </div>
          )}

          {ctl.status === 'paused' && ctl.pausedStage !== 'research' && (
            <div className="panel col">
              <div className="banner info">{ctl.pausedReason}</div>
              <label className="field">
                Paste your SRT
                <textarea
                  value={srtDraft}
                  onChange={(e) => setSrtDraft(e.target.value)}
                  placeholder={'1\\n00:00:00,000 --> 00:00:04,000\\nFirst beat of narration…'}
                  style={{ minHeight: 220, fontFamily: 'ui-monospace, monospace' }}
                />
              </label>
              <div className="row">
                <button className="btn" onClick={importSrt}>
                  Import .srt file…
                </button>
                <div className="spacer" />
                <button className="btn primary" disabled={!srtDraft.trim()} onClick={continueWithSrt}>
                  Save SRT & continue
                </button>
              </div>
            </div>
          )}

          {ctl.error && <div className="banner warn">{ctl.error}</div>}
          <RunConsole ctl={ctl} />
        </div>
      )}
    </div>
  )
}

function statusLabel(s: string): string {
  return (
    {
      running: 'running…',
      paused: 'paused — your turn',
      done: 'finished',
      error: 'stopped on an error',
      canceled: 'canceled'
    } as Record<string, string>
  )[s] || s
}
