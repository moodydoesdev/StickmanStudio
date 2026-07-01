import { existsSync } from 'node:fs'
import path from 'node:path'
import type { DependencyId, DependencyStatus, DoctorReport } from '../../shared/types'
import { loadConfig } from './config'
import { claudeSkillsDir, isWindows } from './paths'
import { run, which } from './runner'

/** First captured group of `re` from the combined stdout+stderr of a version call. */
async function versionOf(cmd: string, args: string[], re: RegExp): Promise<string | null> {
  if (!which(cmd)) return null
  try {
    const r = await run(cmd, args, { timeoutMs: 15000 })
    const text = `${r.stdout}\n${r.stderr}`
    const m = text.match(re)
    return m ? m[1] : r.ok ? text.trim().split('\n')[0] : null
  } catch {
    return null
  }
}

/** Find a usable python (prefer 3.10–3.12) among the platform's candidates. */
export async function detectPython(): Promise<{ bin: string; args: string[]; version: string } | null> {
  const override = loadConfig().bin?.python
  const candidates: Array<{ bin: string; args: string[] }> = []
  if (override) candidates.push({ bin: override, args: [] })
  candidates.push({ bin: 'python', args: [] }, { bin: 'python3', args: [] })
  if (isWindows) candidates.push({ bin: 'py', args: ['-3'] })

  let fallback: { bin: string; args: string[]; version: string } | null = null
  for (const c of candidates) {
    if (!which(c.bin)) continue
    try {
      const r = await run(c.bin, [...c.args, '--version'], { timeoutMs: 15000 })
      const m = `${r.stdout}\n${r.stderr}`.match(/Python (\d+\.\d+\.\d+)/)
      if (!m) continue
      const [maj, min] = m[1].split('.').map(Number)
      const entry = { bin: c.bin, args: c.args, version: m[1] }
      if (maj === 3 && min >= 10 && min <= 12) return entry // ideal
      if (!fallback) fallback = entry // usable but outside the sweet spot
    } catch {
      /* try next */
    }
  }
  return fallback
}

/** Absolute path to the whisper venv's python interpreter, if it exists. */
export function whisperVenvPython(skillsRoot = claudeSkillsDir()): string {
  const base = path.join(skillsRoot, 'transcribe', 'scripts', '.venv')
  return isWindows ? path.join(base, 'Scripts', 'python.exe') : path.join(base, 'bin', 'python')
}

function skillsInstalled(): { ok: boolean; detail: string } {
  const root = claudeSkillsDir()
  const required = [
    'new-video',
    'research-video',
    'narrate',
    'transcribe',
    'video-image-prompts',
    'chatgpt-images',
    'render',
    'description',
    'thumbnail'
  ]
  const missing = required.filter((s) => !existsSync(path.join(root, s, 'SKILL.md')))
  if (missing.length === 0) return { ok: true, detail: `${required.length} skills in ${root}` }
  if (missing.length === required.length) return { ok: false, detail: `not installed in ${root}` }
  return { ok: false, detail: `missing: ${missing.join(', ')}` }
}

export async function runDoctor(): Promise<DoctorReport> {
  const cfg = loadConfig()
  const deps: DependencyStatus[] = []

  const nodeV = await versionOf('node', ['--version'], /v?(\d+\.\d+\.\d+)/)
  deps.push({
    id: 'node',
    name: 'Node.js (18+)',
    present: !!nodeV && Number(nodeV.split('.')[0]) >= 18,
    version: nodeV || undefined,
    detail: nodeV ? undefined : 'not found on PATH',
    installable: true,
    manualUrl: 'https://nodejs.org/en/download',
    required: true
  })

  const npmV = await versionOf('npm', ['--version'], /(\d+\.\d+\.\d+)/)
  deps.push({
    id: 'npm',
    name: 'npm',
    present: !!npmV,
    version: npmV || undefined,
    detail: npmV ? 'ships with Node.js' : 'comes with Node.js',
    installable: false,
    manualUrl: 'https://nodejs.org/en/download',
    required: true
  })

  const claudeV = await versionOf('claude', ['--version'], /(\d+\.\d+\.\d+)/)
  deps.push({
    id: 'claude',
    name: 'Claude Code CLI',
    present: !!claudeV,
    version: claudeV || undefined,
    detail: claudeV ? undefined : 'needed for the research / prompts / description / thumbnail stages',
    installable: true,
    manualUrl: 'https://docs.claude.com/en/docs/claude-code/overview',
    required: true
  })

  const py = await detectPython()
  deps.push({
    id: 'python',
    name: 'Python (3.10–3.12)',
    present: !!py,
    version: py?.version,
    detail: py
      ? `${py.bin} ${py.args.join(' ')}`.trim() + (Number(py.version.split('.')[1]) > 12 ? ' (newer than 3.12 — usually fine)' : '')
      : 'needed for transcription + the OpenAI/ElevenLabs CLIs',
    installable: true,
    manualUrl: 'https://www.python.org/downloads/',
    required: true
  })

  const ffmpegV = await versionOf('ffmpeg', ['-version'], /ffmpeg version (\S+)/)
  deps.push({
    id: 'ffmpeg',
    name: 'ffmpeg',
    present: !!ffmpegV,
    version: ffmpegV || undefined,
    installable: true,
    manualUrl: 'https://www.gyan.dev/ffmpeg/builds/',
    required: true
  })

  const ffprobeV = await versionOf('ffprobe', ['-version'], /ffprobe version (\S+)/)
  deps.push({
    id: 'ffprobe',
    name: 'ffprobe',
    present: !!ffprobeV,
    version: ffprobeV || undefined,
    detail: 'ships alongside ffmpeg',
    installable: true,
    manualUrl: 'https://www.gyan.dev/ffmpeg/builds/',
    required: true
  })

  const openaiV = await versionOf('openai', ['--version'], /(\d+\.\d+\.\d+)/)
  deps.push({
    id: 'openai',
    name: 'OpenAI CLI',
    present: !!openaiV,
    version: openaiV || undefined,
    detail: openaiV ? undefined : 'used to generate images + thumbnails (pip install openai)',
    installable: true,
    manualUrl: 'https://pypi.org/project/openai/',
    required: true
  })

  const elevenV = await versionOf('elevenlabs', ['--version'], /(\d+\.\d+\.\d+)/)
  deps.push({
    id: 'elevenlabs',
    name: 'ElevenLabs CLI',
    present: !!elevenV,
    version: elevenV || undefined,
    detail: elevenV ? undefined : 'used to log in for narration (pip install elevenlabs)',
    installable: true,
    manualUrl: 'https://pypi.org/project/elevenlabs/',
    required: false
  })

  const venvPy = whisperVenvPython()
  deps.push({
    id: 'whisper-venv',
    name: 'Transcription engine (faster-whisper venv)',
    present: existsSync(venvPy),
    detail: existsSync(venvPy) ? venvPy : 'one-time ~1 GB install into the transcribe skill',
    installable: true,
    required: true
  })

  const sk = skillsInstalled()
  deps.push({
    id: 'skills',
    name: 'Video skills → ~/.claude/skills',
    present: sk.ok,
    detail: sk.detail,
    installable: true,
    required: true
  })

  // Claude auth readiness is informational here; the Setup screen tracks it
  // separately because it can't be auto-detected reliably from the CLI.
  void cfg

  const allRequiredReady = deps.filter((d) => d.required).every((d) => d.present)
  return { deps, allRequiredReady, generatedAt: Date.now() }
}

export const DEP_ORDER: DependencyId[] = [
  'node',
  'npm',
  'claude',
  'python',
  'ffmpeg',
  'ffprobe',
  'openai',
  'elevenlabs',
  'whisper-venv',
  'skills'
]
