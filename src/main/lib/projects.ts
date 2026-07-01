import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { VideoArtifacts, VideoProject } from '../../shared/types'
import { ensureVideosDir, loadConfig } from './config'

const TS_IMAGE = /^\d{2}_\d{2}.*\.png$/i // 00_06.png, 01_12.png …
const isImage = (f: string) => /\.(png|jpg|jpeg|webp)$/i.test(f)

export function projectDir(slug: string): string {
  return path.join(loadConfig().videosDir, slug)
}

function firstLine(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8').split('\n')[0]?.trim() || undefined
  } catch {
    return undefined
  }
}

function scanArtifacts(dir: string, slug: string): { artifacts: VideoArtifacts; poster?: string; videoFile?: string } {
  const has = (name: string) => existsSync(path.join(dir, name))
  const files = readdirSync(dir)
  const beatImages = files.filter((f) => TS_IMAGE.test(f) && !f.includes('.thumb-')).sort()
  const thumbs = files.filter((f) => f.includes('.thumb-') && isImage(f))
  const videoFile = has(`${slug}.mp4`) ? `${slug}.mp4` : files.find((f) => f.toLowerCase().endsWith('.mp4'))

  const artifacts: VideoArtifacts = {
    script: has(`${slug}.script.txt`),
    title: has(`${slug}.title.txt`),
    audio: has(`${slug}.mp3`),
    srt: has(`${slug}.srt`),
    prompts: has(`${slug}.prompts.txt`),
    images: beatImages.length,
    video: !!videoFile,
    description: has(`${slug}.description.txt`),
    thumbnails: thumbs.length
  }
  const poster = beatImages[0] || thumbs[0]
  return { artifacts, poster, videoFile }
}

export function scanProjects(): VideoProject[] {
  const root = ensureVideosDir()
  if (!existsSync(root)) return []
  const out: VideoProject[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const slug = entry.name
    const dir = path.join(root, slug)
    let info
    try {
      info = scanArtifacts(dir, slug)
    } catch {
      continue
    }
    // Only surface folders that look like a video project.
    const a = info.artifacts
    const looksReal = a.script || a.audio || a.images > 0 || a.video || a.srt
    if (!looksReal) continue
    out.push({
      slug,
      dir,
      title: firstLine(path.join(dir, `${slug}.title.txt`)),
      modifiedAt: statSync(dir).mtimeMs,
      artifacts: a,
      poster: info.poster,
      videoFile: info.videoFile
    })
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export function getProject(slug: string): VideoProject | null {
  return scanProjects().find((p) => p.slug === slug) || null
}

export type ArtifactKind = 'script' | 'title' | 'description' | 'prompts' | 'srt'

export function readArtifact(slug: string, kind: ArtifactKind): string | null {
  const file = path.join(projectDir(slug), `${slug}.${kind === 'srt' ? 'srt' : kind + '.txt'}`)
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function listImages(slug: string): string[] {
  const dir = projectDir(slug)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => isImage(f))
    .sort()
}
