import { app, BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { UpdateStatus } from '../../shared/types'

// electron-updater reads the GitHub feed defined by the `publish` block in
// electron-builder.yml (owner: moodydoesdev, repo: StickmanStudio). The
// `app-update.yml` that points it there is generated at package time, so this
// only does anything in an installed build — never in `electron-vite dev`.

// Re-check while the app stays open. GitHub release checks are cheap.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

let lastStatus: UpdateStatus = { state: 'idle' }
let availableVersion = ''
let wired = false

function broadcast(status: UpdateStatus): void {
  lastStatus = status
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('update:event', status)
  }
}

/** Latest known update state — lets a freshly-loaded renderer catch up. */
export function getUpdateStatus(): UpdateStatus {
  return lastStatus
}

/** Only installed builds carry the app-update.yml the updater needs. */
function canUpdate(): boolean {
  return app.isPackaged
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function wireEvents(): void {
  if (wired) return
  wired = true

  // Grab the update in the background as soon as one is found, and — if the user
  // never clicks "Restart now" — apply it silently the next time they quit.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    availableVersion = info.version
    broadcast({ state: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) =>
    broadcast({ state: 'not-available', version: info.version })
  )

  autoUpdater.on('download-progress', (p: ProgressInfo) =>
    broadcast({
      state: 'downloading',
      version: availableVersion || app.getVersion(),
      percent: Math.round(p.percent),
      bytesPerSecond: Math.round(p.bytesPerSecond),
      transferred: p.transferred,
      total: p.total
    })
  )

  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    broadcast({ state: 'downloaded', version: info.version })
  )

  autoUpdater.on('error', (err) => {
    const msg = messageOf(err)
    // A missing latest.yml / 404 just means there's no *published* release yet
    // (drafts are invisible to the updater). That's normal, not an error.
    if (/404|latest.*\.yml|Cannot find|No published/i.test(msg)) {
      broadcast({ state: 'not-available', version: app.getVersion() })
    } else {
      broadcast({ state: 'error', message: msg })
    }
  })
}

/** Manual "Check for updates" trigger (also used by the periodic timer). */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!canUpdate()) {
    broadcast({ state: 'not-available', version: app.getVersion() })
    return lastStatus
  }
  wireEvents()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    // Network / feed errors also land on the 'error' event above; this catch is
    // just so the awaited promise never rejects into the IPC layer.
    broadcast({ state: 'error', message: messageOf(err) })
  }
  return lastStatus
}

/** Quit and apply a downloaded update. No-op unless one is ready. */
export function installUpdateNow(): void {
  if (lastStatus.state === 'downloaded') {
    // isSilent=false → show the installer UI; forceRunAfter=true → relaunch us.
    autoUpdater.quitAndInstall(false, true)
  }
}

/** Wire listeners and kick off the first check shortly after launch. */
export function startUpdater(): void {
  if (!canUpdate()) return
  wireEvents()
  // Let the window paint first, then check. Re-check on a slow interval after.
  setTimeout(() => void checkForUpdates(), 8000)
  setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS).unref()
}
