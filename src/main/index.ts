import { app, BrowserWindow, net, protocol, session, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, runNameMigration } from './lib/config'
import { activateRuntime } from './lib/runtime'
import { registerIpc } from './ipc'

// Serve project media (images, mp4) to the renderer without exposing the FS.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
])

const isDev = !!process.env.ELECTRON_RENDERER_URL

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: '#0e0f13',
    title: 'Stickman Studio',
    // Custom titlebar: hide the native caption but keep resize borders + (on
    // macOS) the traffic-light buttons, inset to line up with our 40px bar.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  // Keep the renderer's maximize button glyph in sync with the real state.
  const sendMax = () => win.webContents.send('win:maximized', win.isMaximized())
  win.on('maximize', sendMax)
  win.on('unmaximize', sendMax)

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerMediaProtocol(): void {
  protocol.handle('media', (request) => {
    try {
      const url = new URL(request.url)
      // media://<slug>/<...file>
      const slug = decodeURIComponent(url.host)
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const root = loadConfig().videosDir
      const target = path.normalize(path.join(root, slug, rel))
      // Path-traversal guard: must stay inside the videos root.
      if (!target.startsWith(path.normalize(root))) {
        return new Response('Forbidden', { status: 403 })
      }
      return net.fetch(pathToFileURL(target).toString())
    } catch (e: any) {
      return new Response(`Bad request: ${e.message}`, { status: 400 })
    }
  })
}

function applyCsp(): void {
  // Strict CSP in production; relaxed in dev so Vite/React-refresh inline + HMR
  // websockets keep working.
  // media: https allows playing ElevenLabs voice-preview mp3s from their CDN.
  const policy = isDev
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: media: https: ws: http://localhost:* ; img-src 'self' media: data: blob: https:"
    : "default-src 'self'; img-src 'self' media: data: blob:; media-src 'self' media: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'"
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } })
  })
}

app.whenReady().then(() => {
  activateRuntime() // put any app-installed runtimes on PATH for detection + use
  runNameMigration() // one-time move of the old "YouTube Explainer Studio" videos folder
  applyCsp()
  registerMediaProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
