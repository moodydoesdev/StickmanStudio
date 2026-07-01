import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowClockwise, FloppyDisk, Pause, Play } from '@phosphor-icons/react'

interface Clip {
  file: string
  start: number
  dur?: number
}
interface Data {
  audio: string
  audioDur: number
  clips: Clip[]
}

const fmt = (s: number): string => {
  if (!Number.isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function Timeline({ slug, hasSrt, onRendered }: { slug: string; hasSrt: boolean; onRendered: () => void }): JSX.Element {
  const [data, setData] = useState<Data | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [audioDur, setAudioDur] = useState(0)
  const [pxPerSec, setPxPerSec] = useState(50)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [sel, setSel] = useState(0)
  const [rendering, setRendering] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [crossfade, setCrossfade] = useState(false)
  const [captions, setCaptions] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const peaksRef = useRef<number[] | null>(null)
  const dragRef = useRef<number | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  const audioUrl = data?.audio ? `media://${encodeURIComponent(slug)}/${encodeURIComponent(data.audio)}` : ''
  const width = Math.max(320, Math.ceil(audioDur * pxPerSec))

  useEffect(() => {
    window.api.getTimeline(slug).then((r) => {
      if (r.ok && r.data) {
        setData(r.data)
        setClips(r.data.clips)
        setAudioDur(r.data.audioDur || 0)
      } else setError(r.error || 'Could not load timings.')
    })
  }, [slug])

  // Decode the audio to a peak array for the waveform (best-effort).
  useEffect(() => {
    if (!audioUrl) return
    let cancelled = false
    ;(async () => {
      try {
        const buf = await (await fetch(audioUrl)).arrayBuffer()
        const ctx = new AudioContext()
        const decoded = await ctx.decodeAudioData(buf)
        ctx.close()
        if (cancelled) return
        setAudioDur((d) => d || decoded.duration)
        const ch = decoded.getChannelData(0)
        const buckets = 3000
        const size = Math.max(1, Math.floor(ch.length / buckets))
        const peaks: number[] = []
        for (let b = 0; b < buckets; b++) {
          let max = 0
          for (let j = 0; j < size; j++) {
            const v = Math.abs(ch[b * size + j] || 0)
            if (v > max) max = v
          }
          peaks.push(max)
        }
        peaksRef.current = peaks
        drawWave()
      } catch {
        /* waveform is optional */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl])

  const drawWave = useCallback(() => {
    const canvas = canvasRef.current
    const peaks = peaksRef.current
    if (!canvas || !peaks || !audioDur) return
    canvas.width = width
    canvas.height = 60
    const g = canvas.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, width, 60)
    g.fillStyle = '#33415e'
    const n = peaks.length
    for (let x = 0; x < width; x++) {
      const p = peaks[Math.floor((x / width) * n)] || 0
      const h = Math.max(1, p * 56)
      g.fillRect(x, 30 - h / 2, 1, h)
    }
  }, [width, audioDur])

  useEffect(() => {
    drawWave()
  }, [drawWave, pxPerSec])

  // Playback wiring.
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const t = (): void => setCur(a.currentTime)
    const end = (): void => setPlaying(false)
    a.addEventListener('timeupdate', t)
    a.addEventListener('ended', end)
    return () => {
      a.removeEventListener('timeupdate', t)
      a.removeEventListener('ended', end)
    }
  }, [data])

  function togglePlay(): void {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      a.play()
      setPlaying(true)
    } else {
      a.pause()
      setPlaying(false)
    }
  }
  function seekToX(clientX: number): void {
    const sc = scrollRef.current
    const a = audioRef.current
    if (!sc || !a) return
    const rect = sc.getBoundingClientRect()
    const x = clientX - rect.left + sc.scrollLeft
    a.currentTime = Math.max(0, Math.min(audioDur, x / pxPerSec))
    setCur(a.currentTime)
  }

  // Drag a clip's start (clip 0 is pinned at 0 for A/V sync).
  useEffect(() => {
    function move(e: MouseEvent): void {
      const i = dragRef.current
      if (i == null || !scrollRef.current) return
      const rect = scrollRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left + scrollRef.current.scrollLeft
      let t = x / pxPerSec
      setClips((cs) => {
        const arr = cs.slice()
        const lo = i > 0 ? arr[i - 1].start + 0.1 : 0
        const hi = i < arr.length - 1 ? arr[i + 1].start - 0.1 : audioDur - 0.1
        t = Math.max(lo, Math.min(hi, t))
        arr[i] = { ...arr[i], start: Math.round(t * 100) / 100 }
        return arr
      })
      setDirty(true)
    }
    function up(): void {
      dragRef.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [pxPerSec, audioDur])

  // Spacebar toggles playback (unless typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [log])

  function setSelToPlayhead(): void {
    if (sel <= 0) return
    setClips((cs) => {
      const arr = cs.slice()
      const lo = arr[sel - 1].start + 0.1
      const hi = sel < arr.length - 1 ? arr[sel + 1].start - 0.1 : audioDur - 0.1
      arr[sel] = { ...arr[sel], start: Math.round(Math.max(lo, Math.min(hi, cur)) * 100) / 100 }
      return arr
    })
    setDirty(true)
  }

  async function save(): Promise<void> {
    if (!data) return
    await window.api.saveTimeline(slug, { audio: data.audio, audioDur, clips })
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  async function reset(): Promise<void> {
    const r = await window.api.resetTimeline(slug)
    if (r.ok && r.data) {
      setClips(r.data.clips)
      setAudioDur(r.data.audioDur || audioDur)
      setDirty(false)
    }
  }

  async function reRender(): Promise<void> {
    if (!data) return
    setRendering(true)
    setLog([])
    setError(null)
    const off = window.api.onTimelineLog((l) => setLog((p) => [...p.slice(-600), l]))
    const r = await window.api.renderTimeline(slug, {
      data: { audio: data.audio, audioDur, clips },
      crossfade,
      captions
    })
    off()
    setRendering(false)
    if (r.ok) {
      setDirty(false)
      onRendered()
    } else setError(r.error || 'Render failed.')
  }

  if (error && !data) return <div className="banner warn">{error}</div>
  if (!data) return <div className="empty">Loading timings…</div>

  return (
    <div className="timeline">
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}

      <div className="tl-toolbar">
        <button className="btn sm" onClick={togglePlay}>
          {playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="sub" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fmt(cur)} / {fmt(audioDur)}
        </span>
        <button className="btn sm" disabled={sel <= 0} onClick={setSelToPlayhead} title="Move the selected clip's start to the playhead">
          Set clip start → playhead
        </button>
        <div className="spacer" />
        <span className="sub">Zoom</span>
        <input type="range" min={12} max={200} value={pxPerSec} onChange={(e) => setPxPerSec(Number(e.target.value))} />
      </div>

      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ width }}>
          <div className="tl-ruler" onMouseDown={(e) => seekToX(e.clientX)}>
            {Array.from({ length: Math.floor(audioDur) + 1 }).map((_, s) =>
              s % (pxPerSec < 24 ? 10 : pxPerSec < 60 ? 5 : 1) === 0 ? (
                <div key={s} className="tl-tick" style={{ left: s * pxPerSec }}>
                  {fmt(s)}
                </div>
              ) : null
            )}
          </div>

          <canvas className="tl-wave" ref={canvasRef} onMouseDown={(e) => seekToX(e.clientX)} />

          <div className="tl-clips">
            {clips.map((c, i) => {
              const next = clips[i + 1]?.start ?? audioDur
              const left = c.start * pxPerSec
              const w = Math.max(2, (next - c.start) * pxPerSec)
              return (
                <div
                  key={c.file}
                  className={`tl-clip ${i === sel ? 'sel' : ''} ${i === 0 ? 'pinned' : ''}`}
                  style={{
                    left,
                    width: w,
                    backgroundImage: `url("media://${encodeURIComponent(slug)}/${encodeURIComponent(c.file)}")`
                  }}
                  title={`${c.file} — starts ${fmt(c.start)}${i === 0 ? ' (pinned)' : ''}`}
                  onMouseDown={(e) => {
                    setSel(i)
                    if (i > 0) {
                      e.preventDefault()
                      dragRef.current = i
                    }
                  }}
                >
                  <span className="tl-clip-t">{fmt(c.start)}</span>
                </div>
              )
            })}
          </div>

          <div className="tl-playhead" style={{ left: cur * pxPerSec }} />
        </div>
      </div>

      <div className="tl-actions">
        <label className="check">
          <input type="checkbox" checked={crossfade} onChange={(e) => setCrossfade(e.target.checked)} /> Crossfade
        </label>
        <label className="check" title={hasSrt ? '' : 'No SRT for this project'}>
          <input type="checkbox" disabled={!hasSrt} checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Burn
          captions
        </label>
        <div className="spacer" />
        {saved && <span className="pill ok">Saved</span>}
        {dirty && !saved && <span className="pill missing">Unsaved</span>}
        <button className="btn sm" onClick={reset} disabled={rendering}>
          <ArrowClockwise size={14} /> Reset to auto
        </button>
        <button className="btn sm" onClick={save} disabled={rendering}>
          <FloppyDisk size={14} /> Save timings
        </button>
        <button className="btn primary" onClick={reRender} disabled={rendering}>
          {rendering ? 'Rendering…' : 'Re-render video'}
        </button>
      </div>

      {error && <div className="banner warn">{error}</div>}
      <div className="sub" style={{ marginTop: 4 }}>
        Drag a clip to change when it appears; clip 1 is pinned to the start for A/V sync. Play the audio, then use “Set
        clip start → playhead”.
      </div>

      {(rendering || log.length > 0) && (
        <div className="console" ref={logRef} style={{ height: 160, marginTop: 10 }}>
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  )
}
