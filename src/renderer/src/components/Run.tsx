import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, Circle, CircleNotch, XCircle } from '@phosphor-icons/react'
import type { NewVideoRequest, RunEvent, StageId, StageInfo } from '../../../shared/types'

type StageStatus = 'pending' | 'running' | 'done' | 'error'
export type RunStatus = 'idle' | 'running' | 'paused' | 'done' | 'error' | 'canceled'

interface LogLine {
  stage: StageId
  stream: 'stdout' | 'stderr'
  line: string
}

export interface RunController {
  runId: string | null
  status: RunStatus
  stages: StageId[]
  stageStatus: Record<string, StageStatus>
  current?: StageId
  error?: string
  pausedStage?: StageId
  pausedReason?: string
  logs: LogLine[]
  start: (req: NewVideoRequest) => Promise<void>
  resume: () => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
}

export function useRun(onFinished?: () => void): RunController {
  const [runId, setRunId] = useState<string | null>(null)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [stages, setStages] = useState<StageId[]>([])
  const [stageStatus, setStageStatus] = useState<Record<string, StageStatus>>({})
  const [current, setCurrent] = useState<StageId | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [pausedStage, setPausedStage] = useState<StageId | undefined>()
  const [pausedReason, setPausedReason] = useState<string | undefined>()
  const [logs, setLogs] = useState<LogLine[]>([])
  const runIdRef = useRef<string | null>(null)

  useEffect(() => {
    return window.api.onRunEvent((e: RunEvent) => {
      // Bind to the run we started; ignore unrelated broadcasts.
      if (e.type === 'run-started') {
        runIdRef.current = e.runId
        setRunId(e.runId)
        setStages(e.stages)
        setStageStatus(Object.fromEntries(e.stages.map((s) => [s, 'pending'])))
        setStatus('running')
        return
      }
      if (e.runId !== runIdRef.current) return
      switch (e.type) {
        case 'stage-started':
          setCurrent(e.stage)
          setStageStatus((s) => ({ ...s, [e.stage]: 'running' }))
          break
        case 'log':
          setLogs((l) => [...l.slice(-800), { stage: e.stage, stream: e.stream, line: e.line }])
          break
        case 'stage-done':
          setStageStatus((s) => ({ ...s, [e.stage]: 'done' }))
          break
        case 'paused':
          setStatus('paused')
          setPausedStage(e.stage)
          setPausedReason(e.reason)
          setCurrent(undefined)
          break
        case 'run-done':
          setStatus('done')
          setCurrent(undefined)
          onFinished?.()
          break
        case 'error':
          setStatus('error')
          setError(e.message)
          if (e.stage) setStageStatus((s) => ({ ...s, [e.stage!]: 'error' }))
          setCurrent(undefined)
          break
        case 'canceled':
          setStatus('canceled')
          setCurrent(undefined)
          break
      }
    })
  }, [onFinished])

  const start = useCallback(async (req: NewVideoRequest) => {
    setLogs([])
    setError(undefined)
    setPausedStage(undefined)
    setStatus('running')
    await window.api.startRun(req)
  }, [])

  const resume = useCallback(async () => {
    if (!runIdRef.current) return
    setStatus('running')
    setPausedStage(undefined)
    await window.api.resumeRun(runIdRef.current)
  }, [])

  const cancel = useCallback(async () => {
    if (!runIdRef.current) return
    await window.api.cancelRun(runIdRef.current)
  }, [])

  const reset = useCallback(() => {
    runIdRef.current = null
    setRunId(null)
    setStatus('idle')
    setStages([])
    setStageStatus({})
    setCurrent(undefined)
    setError(undefined)
    setPausedStage(undefined)
    setLogs([])
  }, [])

  return { runId, status, stages, stageStatus, current, error, pausedStage, pausedReason, logs, start, resume, cancel, reset }
}

export function StageTracker({
  ctl,
  meta
}: {
  ctl: RunController
  meta: StageInfo[]
}): JSX.Element {
  const byId = useMemo(() => Object.fromEntries(meta.map((m) => [m.id, m])), [meta])
  return (
    <div className="panel stages">
      {ctl.stages.map((s) => {
        const st = ctl.stageStatus[s] || 'pending'
        const m = byId[s]
        const ic =
          st === 'done' ? (
            <CheckCircle size={18} weight="fill" color="var(--ok)" />
          ) : st === 'running' ? (
            <CircleNotch size={18} className="spin" color="var(--accent-2)" />
          ) : st === 'error' ? (
            <XCircle size={18} weight="fill" color="var(--err)" />
          ) : (
            <Circle size={18} color="var(--muted)" />
          )
        return (
          <div key={s} className={`stage ${st}`}>
            <span className="ic">{ic}</span>
            <span className="label">{m?.label || s}</span>
            {m?.paid && <span className="tag">spends credits</span>}
            {m?.kind === 'llm' && <span className="tag">claude</span>}
          </div>
        )
      })}
    </div>
  )
}

export function RunConsole({ ctl }: { ctl: RunController }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight)
  }, [ctl.logs])
  return (
    <div className="console" ref={ref}>
      {ctl.logs.length === 0 && <div className="sys">Waiting for output…</div>}
      {ctl.logs.map((l, i) => (
        <div key={i} className={l.stream === 'stderr' ? 'err' : ''}>
          {l.line}
        </div>
      ))}
    </div>
  )
}
