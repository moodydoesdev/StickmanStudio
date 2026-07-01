import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/types'

/**
 * Small fixed toast, bottom-right, that only appears once an update is actually
 * downloading or ready to install. Checking / "up to date" stay silent here —
 * the Settings → Updates panel is where a user goes looking for that.
 */
export function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.api?.update.status().then(setStatus).catch(() => {})
    return window.api?.update.onEvent((s) => {
      setStatus(s)
      // A newly-ready update is worth re-surfacing even if an earlier toast was
      // dismissed mid-download.
      if (s.state === 'downloaded') setDismissed(false)
    })
  }, [])

  if (dismissed) return null
  if (status.state !== 'downloading' && status.state !== 'downloaded') return null

  return (
    <div className="update-toast">
      {status.state === 'downloading' ? (
        <>
          <div className="ut-title">Downloading update v{status.version}…</div>
          <div className="ut-bar">
            <span style={{ width: `${status.percent}%` }} />
          </div>
          <div className="ut-sub">{status.percent}%</div>
        </>
      ) : (
        <>
          <div className="ut-title">Update v{status.version} is ready</div>
          <div className="ut-sub">Restart to finish installing — your work is saved.</div>
          <div className="ut-actions">
            <button className="btn" onClick={() => setDismissed(true)}>
              Later
            </button>
            <button className="btn primary" onClick={() => window.api.update.install()}>
              Restart now
            </button>
          </div>
        </>
      )}
    </div>
  )
}
