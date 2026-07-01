import { useEffect, useRef, useState } from 'react'
import { CheckCircle, Circle, XCircle } from '@phosphor-icons/react'
import type { AppConfig, DependencyId, DependencyStatus, DoctorReport, InstallEvent } from '../../../shared/types'
import { VoiceField } from '../components/VoicePicker'

interface Props {
  config: AppConfig
  doctor: DoctorReport | null
  refreshDoctor: () => Promise<DoctorReport>
  saveConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
  onDone: () => void
}

export function Setup({ config, doctor, refreshDoctor, saveConfig, onDone }: Props): JSX.Element {
  const [busy, setBusy] = useState<DependencyId | 'all' | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [authMsg, setAuthMsg] = useState<string>('')
  const [openaiKey, setOpenaiKey] = useState(config.openaiApiKey || '')
  const [elevenKey, setElevenKey] = useState(config.elevenlabsApiKey || '')
  const [voiceId, setVoiceId] = useState(config.voiceId || '')
  const [voiceName, setVoiceName] = useState(config.voiceName || '')
  const [anthropicKey, setAnthropicKey] = useState(config.anthropicApiKey || '')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return window.api.onInstallEvent((e: InstallEvent) => {
      if (e.type === 'install-log') setLog((l) => [...l.slice(-400), `${e.id}: ${e.line}`])
      else setLog((l) => [...l.slice(-400), `▶ ${e.id} — ${e.ok ? 'OK' : 'FAILED'}: ${e.message || ''}`])
    })
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [log])

  async function install(id: DependencyId): Promise<void> {
    setBusy(id)
    setLog((l) => [...l, `— installing ${id} —`])
    await window.api.installDep(id)
    await refreshDoctor()
    setBusy(null)
  }

  async function installAll(): Promise<void> {
    setBusy('all')
    setLog((l) => [...l, '— installing everything —'])
    await window.api.installAll()
    await refreshDoctor()
    setBusy(null)
  }

  async function setAuth(mode: AppConfig['claudeAuth']): Promise<void> {
    await saveConfig({ claudeAuth: mode })
  }

  async function doLogin(): Promise<void> {
    const r = await window.api.claudeLogin()
    setAuthMsg(r.message)
  }

  async function verify(): Promise<void> {
    setAuthMsg('Checking…')
    if (config.claudeAuth === 'apikey' && anthropicKey !== config.anthropicApiKey) {
      await saveConfig({ anthropicApiKey: anthropicKey })
    }
    const r = await window.api.claudeVerify()
    setAuthMsg(r.message)
  }

  async function saveKeys(): Promise<void> {
    await saveConfig({
      openaiApiKey: openaiKey.trim() || undefined,
      elevenlabsApiKey: elevenKey.trim() || undefined,
      voiceId: voiceId.trim() || undefined,
      voiceName: voiceName.trim() || undefined
    })
    setLog((l) => [...l, '— saved API keys —'])
  }

  const deps = doctor?.deps || []
  const ready = !!doctor?.allRequiredReady

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Setup</h1>
          <div className="sub">Install everything the studio needs — once. Nothing here touches your system folders.</div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => refreshDoctor()} disabled={!!busy}>
          Re-check
        </button>
        <button className="btn primary" onClick={installAll} disabled={!!busy}>
          {busy === 'all' ? 'Installing…' : 'Install everything'}
        </button>
      </div>

      <div className="col" style={{ gap: 18 }}>
        {/* Claude account */}
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Claude account</h3>
          <div className="sub" style={{ marginBottom: 12 }}>
            The script, image-prompt, description and thumbnail stages run through <span className="kbd">claude -p</span>.
          </div>
          <div className="row" style={{ marginBottom: 12 }}>
            <label className="check">
              <input type="radio" checked={config.claudeAuth !== 'apikey'} onChange={() => setAuth('login')} /> Sign in with
              Claude (Pro/Max)
            </label>
            <label className="check">
              <input type="radio" checked={config.claudeAuth === 'apikey'} onChange={() => setAuth('apikey')} /> Use an API
              key
            </label>
          </div>
          {config.claudeAuth === 'apikey' ? (
            <div className="row">
              <input
                type="password"
                placeholder="sk-ant-…"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
              />
              <button className="btn" onClick={verify}>
                Save & verify
              </button>
            </div>
          ) : (
            <div className="row">
              <button className="btn" onClick={doLogin}>
                Sign in with Claude
              </button>
              <button className="btn ghost" onClick={verify}>
                Verify
              </button>
            </div>
          )}
          {authMsg && (
            <div className="banner info" style={{ marginTop: 12 }}>
              {authMsg}
            </div>
          )}
        </div>

        {/* Dependency checklist */}
        <div className="panel" style={{ padding: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
            Dependencies
          </div>
          {deps.map((d) => (
            <DepRow key={d.id} dep={d} busy={busy === d.id || busy === 'all'} onInstall={() => install(d.id)} />
          ))}
        </div>

        {/* API keys */}
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Provider keys</h3>
          <div className="sub" style={{ marginBottom: 12 }}>
            Stored privately in the app — never written into the skill files. ElevenLabs sign-in happens in the terminal
            via its CLI.
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="field">
              OpenAI API key (images + thumbnails)
              <input type="password" placeholder="sk-…" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} />
            </label>
            <label className="field">
              ElevenLabs API key (narration)
              <input
                type="password"
                placeholder="sk_…"
                value={elevenKey}
                onChange={(e) => setElevenKey(e.target.value)}
              />
            </label>
            <VoiceField
              voiceId={voiceId}
              voiceName={voiceName}
              canBrowse={!!elevenKey.trim()}
              beforeBrowse={async () => {
                await saveConfig({ elevenlabsApiKey: elevenKey.trim() || undefined })
              }}
              onChange={(id, name) => {
                setVoiceId(id)
                setVoiceName(name)
              }}
            />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={saveKeys}>
              Save keys
            </button>
          </div>
        </div>

        {/* Install log */}
        {log.length > 0 && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Install log</h3>
            <div className="console" ref={logRef}>
              {log.map((l, i) => (
                <div key={i} className={l.startsWith('▶') ? 'sys' : /fail|error/i.test(l) ? 'err' : ''}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="row">
          {ready ? (
            <div className="banner ok" style={{ flex: 1 }}>
              Everything required is installed — setup is complete automatically. You’re ready to make videos.
            </div>
          ) : (
            <div className="banner warn" style={{ flex: 1 }}>
              Some required pieces are still missing — install them above (or use “Install everything”). This page
              unlocks the app on its own as soon as they’re all present.
            </div>
          )}
          <button className="btn primary" disabled={!ready} onClick={onDone}>
            Go to My Videos →
          </button>
        </div>
      </div>
    </div>
  )
}

function DepRow({ dep, busy, onInstall }: { dep: DependencyStatus; busy: boolean; onInstall: () => void }): JSX.Element {
  return (
    <div className="dep">
      <span className="status">
        {dep.present ? (
          <CheckCircle size={20} weight="fill" color="var(--ok)" />
        ) : dep.required ? (
          <XCircle size={20} weight="fill" color="var(--err)" />
        ) : (
          <Circle size={20} color="var(--muted)" />
        )}
      </span>
      <div style={{ flex: 1 }}>
        <div className="name">
          {dep.name} {dep.version && <span className="pill ok">{dep.version}</span>}
        </div>
        {dep.detail && <div className="detail">{dep.detail}</div>}
      </div>
      {!dep.present && <span className={`pill ${dep.required ? 'required' : 'missing'}`}>{dep.required ? 'required' : 'optional'}</span>}
      {dep.present ? (
        <span className="pill ok">ready</span>
      ) : dep.installable ? (
        <button className="btn sm" onClick={onInstall} disabled={busy}>
          {busy ? 'Installing…' : 'Install'}
        </button>
      ) : dep.manualUrl ? (
        <a className="btn sm" href={dep.manualUrl} target="_blank" rel="noreferrer">
          Get it
        </a>
      ) : null}
    </div>
  )
}
