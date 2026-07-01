import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CheckCircle, Circle, FilmSlate, Gear, PuzzlePiece, Sparkle } from '@phosphor-icons/react'
import type { AppConfig, DoctorReport, VideoProject } from '../../shared/types'
import { LoadingScreen, TitleBar } from './components/Chrome'
import { Setup } from './views/Setup'
import { Library } from './views/Library'
import { NewVideo } from './views/NewVideo'
import { VideoDetail } from './views/VideoDetail'
import { Settings } from './views/Settings'

export type View = 'setup' | 'library' | 'new' | 'detail' | 'settings'

export function App(): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [doctor, setDoctor] = useState<DoctorReport | null>(null)
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [view, setView] = useState<View>('library')
  const [slug, setSlug] = useState<string | null>(null)
  const [booted, setBooted] = useState(false)
  const [bootMsg, setBootMsg] = useState('Starting up…')
  const [bootError, setBootError] = useState<string | null>(null)

  const refreshProjects = useCallback(async () => {
    setProjects(await window.api.listProjects())
  }, [])

  const refreshDoctor = useCallback(async () => {
    const d = await window.api.doctor()
    setDoctor(d)
    return d
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        if (!window.api) {
          setBootError('The app bridge failed to load. Please restart Stickman Studio.')
          setBooted(true)
          return
        }
        setBootMsg('Loading your settings…')
        const cfg = await window.api.getConfig()
        setConfig(cfg)
        if (!cfg.setupComplete) setView('setup')
        // Render the UI now — don't block on the (slower) dependency scan.
        setBooted(true)
        window.api.listProjects().then(setProjects).catch(() => {})
        window.api
          .doctor()
          .then((d) => {
            setDoctor(d)
            // Auto-detect readiness — no "Finish setup" press needed.
            if (!d.allRequiredReady) setView('setup')
          })
          .catch(() => {})
      } catch (e: any) {
        setBootError(e?.message || String(e))
        setBooted(true)
      }
    })()
  }, [])

  const saveConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const next = await window.api.saveConfig(patch)
    setConfig(next)
    return next
  }, [])

  const open = useCallback((s: string) => {
    setSlug(s)
    setView('detail')
  }, [])

  // Once every required dependency is present, mark setup complete automatically.
  useEffect(() => {
    if (doctor?.allRequiredReady && config && !config.setupComplete) {
      saveConfig({ setupComplete: true })
    }
  }, [doctor?.allRequiredReady, config, saveConfig])

  // Loading / error states still get the titlebar so the window is movable.
  if (!booted || (!config && !bootError)) {
    return (
      <div className="window">
        <TitleBar />
        <LoadingScreen message={bootMsg} />
      </div>
    )
  }
  if (bootError || !config) {
    return (
      <div className="window">
        <TitleBar />
        <LoadingScreen message={bootError || 'Something went wrong while starting.'} error />
      </div>
    )
  }

  const ready = !!doctor?.allRequiredReady
  const missingCount = doctor ? doctor.deps.filter((d) => d.required && !d.present).length : 0

  return (
    <div className="window">
      <TitleBar />
      <div className="app">
        <aside className="sidebar">
          <Nav
            label="My Videos"
            icon={<FilmSlate size={18} />}
            active={view === 'library' || view === 'detail'}
            onClick={() => setView('library')}
          />
          <Nav label="New Video" icon={<Sparkle size={18} />} active={view === 'new'} onClick={() => setView('new')} />
          <Nav
            label="Setup"
            icon={<PuzzlePiece size={18} />}
            active={view === 'setup'}
            onClick={() => setView('setup')}
            badge={missingCount > 0 ? String(missingCount) : undefined}
          />
          <Nav label="Settings" icon={<Gear size={18} />} active={view === 'settings'} onClick={() => setView('settings')} />
          <div className="spacer" />
          <div className="foot">
            {ready ? (
              <span className="foot-status">
                <CheckCircle size={13} weight="fill" color="var(--ok)" />
                All systems ready
              </span>
            ) : (
              <button className="foot-link" onClick={() => setView('setup')} title="Open Setup">
                <Circle size={13} color="var(--warn)" />
                Finish setup to start
              </button>
            )}
            <br />
            v0.1.0
          </div>
        </aside>

        <main className="main">
          {view === 'setup' && (
            <Setup
              config={config}
              doctor={doctor}
              refreshDoctor={refreshDoctor}
              saveConfig={saveConfig}
              onDone={() => setView('library')}
            />
          )}
          {view === 'library' && (
            <Library
              projects={projects}
              ready={ready}
              refresh={refreshProjects}
              onOpen={open}
              onNew={() => setView('new')}
              onSetup={() => setView('setup')}
            />
          )}
          {view === 'new' && (
            <NewVideo
              config={config}
              ready={ready}
              onSetup={() => setView('setup')}
              onCreated={async (s) => {
                await refreshProjects()
                open(s)
              }}
            />
          )}
          {view === 'detail' && slug && (
            <VideoDetail slug={slug} config={config} onBack={() => setView('library')} refresh={refreshProjects} />
          )}
          {view === 'settings' && <Settings config={config} saveConfig={saveConfig} />}
        </main>
      </div>
    </div>
  )
}

function Nav(props: { label: string; icon: ReactNode; active: boolean; onClick: () => void; badge?: string }): JSX.Element {
  return (
    <button className={`navitem ${props.active ? 'active' : ''}`} onClick={props.onClick}>
      <span className="navicon">{props.icon}</span>
      <span>{props.label}</span>
      {props.badge && <span className="badge">{props.badge}</span>}
    </button>
  )
}
