// Shared IPC contract — imported by the main process, the preload bridge and the
// React renderer so the three stay in lock-step.

export type DependencyId =
  | 'node'
  | 'npm'
  | 'claude'
  | 'python'
  | 'ffmpeg'
  | 'ffprobe'
  | 'openai'
  | 'elevenlabs'
  | 'whisper-venv'
  | 'skills'

export interface DependencyStatus {
  id: DependencyId
  name: string
  /** Whether the dependency was detected on this machine. */
  present: boolean
  version?: string
  /** Human-readable note (path found, why it failed, etc.). */
  detail?: string
  /** Can the app install this itself (vs. only linking the user out)? */
  installable: boolean
  /** Fallback page if automatic install fails / isn't possible. */
  manualUrl?: string
  /** A required dep blocks the pipeline; optional ones (e.g. GPU) don't. */
  required: boolean
}

export interface DoctorReport {
  deps: DependencyStatus[]
  allRequiredReady: boolean
  generatedAt: number
}

export interface ElevenVoice {
  id: string
  name: string
  category?: string
  description?: string
  /** URL to a short sample mp3 for in-app preview. */
  previewUrl?: string
  gender?: string
  age?: string
  accent?: string
  language?: string
  useCase?: string
  /** Present for public Voice Library results — needed to add to your library. */
  publicOwnerId?: string
  /** True for a public library voice (vs. one already in your account). */
  shared?: boolean
}

/** Filters for searching the public ElevenLabs Voice Library. */
export interface VoiceFilters {
  search?: string
  language?: string
  gender?: string
  age?: string
  accent?: string
  category?: string
  useCase?: string
}

export interface VoiceSearchResult {
  ok: boolean
  voices?: ElevenVoice[]
  hasMore?: boolean
  error?: string
}

export type ClaudeAuthMode = 'login' | 'apikey' | 'none'

/** How a project gets its per-beat timings (SRT). */
export type TranscriptionMode = 'auto' | 'manual'

export interface VideoDefaults {
  length: 'short' | 'standard' | 'long'
  vertical: boolean
  captions: boolean
  /** 'auto' = transcribe the narration; 'manual' = user pastes/imports an SRT. */
  transcription: TranscriptionMode
}

export interface AppConfig {
  /** Folder that holds one flat sub-folder per video. */
  videosDir: string
  claudeAuth: ClaudeAuthMode
  anthropicApiKey?: string
  openaiApiKey?: string
  elevenlabsApiKey?: string
  /** ElevenLabs narrator voice id. */
  voiceId?: string
  /** Friendly name of the selected voice (shown in the UI instead of the id). */
  voiceName?: string
  defaults: VideoDefaults
  /** Model for the Claude stages — an alias (sonnet/opus/haiku) or a full
   *  model id. Empty/unset = let the Claude CLI pick its default. */
  claudeModel?: string
  /** Use the NVIDIA GPU for transcription (faster). Off = CPU, works anywhere. */
  useGpu: boolean
  /** Set true once the first-run wizard has been completed. */
  setupComplete: boolean
  /** Set once the one-time "YouTube Explainer Studio" → "Stickman Studio" folder migration has run. */
  migratedStudioName?: boolean
  /** Optional explicit binary overrides if auto-detection picked the wrong one. */
  bin?: Partial<Record<'node' | 'npm' | 'python' | 'claude' | 'ffmpeg' | 'ffprobe', string>>
}

export type StageId =
  | 'research'
  | 'narrate'
  | 'transcribe'
  | 'image-prompts'
  | 'images'
  | 'render'
  | 'description'
  | 'thumbnail'

export interface StageInfo {
  id: StageId
  label: string
  /** 'llm' stages run through `claude -p`; 'script' stages spawn a helper. */
  kind: 'llm' | 'script'
  /** Whether this stage spends API credits. */
  paid: boolean
}

/** Which artifacts a project folder currently contains (drives the UI badges). */
export interface VideoArtifacts {
  script: boolean
  title: boolean
  audio: boolean
  srt: boolean
  prompts: boolean
  images: number
  video: boolean
  description: boolean
  thumbnails: number
}

export interface VideoProject {
  slug: string
  dir: string
  title?: string
  topic?: string
  modifiedAt: number
  artifacts: VideoArtifacts
  /** Relative path (within dir) to a poster image for the library grid. */
  poster?: string
  /** Relative path to the final mp4, if present. */
  videoFile?: string
  durationSec?: number
}

export interface NewVideoRequest {
  topic: string
  slug?: string
  title?: string
  length: VideoDefaults['length']
  vertical: boolean
  captions: boolean
  /** 'auto' transcribes; 'manual' skips transcription and waits for a user SRT. */
  transcription: TranscriptionMode
  /** Stop after the script for human approval before spending credits. */
  pauseAfterScript: boolean
  /** Start fresh from a stage, or resume an existing slug. */
  startStage?: StageId
}

/** A run = one execution of the pipeline (or a single stage) for a slug. */
export interface RunState {
  runId: string
  slug: string
  startStage: StageId
  stages: StageId[]
  currentStage?: StageId
  status: 'running' | 'paused' | 'done' | 'error' | 'canceled'
  pausedReason?: string
  error?: string
}

export type RunEvent =
  | { type: 'run-started'; runId: string; slug: string; stages: StageId[] }
  | { type: 'stage-started'; runId: string; stage: StageId }
  | { type: 'log'; runId: string; stage: StageId; stream: 'stdout' | 'stderr'; line: string }
  | { type: 'stage-done'; runId: string; stage: StageId }
  | { type: 'paused'; runId: string; stage: StageId; reason: string }
  | { type: 'run-done'; runId: string; slug: string }
  | { type: 'error'; runId: string; stage?: StageId; message: string }
  | { type: 'canceled'; runId: string }

/** Progress event emitted while the wizard installs a dependency. */
export type InstallEvent =
  | { type: 'install-log'; id: DependencyId; line: string }
  | { type: 'install-done'; id: DependencyId; ok: boolean; message?: string }

/**
 * Auto-update lifecycle, mirrored from electron-updater's events into a single
 * flat status the renderer can render directly. The main process caches the
 * latest one so a freshly-loaded window can catch up via `update:status`.
 */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available'; version: string }
  | {
      state: 'downloading'
      version: string
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
