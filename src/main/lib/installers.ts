import { cp, mkdir, readdir, rename } from 'node:fs/promises'
import { chmodSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { DependencyId } from '../../shared/types'
import { loadConfig, saveConfig } from './config'
import { detectPython, whisperVenvPython } from './doctor'
import { bundledSkillsDir, claudeSkillsDir, isMac, isWindows } from './paths'
import { run, which } from './runner'
import {
  activateRuntime,
  cleanup,
  download,
  extract,
  ffmpegDir,
  nodeDir,
  npmGlobalDir,
  runtimeRoot,
  toolsVenvDir
} from './runtime'

const NODE_VERSION = '20.18.1'

export type Log = (line: string) => void

export interface InstallResult {
  ok: boolean
  message: string
}

/** Move the single top-level folder inside `parent` to `target`. */
async function promoteSingleChild(parent: string, target: string): Promise<void> {
  const entries = await readdir(parent, { withFileTypes: true })
  const dir = entries.find((e) => e.isDirectory())
  if (!dir) throw new Error(`No extracted folder found in ${parent}`)
  await cleanup(target)
  await mkdir(path.dirname(target), { recursive: true })
  await rename(path.join(parent, dir.name), target)
}

// ── Node.js (portable) ─────────────────────────────────────────────────────
async function installNode(log: Log): Promise<InstallResult> {
  if (which('node') && which('npm')) return { ok: true, message: 'Node already on PATH' }
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  let file: string
  if (isWindows) file = `node-v${NODE_VERSION}-win-${arch}.zip`
  else if (isMac) file = `node-v${NODE_VERSION}-darwin-${arch}.tar.gz`
  else file = `node-v${NODE_VERSION}-linux-${arch}.tar.gz`
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${file}`
  const tmp = path.join(runtimeRoot(), '.tmp-node')
  await cleanup(tmp)
  const archive = path.join(runtimeRoot(), file)
  await download(url, archive, log)
  await extract(archive, tmp, log)
  await promoteSingleChild(tmp, nodeDir())
  await cleanup(archive)
  await cleanup(tmp)
  activateRuntime()
  const ok = !!which('node')
  return { ok, message: ok ? `Node ${NODE_VERSION} installed` : 'Node install did not land on PATH' }
}

// ── ffmpeg + ffprobe (static) ──────────────────────────────────────────────
async function installFfmpeg(log: Log): Promise<InstallResult> {
  if (which('ffmpeg') && which('ffprobe')) return { ok: true, message: 'ffmpeg already on PATH' }
  if (isWindows) {
    const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
    const tmp = path.join(runtimeRoot(), '.tmp-ffmpeg')
    await cleanup(tmp)
    const archive = path.join(runtimeRoot(), 'ffmpeg.zip')
    await download(url, archive, log)
    await extract(archive, tmp, log)
    await promoteSingleChild(tmp, ffmpegDir()) // -> ffmpegDir()/bin/ffmpeg.exe
    await cleanup(archive)
    await cleanup(tmp)
  } else if (isMac) {
    // evermeet ships one static binary per zip.
    await mkdir(ffmpegDir(), { recursive: true })
    for (const name of ['ffmpeg', 'ffprobe']) {
      const archive = path.join(runtimeRoot(), `${name}.zip`)
      await download(`https://evermeet.cx/ffmpeg/getrelease/${name}/zip`, archive, log)
      await extract(archive, ffmpegDir(), log)
      const bin = path.join(ffmpegDir(), name)
      if (existsSync(bin)) chmodSync(bin, 0o755)
      await cleanup(archive)
    }
  } else {
    return { ok: false, message: 'Auto-install of ffmpeg is only wired for Windows/macOS — install it from your package manager.' }
  }
  activateRuntime()
  const ok = !!which('ffmpeg') && !!which('ffprobe')
  return { ok, message: ok ? 'ffmpeg + ffprobe installed' : 'ffmpeg install did not land on PATH' }
}

// ── Claude Code CLI (npm global into an app-local prefix) ───────────────────
async function installClaude(log: Log): Promise<InstallResult> {
  if (which('claude')) return { ok: true, message: 'Claude Code already on PATH' }
  if (!which('npm')) {
    const node = await installNode(log)
    if (!node.ok) return { ok: false, message: 'Claude needs Node/npm first, and Node install failed.' }
  }
  const prefix = npmGlobalDir()
  await mkdir(prefix, { recursive: true })
  const r = await run('npm', ['install', '-g', '@anthropic-ai/claude-code', '--prefix', prefix], {
    onLine: (_s, l) => log(l)
  })
  activateRuntime()
  const ok = r.ok && !!which('claude')
  return { ok, message: ok ? 'Claude Code CLI installed' : `npm install failed (exit ${r.code})` }
}

// ── Python (best-effort via winget / brew, else manual) ─────────────────────
async function installPython(log: Log): Promise<InstallResult> {
  const have = await detectPython()
  if (have) return { ok: true, message: `Python ${have.version} found (${have.bin})` }
  if (isWindows && which('winget')) {
    log('Installing Python 3.12 via winget…')
    await run('winget', ['install', '-e', '--id', 'Python.Python.3.12', '--accept-source-agreements', '--accept-package-agreements'], { onLine: (_s, l) => log(l) })
    // winget updates PATH only for new shells; locate the interpreter directly.
    const base = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python')
    if (existsSync(base)) {
      const dirs = (await readdir(base)).filter((d) => d.startsWith('Python31'))
      const py = dirs.map((d) => path.join(base, d, 'python.exe')).find((p) => existsSync(p))
      if (py) {
        saveConfig({ bin: { ...loadConfig().bin, python: py } })
        return { ok: true, message: `Python installed at ${py}` }
      }
    }
  } else if (isMac && which('brew')) {
    log('Installing Python 3.12 via Homebrew…')
    const r = await run('brew', ['install', 'python@3.12'], { onLine: (_s, l) => log(l) })
    if (r.ok && (await detectPython())) return { ok: true, message: 'Python installed via Homebrew' }
  }
  return {
    ok: false,
    message: isWindows
      ? 'Could not auto-install Python (winget unavailable). Install Python 3.12 from python.org with "Add to PATH", then re-check.'
      : 'Could not auto-install Python (Homebrew unavailable). Install Python 3.12 from python.org, then re-check.'
  }
}

async function pythonCmd(): Promise<{ bin: string; args: string[] } | null> {
  const p = await detectPython()
  return p ? { bin: p.bin, args: p.args } : null
}

// ── OpenAI / ElevenLabs CLIs (shared pip venv) ──────────────────────────────
async function ensureToolsVenv(log: Log): Promise<string | null> {
  const venvPy = isWindows
    ? path.join(toolsVenvDir(), 'Scripts', 'python.exe')
    : path.join(toolsVenvDir(), 'bin', 'python')
  if (existsSync(venvPy)) return venvPy
  const py = await pythonCmd()
  if (!py) return null
  log('Creating Python tools venv…')
  const r = await run(py.bin, [...py.args, '-m', 'venv', toolsVenvDir()], { onLine: (_s, l) => log(l) })
  if (!r.ok) return null
  await run(venvPy, ['-m', 'pip', 'install', '--upgrade', 'pip'], { onLine: (_s, l) => log(l) })
  return existsSync(venvPy) ? venvPy : null
}

async function pipInstallTool(pkg: string, cliName: string, log: Log): Promise<InstallResult> {
  if (which(cliName)) return { ok: true, message: `${cliName} already on PATH` }
  const venvPy = await ensureToolsVenv(log)
  if (!venvPy) return { ok: false, message: 'Python is required first — install Python, then re-check.' }
  log(`pip install ${pkg}…`)
  const r = await run(venvPy, ['-m', 'pip', 'install', '--upgrade', pkg], { onLine: (_s, l) => log(l) })
  activateRuntime()
  const ok = r.ok && !!which(cliName)
  return { ok, message: ok ? `${cliName} CLI installed` : `pip install ${pkg} failed (exit ${r.code})` }
}

// ── Skills → ~/.claude/skills ───────────────────────────────────────────────
async function installSkills(log: Log): Promise<InstallResult> {
  const src = bundledSkillsDir()
  const dest = claudeSkillsDir()
  if (!existsSync(src)) return { ok: false, message: `Bundled skills not found at ${src}` }
  await mkdir(dest, { recursive: true })
  const skills = (await readdir(src, { withFileTypes: true })).filter(
    (e) => e.isDirectory() && existsSync(path.join(src, e.name, 'SKILL.md'))
  )
  for (const s of skills) {
    log(`Installing skill: ${s.name}`)
    await cp(path.join(src, s.name), path.join(dest, s.name), { recursive: true })
  }
  return { ok: true, message: `Installed ${skills.length} skills to ${dest}` }
}

// ── Whisper venv (transcription) inside the installed skill ─────────────────
async function installWhisperVenv(log: Log): Promise<InstallResult> {
  const transcribeScripts = path.join(claudeSkillsDir(), 'transcribe', 'scripts')
  if (!existsSync(transcribeScripts)) {
    const s = await installSkills(log)
    if (!s.ok) return s
  }
  const py = await pythonCmd()
  if (!py) return { ok: false, message: 'Python is required first — install Python, then re-check.' }
  const venvDir = path.join(transcribeScripts, '.venv')
  const venvPy = whisperVenvPython()
  if (!existsSync(venvPy)) {
    log('Creating transcription venv…')
    const r = await run(py.bin, [...py.args, '-m', 'venv', venvDir], { onLine: (_s, l) => log(l) })
    if (!r.ok) return { ok: false, message: `venv creation failed (exit ${r.code})` }
  }
  await run(venvPy, ['-m', 'pip', 'install', '--upgrade', 'pip'], { onLine: (_s, l) => log(l) })
  log('Installing faster-whisper (CPU)… this is a large, one-time download.')
  const r = await run(venvPy, ['-m', 'pip', 'install', 'faster-whisper'], { onLine: (_s, l) => log(l) })
  const ok = r.ok && existsSync(venvPy)
  return {
    ok,
    message: ok
      ? 'Transcription engine ready (CPU). NVIDIA GPU acceleration is a separate advanced step.'
      : `faster-whisper install failed (exit ${r.code})`
  }
}

/** Public entry point used by the IPC layer. */
export async function installDependency(id: DependencyId, log: Log): Promise<InstallResult> {
  activateRuntime()
  switch (id) {
    case 'node':
    case 'npm':
      return installNode(log)
    case 'claude':
      return installClaude(log)
    case 'python':
      return installPython(log)
    case 'ffmpeg':
    case 'ffprobe':
      return installFfmpeg(log)
    case 'openai':
      return pipInstallTool('openai', 'openai', log)
    case 'elevenlabs':
      return pipInstallTool('elevenlabs', 'elevenlabs', log)
    case 'skills':
      return installSkills(log)
    case 'whisper-venv':
      return installWhisperVenv(log)
    default:
      return { ok: false, message: `Don't know how to install ${id}` }
  }
}

/** Dependency-safe order for an "install everything" run. */
export const INSTALL_ORDER: DependencyId[] = [
  'node',
  'claude',
  'python',
  'ffmpeg',
  'openai',
  'elevenlabs',
  'skills',
  'whisper-venv'
]
