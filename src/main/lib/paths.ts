import { app } from 'electron'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Home directory of the current user. */
export function homeDir(): string {
  return os.homedir()
}

/** Where Claude Code keeps installed skills: ~/.claude/skills */
export function claudeSkillsDir(): string {
  return path.join(homeDir(), '.claude', 'skills')
}

/**
 * The skills we ship inside the app. In a packaged build they live next to the
 * app under resources/skills; in `electron-vite dev` they live in the repo.
 */
export function bundledSkillsDir(): string {
  const packaged = path.join(process.resourcesPath || '', 'skills')
  if (existsSync(packaged)) return packaged
  // dev: <repo>/resources/skills (cwd is the project root under electron-vite)
  return path.join(app.getAppPath(), 'resources', 'skills')
}

/** App-private config + logs live under Electron's userData dir. */
export function configFile(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

export function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

/** Default place for the user's video project folders. */
export function defaultVideosDir(): string {
  return path.join(app.getPath('documents'), 'Stickman Studio', 'videos')
}

/** Pre-rename default location, for the one-time migration. */
export function legacyVideosDir(): string {
  return path.join(app.getPath('documents'), 'YouTube Explainer Studio', 'videos')
}

/** Per-skill helper-script paths, resolved against the *installed* skills dir. */
export function skillScript(skillsRoot: string, skill: string, rel: string): string {
  return path.join(skillsRoot, skill, 'scripts', rel)
}

export const isWindows = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
