import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DependencyId, InstallEvent, NewVideoRequest, RunEvent } from '../shared/types'
import { launchClaudeLogin, verifyClaude } from './lib/auth'
import { loadConfig, saveConfig } from './lib/config'
import { addVoice, listVoices, searchVoices } from './lib/elevenlabs'
import { runDoctor } from './lib/doctor'
import { INSTALL_ORDER, installDependency } from './lib/installers'
import { cancelRun, planStages, resumeRun, startRun, STAGES } from './lib/pipeline'
import { getProject, listImages, projectDir, readArtifact, scanProjects, type ArtifactKind } from './lib/projects'

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

export function registerIpc(): void {
  // ── config ───────────────────────────────────────────────────────────────
  ipcMain.handle('config:get', () => loadConfig())
  ipcMain.handle('config:save', (_e, patch) => saveConfig(patch))

  ipcMain.handle('app:meta', () => ({
    platform: process.platform,
    videosDir: loadConfig().videosDir
  }))

  // ── window controls (custom titlebar) ──────────────────────────────────────
  const winOf = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender)
  ipcMain.handle('win:minimize', (e) => winOf(e)?.minimize())
  ipcMain.handle('win:maximize', (e) => {
    const w = winOf(e)
    if (!w) return false
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
    return w.isMaximized()
  })
  ipcMain.handle('win:close', (e) => winOf(e)?.close())
  ipcMain.handle('win:isMaximized', (e) => winOf(e)?.isMaximized() ?? false)

  ipcMain.handle('dialog:pick-folder', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  // ── setup: doctor + installers ─────────────────────────────────────────────
  ipcMain.handle('doctor:run', () => runDoctor())

  ipcMain.handle('install:dep', async (e, id: DependencyId) => {
    const log = (line: string) => e.sender.send('install:event', { type: 'install-log', id, line } as InstallEvent)
    const r = await installDependency(id, log)
    e.sender.send('install:event', { type: 'install-done', id, ok: r.ok, message: r.message } as InstallEvent)
    return r
  })

  ipcMain.handle('install:all', async (e) => {
    const log = (id: DependencyId) => (line: string) =>
      e.sender.send('install:event', { type: 'install-log', id, line } as InstallEvent)
    const results: Record<string, { ok: boolean; message: string }> = {}
    for (const id of INSTALL_ORDER) {
      const r = await installDependency(id, log(id))
      results[id] = r
      e.sender.send('install:event', { type: 'install-done', id, ok: r.ok, message: r.message } as InstallEvent)
    }
    return results
  })

  // ── claude auth ────────────────────────────────────────────────────────────
  ipcMain.handle('auth:login', () => launchClaudeLogin())
  ipcMain.handle('auth:verify', () => verifyClaude())

  // ── elevenlabs voices ──────────────────────────────────────────────────────
  ipcMain.handle('elevenlabs:voices', () => listVoices())
  ipcMain.handle('elevenlabs:search', (_e, filters, page: number) => searchVoices(filters, page))
  ipcMain.handle('elevenlabs:add', (_e, publicOwnerId: string, voiceId: string, name: string) =>
    addVoice(publicOwnerId, voiceId, name)
  )

  // ── projects ───────────────────────────────────────────────────────────────
  ipcMain.handle('projects:list', () => scanProjects())
  ipcMain.handle('projects:get', (_e, slug: string) => getProject(slug))
  ipcMain.handle('project:artifact', (_e, slug: string, kind: ArtifactKind) => readArtifact(slug, kind))
  ipcMain.handle('project:images', (_e, slug: string) => listImages(slug))

  ipcMain.handle('project:save-script', (_e, slug: string, text: string) => {
    const dir = projectDir(slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${slug}.script.txt`), text, 'utf8')
    return true
  })

  ipcMain.handle('project:save-srt', (_e, slug: string, text: string) => {
    const dir = projectDir(slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${slug}.srt`), text, 'utf8')
    return true
  })

  ipcMain.handle('project:import-srt', async (_e, slug: string) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose an SRT file',
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: ['srt'] }]
    })
    if (res.canceled || !res.filePaths[0]) return false
    const dir = projectDir(slug)
    mkdirSync(dir, { recursive: true })
    copyFileSync(res.filePaths[0], path.join(dir, `${slug}.srt`))
    return true
  })

  ipcMain.handle('project:open-folder', (_e, slug: string) => shell.openPath(projectDir(slug)))
  ipcMain.handle('project:reveal', (_e, slug: string, file: string) =>
    shell.showItemInFolder(path.join(projectDir(slug), file))
  )

  // ── pipeline ───────────────────────────────────────────────────────────────
  ipcMain.handle('pipeline:stages', () => STAGES)
  ipcMain.handle('pipeline:plan', (_e, req: NewVideoRequest) => planStages(req))
  ipcMain.handle('pipeline:start', (_e, req: NewVideoRequest) =>
    startRun(req, (ev: RunEvent) => broadcast('run:event', ev))
  )
  ipcMain.handle('pipeline:resume', (_e, runId: string) => resumeRun(runId))
  ipcMain.handle('pipeline:cancel', (_e, runId: string) => cancelRun(runId))
}
