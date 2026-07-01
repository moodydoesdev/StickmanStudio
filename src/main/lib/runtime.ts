import { app } from 'electron'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { run } from './runner'

/**
 * The app keeps anything it installs itself under userData/runtime so it never
 * needs admin rights and stays isolated from the system. These bin dirs get
 * prepended to PATH for the whole process (and therefore every child process),
 * so detection + execution both see them.
 */
export function runtimeRoot(): string {
  return path.join(app.getPath('userData'), 'runtime')
}

export const nodeDir = () => path.join(runtimeRoot(), 'node')
export const ffmpegDir = () => path.join(runtimeRoot(), 'ffmpeg')
export const npmGlobalDir = () => path.join(runtimeRoot(), 'npm-global')
export const toolsVenvDir = () => path.join(runtimeRoot(), 'py-tools')

function venvBin(venv: string): string {
  return process.platform === 'win32' ? path.join(venv, 'Scripts') : path.join(venv, 'bin')
}

/** Bin directories that currently exist among our managed runtimes. */
export function runtimeBinDirs(): string[] {
  const dirs = [
    nodeDir(),
    path.join(nodeDir(), 'bin'),
    npmGlobalDir(),
    path.join(npmGlobalDir(), 'bin'),
    path.join(ffmpegDir(), 'bin'),
    ffmpegDir(),
    venvBin(toolsVenvDir())
  ]
  return dirs.filter((d) => existsSync(d))
}

let activated = false
/** Prepend our runtime bin dirs to PATH exactly once (idempotent on re-call). */
export function activateRuntime(): void {
  const bins = runtimeBinDirs()
  const current = (process.env.PATH || '').split(path.delimiter)
  const missing = bins.filter((b) => !current.includes(b))
  if (missing.length) {
    process.env.PATH = [...missing, ...current].join(path.delimiter)
  }
  activated = true
}

export function isActivated(): boolean {
  return activated
}

/** Stream a URL to disk (follows redirects via fetch). */
export async function download(url: string, dest: string, onLine?: (l: string) => void): Promise<void> {
  mkdirSync(path.dirname(dest), { recursive: true })
  onLine?.(`Downloading ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`)
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(dest))
  onLine?.(`Saved ${path.basename(dest)}`)
}

/**
 * Extract a .zip or .tar.gz using the system `tar` (present on Windows 10+,
 * macOS and Linux). Returns the destination dir.
 */
export async function extract(archive: string, destDir: string, onLine?: (l: string) => void): Promise<string> {
  mkdirSync(destDir, { recursive: true })
  onLine?.(`Extracting ${path.basename(archive)}`)
  const r = await run('tar', ['-xf', archive, '-C', destDir], { onLine: (_s, l) => onLine?.(l) })
  if (!r.ok) throw new Error(`Extract failed for ${archive}: ${r.stderr}`)
  return destDir
}

export async function cleanup(p: string): Promise<void> {
  await rm(p, { recursive: true, force: true }).catch(() => {})
}
