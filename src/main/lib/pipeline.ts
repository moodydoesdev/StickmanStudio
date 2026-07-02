import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { NewVideoRequest, RunEvent, StageId, StageInfo, VideoDefaults } from '../../shared/types'
import { childEnv, ensureVideosDir, loadConfig } from './config'
import { whisperVenvPython } from './doctor'
import { claudeSkillsDir, skillScript } from './paths'
import { runManaged, which, type ManagedRun } from './runner'
import { getProject } from './projects'

export const STAGES: StageInfo[] = [
  { id: 'research', label: 'Research & script', kind: 'llm', paid: false },
  { id: 'narrate', label: 'Narration (ElevenLabs)', kind: 'script', paid: true },
  { id: 'transcribe', label: 'Transcribe (timings)', kind: 'script', paid: false },
  { id: 'image-prompts', label: 'Image prompts', kind: 'llm', paid: false },
  { id: 'images', label: 'Generate images (OpenAI)', kind: 'script', paid: true },
  { id: 'render', label: 'Render video (ffmpeg)', kind: 'script', paid: false },
  { id: 'description', label: 'Description & chapters', kind: 'llm', paid: false },
  { id: 'thumbnail', label: 'Thumbnail', kind: 'llm', paid: true }
]
const STAGE_ORDER = STAGES.map((s) => s.id)

interface RunRecord {
  runId: string
  slug: string
  stages: StageId[]
  index: number
  pauseAfterScript: boolean
  req: NewVideoRequest
  managed: ManagedRun | null
  canceled: boolean
  emit: (e: RunEvent) => void
}

const RUNS = new Map<string, RunRecord>()

function sizeForImages(d: VideoDefaults['length'], vertical: boolean): string {
  return vertical ? '1024x1536' : '1536x864'
}
function sizeForRender(vertical: boolean): string {
  return vertical ? '1080x1920' : '1920x1080'
}

/** Which stages are already satisfied by files on disk (for resume / skip). */
function satisfied(slug: string): Set<StageId> {
  const p = getProject(slug)
  const done = new Set<StageId>()
  if (!p) return done
  const a = p.artifacts
  if (a.script) done.add('research')
  if (a.audio) done.add('narrate')
  if (a.srt) done.add('transcribe')
  if (a.prompts) done.add('image-prompts')
  if (a.images > 0) done.add('images')
  if (a.video) done.add('render')
  if (a.description) done.add('description')
  if (a.thumbnails > 0) done.add('thumbnail')
  return done
}

export function planStages(req: NewVideoRequest): StageId[] {
  let stages = [...STAGE_ORDER]
  if (req.startStage) {
    const i = STAGE_ORDER.indexOf(req.startStage)
    if (i >= 0) stages = STAGE_ORDER.slice(i)
  } else if (req.slug) {
    // Fresh run for an existing slug: skip stages whose artifacts already exist,
    // resuming at the first gap.
    const done = satisfied(req.slug)
    const firstMissing = STAGE_ORDER.findIndex((s) => !done.has(s))
    if (firstMissing > 0) stages = STAGE_ORDER.slice(firstMissing)
  }
  // Manual timings: the user supplies the SRT, so never run the transcribe stage.
  if (req.transcription === 'manual') stages = stages.filter((s) => s !== 'transcribe')
  return stages
}

// ── Stage commands ──────────────────────────────────────────────────────────

function claudeArgs(prompt: string, model?: string): string[] {
  const args = [
    '-p',
    prompt,
    '--permission-mode',
    'bypassPermissions',
    '--add-dir',
    claudeSkillsDir(),
    // Emit one JSON event per step so the console can show live progress —
    // plain -p prints nothing at all until the very end of the stage.
    '--output-format',
    'stream-json',
    '--verbose'
  ]
  if (model) args.push('--model', model)
  return args
}

/** Compact one-line summary of a tool call's most telling input field. */
function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const i = input as Record<string, unknown>
  const v = [i.query, i.url, i.file_path, i.command, i.skill, i.pattern, i.description].find(
    (x): x is string => typeof x === 'string' && !!x.trim()
  )
  if (!v) return ''
  const s = v.replace(/\s+/g, ' ').trim()
  return `  ${s.length > 120 ? s.slice(0, 120) + '…' : s}`
}

/**
 * Pretty-print one `--output-format stream-json` event for the run console.
 * null = not JSON (pass the raw line through); [] = known but boring (drop).
 */
function formatClaudeEvent(line: string): string[] | null {
  if (!line.startsWith('{')) return null
  let ev: any
  try {
    ev = JSON.parse(line)
  } catch {
    return null
  }
  switch (ev.type) {
    case 'system':
      return ev.subtype === 'init' && ev.model ? [`Claude session started (${ev.model})`] : []
    case 'assistant': {
      const out: string[] = []
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'text' && c.text?.trim()) out.push(...c.text.trim().split('\n'))
        else if (c.type === 'tool_use') out.push(`→ ${c.name}${summarizeInput(c.input)}`)
      }
      return out
    }
    case 'user': {
      // Only surface failed tool results; successes are noise.
      const out: string[] = []
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'tool_result' && c.is_error) {
          const text = typeof c.content === 'string' ? c.content : c.content?.[0]?.text || 'tool failed'
          out.push(`✗ ${String(text).split('\n')[0].slice(0, 200)}`)
        }
      }
      return out
    }
    case 'result': {
      const secs = typeof ev.duration_ms === 'number' ? ` in ${Math.round(ev.duration_ms / 1000)}s` : ''
      return ev.is_error ? [`✗ Claude finished with an error${secs}`] : [`✓ Claude finished${secs}`]
    }
    default:
      return []
  }
}

const HEADLESS =
  'You are running fully headless — no human will answer questions, so never ask any; pick the most defensible choice and proceed. Use only the relevant skill in ~/.claude/skills.'

function buildStage(rec: RunRecord, stage: StageId): { cmd: string; args: string[]; cwd: string } {
  const cfg = loadConfig()
  const videos = ensureVideosDir()
  const slug = rec.slug
  const node = which('node') || 'node'
  const skills = claudeSkillsDir()
  const { length, vertical, captions } = rec.req

  switch (stage) {
    case 'research': {
      const lenNote =
        length === 'short'
          ? 'Target a Short (~8-12 beats).'
          : length === 'long'
            ? 'Target an extended piece (~120-180 beats).'
            : 'Target ~60-100 beats (7-10 min).'
      const prompt = `${HEADLESS} Use the research-video skill to research the topic "${rec.req.topic}" and write a beat-disciplined narration script (one sentence = one visual beat) to the file "${slug}/${slug}.script.txt". ${lenNote} End with the channel outro. Also choose the single strongest title and save it (one line) to "${slug}/${slug}.title.txt". Create the "${slug}" folder if needed. When finished, print DONE.`
      return { cmd: 'claude', args: claudeArgs(prompt, cfg.claudeModel), cwd: videos }
    }
    // Note: the helper scripts' --project mode assumes a nested layout
    // (<project>/script/, audio/, images/ …) while the app keeps every video
    // as ONE FLAT folder — so always pass explicit input/output paths instead.
    case 'narrate': {
      const voice = cfg.voiceId
      if (!voice) throw new Error('No ElevenLabs voice ID set — add one in Settings before narrating.')
      const args = [
        skillScript(skills, 'narrate', 'narrate.mjs'),
        '--input',
        `${slug}/${slug}.script.txt`,
        '--out',
        `${slug}/${slug}.mp3`,
        '--voice',
        voice
      ]
      return { cmd: node, args, cwd: videos }
    }
    case 'transcribe': {
      const venvPy = whisperVenvPython()
      if (!existsSync(venvPy)) throw new Error('Transcription engine not installed — run Setup to install the whisper venv.')
      const args = [
        skillScript(skills, 'transcribe', 'transcribe.py'),
        `${slug}/${slug}.mp3`,
        '--out',
        `${slug}/${slug}.srt`
      ]
      if (cfg.useGpu) args.push('--device', 'cuda')
      return { cmd: venvPy, args, cwd: videos }
    }
    case 'image-prompts': {
      const vNote = vertical ? ' Use vertical (9:16) framing notes.' : ''
      const prompt = `${HEADLESS} Use the video-image-prompts skill: parse "${slug}/${slug}.srt" into beats, prepend the verbatim house STYLE PREFIX from the skill's base-style.md, and write exactly one prompt per beat to "${slug}/${slug}.prompts.txt" (format: a first line "video: ${slug}" then "MM:SS | prompt" lines).${vNote} When finished, print DONE.`
      return { cmd: 'claude', args: claudeArgs(prompt, cfg.claudeModel), cwd: videos }
    }
    case 'images': {
      // The prompts file starts with "video: <slug>", so --out . drops the
      // images straight into the flat <slug>/ folder.
      const args = [
        skillScript(skills, 'chatgpt-images', 'generate.mjs'),
        '--input',
        `${slug}/${slug}.prompts.txt`,
        '--out',
        '.',
        '--size',
        sizeForImages(length, vertical)
      ]
      return { cmd: node, args, cwd: videos }
    }
    case 'render': {
      const args = [
        skillScript(skills, 'render', 'render.mjs'),
        '--audio',
        `${slug}/${slug}.mp3`,
        '--images',
        slug,
        '--out',
        `${slug}/${slug}.mp4`,
        '--size',
        sizeForRender(vertical)
      ]
      if (captions) args.push('--captions', `${slug}/${slug}.srt`)
      return { cmd: node, args, cwd: videos }
    }
    case 'description': {
      const prompt = `${HEADLESS} Use the description skill: read "${slug}/${slug}.script.txt", "${slug}/${slug}.title.txt" and "${slug}/${slug}.srt", and write a full YouTube description with chapters built from the real beat timings to "${slug}/${slug}.description.txt". Don't fabricate sources. For the related-video line use exactly the placeholder "   • [Add a related video here]". No channel-specific branding or hashtags (e.g. #TheRichards) — the file must be generic to this video. When finished, print DONE.`
      return { cmd: 'claude', args: claudeArgs(prompt, cfg.claudeModel), cwd: videos }
    }
    case 'thumbnail': {
      const size = vertical ? '720x1280' : '1280x720'
      const prompt = `${HEADLESS} Use the thumbnail skill: compose 3 bold thumbnail prompt variations (verbatim house STYLE PREFIX + thumbnail composition + the title from "${slug}/${slug}.title.txt"), write them to "${slug}/${slug}.thumb-prompts.txt" with its first line exactly "video: ${slug}", then generate them by running: node "${skillScript(skills, 'chatgpt-images', 'generate.mjs')}" --input "${slug}/${slug}.thumb-prompts.txt" --out . --name-prefix "${slug}.thumb-" --size ${size} --quality high. When finished, print DONE.`
      return { cmd: 'claude', args: claudeArgs(prompt, cfg.claudeModel), cwd: videos }
    }
  }
}

// ── Execution loop ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Beats in prompts.txt (one "MM:SS | prompt" line each), or 0 if unreadable. */
function expectedImages(slug: string): number {
  try {
    const file = path.join(ensureVideosDir(), slug, `${slug}.prompts.txt`)
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => /^\d{1,2}:\d{2}\s*\|/.test(l)).length
  } catch {
    return 0
  }
}

/**
 * Pooled/cached volumes (DrivePool and friends) can lag directory listings
 * minutes behind writes, so a finished stage's files may not be visible to
 * the next process (or the library scan) yet. Poll until they show up.
 */
async function waitForArtifact(rec: RunRecord, stage: StageId): Promise<void> {
  const visible = () => {
    if (!satisfied(rec.slug).has(stage)) return false
    // Images arrive one file at a time — wait for the whole set, not just one.
    if (stage === 'images') {
      const have = getProject(rec.slug)?.artifacts.images ?? 0
      return have >= expectedImages(rec.slug)
    }
    return true
  }
  const deadline = Date.now() + 180_000
  let waited = false
  while (!visible()) {
    if (rec.canceled) return
    if (Date.now() > deadline) {
      rec.emit({
        type: 'log',
        runId: rec.runId,
        stage,
        stream: 'stderr',
        line: `warning: ${stage} finished but its files are still not visible on disk after 3 minutes — continuing anyway.`
      })
      return
    }
    if (!waited) {
      waited = true
      rec.emit({
        type: 'log',
        runId: rec.runId,
        stage,
        stream: 'stdout',
        line: 'Waiting for the written files to appear on disk (slow volume)…'
      })
    }
    await sleep(2000)
  }
}

async function execFrom(rec: RunRecord): Promise<void> {
  const env = childEnv()
  for (; rec.index < rec.stages.length; rec.index++) {
    if (rec.canceled) {
      rec.emit({ type: 'canceled', runId: rec.runId })
      RUNS.delete(rec.runId)
      return
    }
    const stage = rec.stages[rec.index]
    rec.emit({ type: 'stage-started', runId: rec.runId, stage })
    let plan
    try {
      plan = buildStage(rec, stage)
    } catch (e: any) {
      rec.emit({ type: 'error', runId: rec.runId, stage, message: e.message })
      RUNS.delete(rec.runId)
      return
    }

    const isLlm = STAGES.find((s) => s.id === stage)?.kind === 'llm'
    const managed = runManaged(plan.cmd, plan.args, {
      cwd: plan.cwd,
      env,
      onLine: (stream, line) => {
        if (isLlm && stream === 'stdout') {
          const pretty = formatClaudeEvent(line)
          if (pretty) {
            for (const l of pretty) rec.emit({ type: 'log', runId: rec.runId, stage, stream, line: l })
            return
          }
        }
        rec.emit({ type: 'log', runId: rec.runId, stage, stream, line })
      }
    })
    rec.managed = managed
    let result
    try {
      result = await managed.done
    } catch (e: any) {
      if (rec.canceled) {
        rec.emit({ type: 'canceled', runId: rec.runId })
      } else {
        rec.emit({ type: 'error', runId: rec.runId, stage, message: e.message })
      }
      RUNS.delete(rec.runId)
      return
    }
    rec.managed = null
    if (rec.canceled) {
      rec.emit({ type: 'canceled', runId: rec.runId })
      RUNS.delete(rec.runId)
      return
    }
    if (!result.ok) {
      rec.emit({
        type: 'error',
        runId: rec.runId,
        stage,
        message: `${stage} failed (exit ${result.code}). ${result.stderr.split('\n').slice(-3).join(' ').trim()}`
      })
      RUNS.delete(rec.runId)
      return
    }
    await waitForArtifact(rec, stage)
    if (rec.canceled) {
      rec.emit({ type: 'canceled', runId: rec.runId })
      RUNS.delete(rec.runId)
      return
    }
    rec.emit({ type: 'stage-done', runId: rec.runId, stage })

    // Pause for human approval right after the script is written.
    if (stage === 'research' && rec.pauseAfterScript) {
      rec.index++ // resume should continue at the next stage
      rec.emit({
        type: 'paused',
        runId: rec.runId,
        stage,
        reason: 'Script ready — review/edit it, then continue to spend credits.'
      })
      return
    }

    // Manual timings: pause after narration so the user can supply an SRT
    // (paste it or import one from another tool) before image prompts.
    if (stage === 'narrate' && rec.req.transcription === 'manual') {
      const srt = path.join(ensureVideosDir(), rec.slug, `${rec.slug}.srt`)
      if (!existsSync(srt)) {
        rec.index++
        rec.emit({
          type: 'paused',
          runId: rec.runId,
          stage,
          reason: 'Narration done — paste or import an SRT for this project, then continue.'
        })
        return
      }
    }
  }
  rec.emit({ type: 'run-done', runId: rec.runId, slug: rec.slug })
  RUNS.delete(rec.runId)
}

function makeRunId(slug: string): string {
  return `run_${slug}_${RUNS.size}_${process.hrtime.bigint().toString(36)}`
}

export function startRun(req: NewVideoRequest, emit: (e: RunEvent) => void): string {
  const slug = (req.slug || req.topic).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  const finalReq: NewVideoRequest = { ...req, slug }
  const stages = planStages(finalReq)
  const runId = makeRunId(slug)
  const rec: RunRecord = {
    runId,
    slug,
    stages,
    index: 0,
    pauseAfterScript: req.pauseAfterScript,
    req: finalReq,
    managed: null,
    canceled: false,
    emit
  }
  RUNS.set(runId, rec)
  emit({ type: 'run-started', runId, slug, stages })
  void execFrom(rec)
  return runId
}

export function resumeRun(runId: string): boolean {
  const rec = RUNS.get(runId)
  if (!rec) return false
  void execFrom(rec)
  return true
}

export function hasActiveRun(slug: string): boolean {
  for (const rec of RUNS.values()) if (rec.slug === slug && !rec.canceled) return true
  return false
}

/** Cancel every run for a slug (e.g. before deleting the project). */
export function cancelRunsForSlug(slug: string): void {
  for (const [runId, rec] of RUNS) {
    if (rec.slug !== slug || rec.canceled) continue
    rec.canceled = true
    if (rec.managed) {
      // A stage is executing: kill it and let execFrom emit canceled + clean up.
      rec.managed.cancel()
    } else {
      // Paused (waiting for resume): nothing is running, clean up here.
      rec.emit({ type: 'canceled', runId })
      RUNS.delete(runId)
    }
  }
}

export function cancelRun(runId: string): boolean {
  const rec = RUNS.get(runId)
  if (!rec) return false
  rec.canceled = true
  rec.managed?.cancel()
  return true
}
