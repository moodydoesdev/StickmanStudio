import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { childEnv, ensureVideosDir } from './config'
import { bundledSkillsDir, skillScript } from './paths'
import { projectDir } from './projects'
import { run, runManaged, which } from './runner'

export interface TimelineClip {
  file: string
  start: number
  dur?: number
}
export interface TimelineData {
  audio: string
  audioDur: number
  clips: TimelineClip[]
}

// The timeline uses the app's bundled render.mjs (which supports --emit-times /
// --times), not the installed skill copy, so the feature works regardless of the
// version the user installed.
const renderScript = () => skillScript(bundledSkillsDir(), 'render', 'render.mjs')
const node = () => which('node') || 'node'
const timelineFile = (slug: string) => path.join(projectDir(slug), `${slug}.timeline.json`)

/** Current timings: the saved timeline if any, else the ones render would compute. */
export async function getTimeline(slug: string): Promise<{ ok: boolean; data?: TimelineData; error?: string }> {
  try {
    const saved = timelineFile(slug)
    if (existsSync(saved)) return { ok: true, data: JSON.parse(readFileSync(saved, 'utf8')) as TimelineData }

    const tmp = path.join(os.tmpdir(), `stickman-${slug}-times-${process.hrtime.bigint().toString(36)}.json`)
    const r = await run(node(), [renderScript(), '--project', slug, '--emit-times', tmp], {
      cwd: ensureVideosDir(),
      env: childEnv()
    })
    if (!existsSync(tmp)) return { ok: false, error: `Could not compute timings. ${r.stderr.split('\n').slice(-3).join(' ')}` }
    const data = JSON.parse(readFileSync(tmp, 'utf8')) as TimelineData
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    return { ok: true, data }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export function saveTimeline(slug: string, data: TimelineData): boolean {
  writeFileSync(timelineFile(slug), JSON.stringify(data, null, 2), 'utf8')
  return true
}

/** Forget manual timings and recompute the auto ones. */
export async function resetTimeline(slug: string): Promise<{ ok: boolean; data?: TimelineData; error?: string }> {
  try {
    if (existsSync(timelineFile(slug))) unlinkSync(timelineFile(slug))
  } catch {
    /* ignore */
  }
  return getTimeline(slug)
}

async function probeSize(file: string): Promise<string | null> {
  if (!existsSync(file)) return null
  const r = await run(
    which('ffprobe') || 'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file],
    { env: childEnv() }
  )
  const m = r.stdout.trim().match(/(\d+)x(\d+)/)
  return m ? `${m[1]}x${m[2]}` : null
}

export interface RenderTimelineOpts {
  data: TimelineData
  crossfade?: boolean
  captions?: boolean
}

/** Re-render the video from an explicit timeline, matching the original size. */
export async function renderTimeline(
  slug: string,
  opts: RenderTimelineOpts,
  onLine: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const dir = projectDir(slug)
  saveTimeline(slug, opts.data)

  // Keep the original canvas orientation (portrait vs landscape).
  let size = await probeSize(path.join(dir, `${slug}.mp4`))
  if (!size && opts.data.clips[0]) size = await probeSize(path.join(dir, opts.data.clips[0].file))

  const args = [renderScript(), '--project', slug, '--times', timelineFile(slug), '--no-align']
  if (size) args.push('--size', size)
  if (opts.crossfade) args.push('--crossfade', '0.4')
  if (opts.captions && existsSync(path.join(dir, `${slug}.srt`))) args.push('--captions', `${slug}/${slug}.srt`)

  const managed = runManaged(node(), args, {
    cwd: ensureVideosDir(),
    env: childEnv(),
    onLine: (_s, l) => onLine(l)
  })
  const res = await managed.done
  return { ok: res.ok, error: res.ok ? undefined : res.stderr.split('\n').slice(-4).join(' ').trim() }
}
