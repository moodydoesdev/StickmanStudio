import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/types'

function describe(s: UpdateStatus): string {
  switch (s.state) {
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Version ${s.version} found — downloading…`
    case 'downloading':
      return `Downloading ${s.version}… ${s.percent}%`
    case 'downloaded':
      return `Version ${s.version} is ready to install.`
    case 'not-available':
      return 'You’re on the latest version.'
    case 'error':
      return s.message
    default:
      return ''
  }
}

/** Settings panel: shows the current version and lets the user check/install. */
export function UpdatesPanel(): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.appMeta().then((m) => setVersion(m.version)).catch(() => {})
    window.api.update.status().then(setStatus).catch(() => {})
    return window.api.update.onEvent(setStatus)
  }, [])

  const busy = status.state === 'checking' || status.state === 'downloading'
  const note = describe(status)

  return (
    <div className="panel col">
      <h3 style={{ margin: 0 }}>Updates</h3>
      <div className="row" style={{ alignItems: 'center' }}>
        <div className="sub" style={{ flex: 1 }}>
          Current version: <strong>v{version || '—'}</strong>
          {note && (
            <>
              <br />
              <span className={status.state === 'error' ? 'warn-text' : ''}>{note}</span>
            </>
          )}
        </div>
        {status.state === 'downloaded' ? (
          <button className="btn primary" onClick={() => window.api.update.install()}>
            Restart & install
          </button>
        ) : (
          <button className="btn" disabled={busy} onClick={() => window.api.update.check()}>
            {busy ? 'Working…' : 'Check for updates'}
          </button>
        )}
      </div>
      <div className="sub">
        Updates are downloaded from GitHub Releases and applied automatically the next time you restart.
      </div>
    </div>
  )
}
