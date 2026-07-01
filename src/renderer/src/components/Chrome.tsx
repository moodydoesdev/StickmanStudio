import { useEffect, useState } from 'react'
import mascot from '../assets/mascot.svg'

export function TitleBar(): JSX.Element {
  const isMac = window.api?.platform === 'darwin'
  const [max, setMax] = useState(false)

  useEffect(() => {
    window.api?.win.isMaximized().then(setMax)
    return window.api?.win.onMaximized(setMax)
  }, [])

  return (
    <div className={`titlebar ${isMac ? 'mac' : ''}`}>
      <div className="tb-brand">
        <img className="tb-logo" src={mascot} alt="" />
        <span>Stickman Studio</span>
      </div>
      <div className="tb-drag" />
      {!isMac && (
        <div className="tb-controls">
          <button className="tb-btn" title="Minimize" onClick={() => window.api.win.minimize()}>
            <svg width="11" height="11" viewBox="0 0 11 11">
              <rect x="1" y="5" width="9" height="1" fill="currentColor" />
            </svg>
          </button>
          <button
            className="tb-btn"
            title={max ? 'Restore' : 'Maximize'}
            onClick={async () => setMax(await window.api.win.toggleMaximize())}
          >
            {max ? (
              <svg width="11" height="11" viewBox="0 0 11 11">
                <rect x="2.5" y="1" width="6.5" height="6.5" fill="none" stroke="currentColor" />
                <rect x="1" y="2.5" width="6.5" height="6.5" fill="var(--bg)" stroke="currentColor" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 11 11">
                <rect x="1" y="1" width="8.5" height="8.5" fill="none" stroke="currentColor" />
              </svg>
            )}
          </button>
          <button className="tb-btn close" title="Close" onClick={() => window.api.win.close()}>
            <svg width="11" height="11" viewBox="0 0 11 11">
              <path d="M1 1 L10 10 M10 1 L1 10" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

export function LoadingScreen({ message, error }: { message: string; error?: boolean }): JSX.Element {
  return (
    <div className="loading">
      <div className="loading-card">
        <div className="logo-badge">
          <img className="badge-logo" src={mascot} alt="" />
        </div>
        <h1>Stickman Studio</h1>
        {error ? (
          <div className="banner warn" style={{ maxWidth: 420 }}>
            {message}
          </div>
        ) : (
          <>
            <div className="spinner" />
            <div className="loading-msg">{message || 'Getting things ready…'}</div>
          </>
        )}
      </div>
    </div>
  )
}
