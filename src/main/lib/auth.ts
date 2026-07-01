import { spawn } from 'node:child_process'
import { childEnv, loadConfig } from './config'
import { isMac, isWindows } from './paths'
import { run, which } from './runner'

/**
 * Open a real terminal window running `claude login` so the user can complete
 * the browser OAuth flow. (The login flow is interactive and can't run inside
 * the app's hidden child process.)
 */
export function launchClaudeLogin(): { ok: boolean; message: string } {
  if (!which('claude')) return { ok: false, message: 'Install the Claude Code CLI first.' }
  try {
    if (isWindows) {
      spawn('cmd', ['/c', 'start', '"Claude login"', 'cmd', '/k', 'claude login'], {
        windowsHide: false,
        detached: true,
        shell: true
      }).unref()
    } else if (isMac) {
      spawn('osascript', ['-e', 'tell application "Terminal" to do script "claude login"', '-e', 'tell application "Terminal" to activate'], {
        detached: true
      }).unref()
    } else {
      spawn('x-terminal-emulator', ['-e', 'claude login'], { detached: true }).unref()
    }
    return { ok: true, message: 'A terminal opened — finish signing in there, then come back and click Verify.' }
  } catch (e: any) {
    return { ok: false, message: `Could not open a terminal: ${e.message}` }
  }
}

/** Lightweight round-trip to confirm Claude Code is authenticated + working. */
export async function verifyClaude(): Promise<{ ok: boolean; message: string }> {
  if (!which('claude')) return { ok: false, message: 'Claude Code CLI not found on PATH.' }
  const cfg = loadConfig()
  if (cfg.claudeAuth === 'apikey' && !cfg.anthropicApiKey) {
    return { ok: false, message: 'API-key mode selected but no key saved.' }
  }
  try {
    const r = await run('claude', ['-p', 'Reply with exactly: READY'], {
      env: childEnv(),
      timeoutMs: 90000
    })
    if (r.ok && /READY/i.test(r.stdout)) return { ok: true, message: 'Claude Code is signed in and responding.' }
    if (/auth|login|unauthor|api key/i.test(`${r.stdout}${r.stderr}`)) {
      return { ok: false, message: 'Claude Code is installed but not signed in yet.' }
    }
    return { ok: r.ok, message: r.ok ? 'Claude responded.' : `Claude exited ${r.code}: ${r.stderr.slice(0, 200)}` }
  } catch (e: any) {
    return { ok: false, message: e.message }
  }
}
