import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  DependencyId,
  DoctorReport,
  InstallEvent,
  NewVideoRequest,
  RunEvent,
  StageId,
  StageInfo,
  UpdateStatus,
  VideoProject,
  VoiceFilters,
  VoiceSearchResult
} from '../shared/types'

type ArtifactKind = 'script' | 'title' | 'description' | 'prompts' | 'srt'

const api = {
  // config + app
  platform: process.platform as NodeJS.Platform,
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  saveConfig: (patch: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:save', patch),
  appMeta: (): Promise<{ platform: string; videosDir: string; version: string }> => ipcRenderer.invoke('app:meta'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-folder'),

  // auto-update (GitHub Releases)
  update: {
    status: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onEvent: (cb: (s: UpdateStatus) => void) => {
      const h = (_: unknown, s: UpdateStatus) => cb(s)
      ipcRenderer.on('update:event', h)
      return () => {
        ipcRenderer.removeListener('update:event', h)
      }
    }
  },

  // window controls (custom titlebar)
  win: {
    minimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('win:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('win:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized'),
    onMaximized: (cb: (max: boolean) => void) => {
      const h = (_: unknown, max: boolean) => cb(max)
      ipcRenderer.on('win:maximized', h)
      return () => {
        ipcRenderer.removeListener('win:maximized', h)
      }
    }
  },

  // setup
  doctor: (): Promise<DoctorReport> => ipcRenderer.invoke('doctor:run'),
  installDep: (id: DependencyId): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('install:dep', id),
  installAll: (): Promise<Record<string, { ok: boolean; message: string }>> => ipcRenderer.invoke('install:all'),
  onInstallEvent: (cb: (e: InstallEvent) => void) => {
    const h = (_: unknown, e: InstallEvent) => cb(e)
    ipcRenderer.on('install:event', h)
    return () => {
      ipcRenderer.removeListener('install:event', h)
    }
  },

  // claude auth
  claudeLogin: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('auth:login'),
  claudeVerify: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('auth:verify'),

  // elevenlabs
  listVoices: (): Promise<VoiceSearchResult> => ipcRenderer.invoke('elevenlabs:voices'),
  searchVoices: (filters: VoiceFilters, page: number): Promise<VoiceSearchResult> =>
    ipcRenderer.invoke('elevenlabs:search', filters, page),
  addVoice: (publicOwnerId: string, voiceId: string, name: string): Promise<{ ok: boolean; id?: string; error?: string }> =>
    ipcRenderer.invoke('elevenlabs:add', publicOwnerId, voiceId, name),

  // projects
  listProjects: (): Promise<VideoProject[]> => ipcRenderer.invoke('projects:list'),
  getProject: (slug: string): Promise<VideoProject | null> => ipcRenderer.invoke('projects:get', slug),
  readArtifact: (slug: string, kind: ArtifactKind): Promise<string | null> =>
    ipcRenderer.invoke('project:artifact', slug, kind),
  listImages: (slug: string): Promise<string[]> => ipcRenderer.invoke('project:images', slug),
  saveScript: (slug: string, text: string): Promise<boolean> => ipcRenderer.invoke('project:save-script', slug, text),
  saveSrt: (slug: string, text: string): Promise<boolean> => ipcRenderer.invoke('project:save-srt', slug, text),
  importSrt: (slug: string): Promise<boolean> => ipcRenderer.invoke('project:import-srt', slug),
  openFolder: (slug: string): Promise<string> => ipcRenderer.invoke('project:open-folder', slug),
  reveal: (slug: string, file: string): Promise<void> => ipcRenderer.invoke('project:reveal', slug, file),

  // timeline editor
  getTimeline: (slug: string): Promise<{ ok: boolean; data?: any; error?: string }> =>
    ipcRenderer.invoke('timeline:get', slug),
  saveTimeline: (slug: string, data: any): Promise<boolean> => ipcRenderer.invoke('timeline:save', slug, data),
  resetTimeline: (slug: string): Promise<{ ok: boolean; data?: any; error?: string }> =>
    ipcRenderer.invoke('timeline:reset', slug),
  renderTimeline: (slug: string, opts: any): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('timeline:render', slug, opts),
  onTimelineLog: (cb: (line: string) => void) => {
    const h = (_: unknown, line: string) => cb(line)
    ipcRenderer.on('timeline:log', h)
    return () => {
      ipcRenderer.removeListener('timeline:log', h)
    }
  },

  // pipeline
  stages: (): Promise<StageInfo[]> => ipcRenderer.invoke('pipeline:stages'),
  planStages: (req: NewVideoRequest): Promise<StageId[]> => ipcRenderer.invoke('pipeline:plan', req),
  startRun: (req: NewVideoRequest): Promise<string> => ipcRenderer.invoke('pipeline:start', req),
  resumeRun: (runId: string): Promise<boolean> => ipcRenderer.invoke('pipeline:resume', runId),
  cancelRun: (runId: string): Promise<boolean> => ipcRenderer.invoke('pipeline:cancel', runId),
  onRunEvent: (cb: (e: RunEvent) => void) => {
    const h = (_: unknown, e: RunEvent) => cb(e)
    ipcRenderer.on('run:event', h)
    return () => {
      ipcRenderer.removeListener('run:event', h)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type StudioApi = typeof api
