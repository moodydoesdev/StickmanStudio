import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, Pause, Play, SpeakerHigh, X } from '@phosphor-icons/react'
import type { ElevenVoice, VoiceFilters } from '../../../shared/types'

/**
 * The selected-voice field used in Setup + Settings: shows the friendly voice
 * name (not the id), with a Browse button that opens the picker, plus a manual
 * id-entry fallback.
 */
export function VoiceField({
  voiceId,
  voiceName,
  canBrowse,
  beforeBrowse,
  onChange
}: {
  voiceId?: string
  voiceName?: string
  canBrowse: boolean
  beforeBrowse?: () => Promise<void>
  onChange: (id: string, name: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState(false)

  async function browse(): Promise<void> {
    if (beforeBrowse) await beforeBrowse()
    setOpen(true)
  }

  return (
    <label className="field">
      ElevenLabs voice
      {manual ? (
        <div className="row">
          <input
            type="text"
            placeholder="Paste a voice id"
            value={voiceId || ''}
            onChange={(e) => onChange(e.target.value, '')}
          />
          <button className="btn" onClick={() => setManual(false)}>
            Done
          </button>
        </div>
      ) : (
        <div className="row">
          <div className="voice-display">
            {voiceName || voiceId ? (
              <>
                <SpeakerHigh size={15} />
                <strong>{voiceName || voiceId}</strong>
                {voiceName && voiceId && <span className="vid">{voiceId}</span>}
              </>
            ) : (
              <span className="muted">No voice selected</span>
            )}
          </div>
          <button
            className="btn"
            disabled={!canBrowse}
            title={canBrowse ? 'Browse ElevenLabs voices' : 'Enter your ElevenLabs API key first'}
            onClick={browse}
          >
            Browse…
          </button>
        </div>
      )}
      <div className="row" style={{ gap: 14 }}>
        <button type="button" className="linklike" onClick={() => setManual((m) => !m)}>
          {manual ? 'Pick from library instead' : 'Enter ID manually'}
        </button>
        {(voiceId || voiceName) && (
          <button type="button" className="linklike" onClick={() => onChange('', '')}>
            Clear
          </button>
        )}
      </div>
      {open && (
        <VoicePicker
          currentVoiceId={voiceId}
          onPick={(id, name) => onChange(id, name)}
          onClose={() => setOpen(false)}
        />
      )}
    </label>
  )
}

interface Props {
  currentVoiceId?: string
  onPick: (id: string, name: string) => void
  onClose: () => void
}

const LANGUAGES: Array<[string, string]> = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['pl', 'Polish'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['zh', 'Chinese'],
  ['ko', 'Korean'], ['ar', 'Arabic'], ['nl', 'Dutch'], ['tr', 'Turkish'], ['ru', 'Russian'],
  ['sv', 'Swedish'], ['id', 'Indonesian'], ['fil', 'Filipino'], ['uk', 'Ukrainian'], ['cs', 'Czech'],
  ['el', 'Greek'], ['fi', 'Finnish'], ['ro', 'Romanian'], ['da', 'Danish'], ['bg', 'Bulgarian'],
  ['ms', 'Malay'], ['sk', 'Slovak'], ['hr', 'Croatian'], ['ta', 'Tamil'], ['vi', 'Vietnamese'],
  ['no', 'Norwegian'], ['hu', 'Hungarian']
]
const LANG_NAME = Object.fromEntries(LANGUAGES)

const USE_CASES: Array<[string, string]> = [
  ['narrative_story', 'Narration & Story'], ['conversational', 'Conversational'],
  ['characters_animation', 'Characters & Animation'], ['social_media', 'Social Media'],
  ['entertainment_tv', 'Entertainment & TV'], ['advertisement', 'Advertisement'],
  ['informative_educational', 'Informative & Educational'], ['news', 'News']
]
const ACCENTS: Array<[string, string]> = [
  ['american', 'American'], ['british', 'British'], ['australian', 'Australian'], ['irish', 'Irish'],
  ['canadian', 'Canadian'], ['scottish', 'Scottish'], ['indian', 'Indian'], ['south african', 'South African'],
  ['transatlantic', 'Transatlantic'], ['jamaican', 'Jamaican']
]
const GENDERS: Array<[string, string]> = [['male', 'Male'], ['female', 'Female'], ['neutral', 'Neutral']]
const AGES: Array<[string, string]> = [['young', 'Young'], ['middle_aged', 'Middle aged'], ['old', 'Old']]
const CATEGORIES: Array<[string, string]> = [
  ['professional', 'Professional'], ['high_quality', 'High quality'], ['famous', 'Famous']
]

function pretty(s?: string): string | undefined {
  if (!s) return undefined
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
function chipsFor(v: ElevenVoice): string[] {
  const lang = v.language ? LANG_NAME[v.language] || pretty(v.language) : undefined
  return [lang, pretty(v.gender), pretty(v.age), pretty(v.accent), pretty(v.useCase)].filter(Boolean) as string[]
}

export function VoicePicker({ currentVoiceId, onPick, onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<'mine' | 'library'>('mine')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filters, setFilters] = useState<Omit<VoiceFilters, 'search'>>({})
  const [mine, setMine] = useState<ElevenVoice[] | null>(null)
  const [lib, setLib] = useState<ElevenVoice[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  // load the user's own voices once
  useEffect(() => {
    window.api.listVoices().then((r) => {
      if (r.ok && r.voices) setMine(r.voices)
      else if (tab === 'mine') setError(r.error || 'Could not load your voices.')
    })
    return () => audioRef.current?.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadLibrary = useCallback(
    async (reset: boolean) => {
      setLoading(true)
      setError(null)
      const nextPage = reset ? 0 : page + 1
      const r = await window.api.searchVoices({ ...filters, search: debounced || undefined }, nextPage)
      setLoading(false)
      if (!r.ok) {
        setError(r.error || 'Could not search the voice library.')
        if (reset) setLib([])
        return
      }
      setHasMore(!!r.hasMore)
      setPage(nextPage)
      setLib((prev) => (reset ? r.voices || [] : [...prev, ...(r.voices || [])]))
    },
    [filters, debounced, page]
  )

  // re-query the library when filters/search change (and when switching to it)
  useEffect(() => {
    if (tab !== 'library') return
    loadLibrary(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, debounced, filters])

  const mineFiltered = useMemo(() => {
    if (!mine) return []
    const q = debounced.toLowerCase()
    if (!q) return mine
    return mine.filter((v) => [v.name, ...chipsFor(v)].join(' ').toLowerCase().includes(q))
  }, [mine, debounced])

  const rows = tab === 'mine' ? mineFiltered : lib

  function togglePlay(v: ElevenVoice): void {
    const audio = audioRef.current
    if (!audio || !v.previewUrl) return
    if (playing === v.id) {
      audio.pause()
      setPlaying(null)
      return
    }
    audio.src = v.previewUrl
    audio.currentTime = 0
    audio.play().then(() => setPlaying(v.id), () => setPlaying(null))
  }

  async function choose(v: ElevenVoice): Promise<void> {
    // Library voices must be added to the account to be usable for TTS.
    if (v.shared && v.publicOwnerId) {
      setAdding(v.id)
      const r = await window.api.addVoice(v.publicOwnerId, v.id, v.name)
      setAdding(null)
      if (!r.ok || !r.id) {
        setError(r.error || 'Could not add this voice to your account.')
        return
      }
      onPick(r.id, v.name)
    } else {
      onPick(v.id, v.name)
    }
    onClose()
  }

  function setFilter(key: keyof VoiceFilters, value: string): void {
    setFilters((f) => ({ ...f, [key]: value || undefined }))
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <audio ref={audioRef} onEnded={() => setPlaying(null)} />
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>Choose a narrator voice</h3>
          <div className="spacer" />
          <button className="tb-btn" onClick={onClose} title="Close" style={{ width: 34, height: 34 }}>
            <X size={16} />
          </button>
        </div>

        <div className="seg" style={{ marginBottom: 12 }}>
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
            My voices
          </button>
          <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
            Voice Library (all of ElevenLabs)
          </button>
        </div>

        <input
          type="text"
          placeholder={tab === 'mine' ? 'Search your voices…' : 'Search the ElevenLabs voice library…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        {tab === 'library' && (
          <div className="filter-bar">
            <Select label="Language" value={filters.language || ''} opts={LANGUAGES} onChange={(v) => setFilter('language', v)} />
            <Select label="Accent" value={filters.accent || ''} opts={ACCENTS} onChange={(v) => setFilter('accent', v)} />
            <Select label="Use case" value={filters.useCase || ''} opts={USE_CASES} onChange={(v) => setFilter('useCase', v)} />
            <Select label="Type" value={filters.category || ''} opts={CATEGORIES} onChange={(v) => setFilter('category', v)} />
            <Select label="Gender" value={filters.gender || ''} opts={GENDERS} onChange={(v) => setFilter('gender', v)} />
            <Select label="Age" value={filters.age || ''} opts={AGES} onChange={(v) => setFilter('age', v)} />
          </div>
        )}

        {error && <div className="banner warn" style={{ marginTop: 12 }}>{error}</div>}

        <div className="voice-list" style={{ marginTop: 12 }}>
          {tab === 'mine' && mine === null && !error && <div className="empty">Loading your voices…</div>}
          {tab === 'library' && loading && lib.length === 0 && <div className="empty">Searching the library…</div>}
          {!loading && rows.length === 0 && !error && (mine !== null || tab === 'library') && (
            <div className="empty">No voices match your filters.</div>
          )}

          {rows.map((v) => {
            const isSel = currentVoiceId === v.id
            const chips = chipsFor(v)
            return (
              <div key={`${v.id}-${v.shared}`} className={`voice-row ${isSel ? 'sel' : ''}`}>
                <button
                  className="voice-play"
                  disabled={!v.previewUrl}
                  title={v.previewUrl ? 'Preview' : 'No preview available'}
                  onClick={() => togglePlay(v)}
                >
                  {playing === v.id ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
                </button>
                <div className="voice-meta">
                  <div className="voice-name">
                    {v.name}
                    {isSel && <CheckCircle size={14} weight="fill" color="var(--ok)" style={{ marginLeft: 6 }} />}
                  </div>
                  {chips.length > 0 && (
                    <div className="chips">
                      {chips.map((c, i) => (
                        <span key={i} className="chip">{c}</span>
                      ))}
                    </div>
                  )}
                </div>
                <button className="btn sm" disabled={adding === v.id} onClick={() => choose(v)}>
                  {adding === v.id ? 'Adding…' : v.shared ? 'Add & use' : isSel ? 'Selected' : 'Use voice'}
                </button>
              </div>
            )
          })}

          {tab === 'library' && hasMore && !loading && (
            <button className="btn" style={{ alignSelf: 'center', marginTop: 8 }} onClick={() => loadLibrary(false)}>
              Load more
            </button>
          )}
          {tab === 'library' && loading && lib.length > 0 && <div className="empty">Loading…</div>}
        </div>
      </div>
    </div>
  )
}

function Select({
  label,
  value,
  opts,
  onChange
}: {
  label: string
  value: string
  opts: Array<[string, string]>
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <label className="filter-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {opts.map(([val, lbl]) => (
          <option key={val} value={val}>
            {lbl}
          </option>
        ))}
      </select>
    </label>
  )
}
