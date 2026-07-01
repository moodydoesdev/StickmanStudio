import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AppConfig } from '../../shared/types'
import { configFile, defaultVideosDir, legacyVideosDir } from './paths'

function defaults(): AppConfig {
  return {
    videosDir: defaultVideosDir(),
    claudeAuth: 'none',
    defaults: { length: 'standard', vertical: false, captions: false, transcription: 'auto' },
    useGpu: false,
    setupComplete: false
  }
}

let cache: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (cache) return cache
  const file = configFile()
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      cache = { ...defaults(), ...parsed, defaults: { ...defaults().defaults, ...parsed.defaults } }
      return cache!
    } catch {
      // fall through to defaults on a corrupt file
    }
  }
  cache = defaults()
  return cache
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const next: AppConfig = { ...loadConfig(), ...patch }
  cache = next
  const file = configFile()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function ensureVideosDir(): string {
  const dir = loadConfig().videosDir
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * One-time migration for the "YouTube Explainer Studio" → "Stickman Studio"
 * rename. If the user is still on the old default videos folder, move it to the
 * new default and re-point the config. Safe + idempotent: runs once, never
 * clobbers an existing target, and leaves custom locations untouched.
 */
export function runNameMigration(): { moved?: boolean; from?: string; to?: string } {
  const cfg = loadConfig()
  if (cfg.migratedStudioName) return {}
  const oldDir = legacyVideosDir()
  const newDir = defaultVideosDir()
  try {
    // Only act when they're on the old *default* location (not a custom folder).
    if (cfg.videosDir === oldDir) {
      if (existsSync(oldDir) && !existsSync(newDir)) {
        mkdirSync(path.dirname(newDir), { recursive: true })
        renameSync(oldDir, newDir) // same drive (both under Documents) → fast move
        try {
          rmdirSync(path.dirname(oldDir)) // remove the now-empty legacy parent, if empty
        } catch {
          /* not empty — leave it */
        }
        saveConfig({ videosDir: newDir, migratedStudioName: true })
        return { moved: true, from: oldDir, to: newDir }
      }
      // Nothing to move (no old folder), or a new folder already exists.
      if (!existsSync(oldDir)) saveConfig({ videosDir: newDir, migratedStudioName: true })
      else saveConfig({ migratedStudioName: true }) // both exist → keep their old data in place
      return {}
    }
    saveConfig({ migratedStudioName: true })
    return {}
  } catch {
    // Never loop forever on a failed migration.
    saveConfig({ migratedStudioName: true })
    return {}
  }
}

/**
 * The environment handed to every child process (skill scripts and `claude`).
 * API keys live only here at runtime — they are written to the app's private
 * config, never into the skill files themselves.
 */
export function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const cfg = loadConfig()
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (cfg.openaiApiKey) env.OPENAI_API_KEY = cfg.openaiApiKey
  if (cfg.elevenlabsApiKey) env.ELEVENLABS_API_KEY = cfg.elevenlabsApiKey
  if (cfg.voiceId) env.ELEVENLABS_VOICE_ID = cfg.voiceId
  // Only inject an Anthropic key when the user explicitly chose API-key auth;
  // in `login` mode Claude Code uses its own stored OAuth credentials.
  if (cfg.claudeAuth === 'apikey' && cfg.anthropicApiKey) {
    env.ANTHROPIC_API_KEY = cfg.anthropicApiKey
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  return env
}
