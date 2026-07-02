import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { isWindows } from './paths'

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  ok: boolean
}

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Called for every complete line written to stdout/stderr. */
  onLine?: (stream: 'stdout' | 'stderr', line: string) => void
  /** Reject (throw) instead of resolving on a non-zero exit. */
  rejectOnError?: boolean
  /** Hard timeout in ms. */
  timeoutMs?: number
}

/**
 * PATH lookup that respects Windows PATHEXT (so `npm` resolves to `npm.cmd`,
 * `claude` to `claude.cmd`, etc.). Returns the absolute path or null.
 */
export function which(cmd: string): string | null {
  // An explicit path was given.
  if (cmd.includes(path.sep) || cmd.includes('/')) {
    return existsSync(cmd) ? cmd : null
  }
  const PATH = process.env.PATH || process.env.Path || ''
  const dirs = PATH.split(path.delimiter).filter(Boolean)
  const exts = isWindows
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + (cmd.toLowerCase().endsWith(ext.toLowerCase()) ? '' : ext))
      if (existsSync(candidate)) return candidate
    }
    // Unix: also try the bare name (no ext).
    if (!isWindows && existsSync(path.join(dir, cmd))) return path.join(dir, cmd)
  }
  return null
}

function lineSplitter(onLine: (line: string) => void) {
  let buf = ''
  return {
    push(chunk: string) {
      buf += chunk
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        onLine(line)
      }
    },
    flush() {
      if (buf.length) {
        onLine(buf.replace(/\r$/, ''))
        buf = ''
      }
    }
  }
}

export interface ManagedRun {
  child: ChildProcess
  done: Promise<RunResult>
  cancel(): void
}

/** Spawn a process, streaming output line-by-line, with cancellation support. */
export function runManaged(cmd: string, args: string[], opts: RunOptions = {}): ManagedRun {
  const resolved = which(cmd) || cmd
  // On Windows, .cmd/.bat shims can't be exec'd directly. Run them through
  // cmd.exe as an argument (shell:false) so Node still quotes paths with spaces.
  const isBatch = isWindows && /\.(cmd|bat)$/i.test(resolved)
  const file = isBatch ? process.env.ComSpec || 'cmd.exe' : resolved
  const spawnArgs = isBatch ? ['/d', '/s', '/c', resolved, ...args] : args
  const child = spawn(file, spawnArgs, {
    cwd: opts.cwd,
    env: opts.env || process.env,
    windowsHide: true,
    shell: false,
    // stdin 'ignore': nothing is ever piped to children, and an open stdin
    // pipe makes the Claude CLI wait 3s for input on every LLM stage.
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stdout = ''
  let stderr = ''
  const out = lineSplitter((l) => opts.onLine?.('stdout', l))
  const err = lineSplitter((l) => opts.onLine?.('stderr', l))

  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (d: string) => {
    stdout += d
    out.push(d)
  })
  child.stderr?.on('data', (d: string) => {
    stderr += d
    err.push(d)
  })

  let timer: NodeJS.Timeout | undefined
  const done = new Promise<RunResult>((resolve, reject) => {
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        child.kill()
        reject(new Error(`Timed out after ${opts.timeoutMs}ms: ${cmd}`))
      }, opts.timeoutMs)
    }
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      out.flush()
      err.flush()
      const result: RunResult = { code, stdout, stderr, ok: code === 0 }
      if (opts.rejectOnError && code !== 0) {
        reject(new Error(`Exit ${code}: ${cmd} ${args.join(' ')}\n${stderr || stdout}`))
      } else {
        resolve(result)
      }
    })
  })

  return {
    child,
    done,
    cancel() {
      try {
        if (isWindows && child.pid) {
          // Kill the whole tree so background ffmpeg/openai children die too.
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        } else {
          child.kill('SIGTERM')
        }
      } catch {
        /* already gone */
      }
    }
  }
}

/** Convenience: run to completion and return the buffered result. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return runManaged(cmd, args, opts).done
}
