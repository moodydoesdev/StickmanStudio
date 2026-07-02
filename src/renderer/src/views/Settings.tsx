import { useState } from 'react'
import type { AppConfig, VideoDefaults } from '../../../shared/types'
import { VoiceField } from '../components/VoicePicker'
import { UpdatesPanel } from '../components/UpdatesPanel'

interface Props {
  config: AppConfig
  saveConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
}

export function Settings({ config, saveConfig }: Props): JSX.Element {
  const [videosDir, setVideosDir] = useState(config.videosDir)
  const [openaiKey, setOpenaiKey] = useState(config.openaiApiKey || '')
  const [elevenKey, setElevenKey] = useState(config.elevenlabsApiKey || '')
  const [voiceId, setVoiceId] = useState(config.voiceId || '')
  const [voiceName, setVoiceName] = useState(config.voiceName || '')
  const [anthropicKey, setAnthropicKey] = useState(config.anthropicApiKey || '')
  const [defaults, setDefaults] = useState<VideoDefaults>(config.defaults)
  const [useGpu, setUseGpu] = useState(config.useGpu)
  const [saved, setSaved] = useState(false)
  const knownModels = ['', 'sonnet', 'opus', 'haiku']
  const initialModel = config.claudeModel || ''
  const [modelChoice, setModelChoice] = useState(knownModels.includes(initialModel) ? initialModel : 'custom')
  const [customModel, setCustomModel] = useState(knownModels.includes(initialModel) ? '' : initialModel)

  async function pickFolder(): Promise<void> {
    const dir = await window.api.pickFolder()
    if (dir) setVideosDir(dir)
  }

  async function save(): Promise<void> {
    await saveConfig({
      videosDir,
      openaiApiKey: openaiKey.trim() || undefined,
      elevenlabsApiKey: elevenKey.trim() || undefined,
      voiceId: voiceId.trim() || undefined,
      voiceName: voiceName.trim() || undefined,
      anthropicApiKey: anthropicKey.trim() || undefined,
      defaults,
      claudeModel: (modelChoice === 'custom' ? customModel.trim() : modelChoice) || undefined,
      useGpu
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Keys are stored privately in the app and injected into the tools at runtime only.</div>
        </div>
        <div className="spacer" />
        {saved && <span className="pill ok">Saved</span>}
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>

      <div className="col" style={{ maxWidth: 760, gap: 18 }}>
        <div className="panel col">
          <h3 style={{ margin: 0 }}>Videos folder</h3>
          <div className="row">
            <input type="text" value={videosDir} onChange={(e) => setVideosDir(e.target.value)} />
            <button className="btn" onClick={pickFolder}>
              Browse…
            </button>
          </div>
          <div className="sub">One flat sub-folder is created here per video.</div>
        </div>

        <div className="panel col">
          <h3 style={{ margin: 0 }}>Provider keys</h3>
          <label className="field">
            OpenAI API key
            <input type="password" placeholder="sk-…" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} />
          </label>
          <label className="field">
            ElevenLabs API key
            <input type="password" placeholder="sk_…" value={elevenKey} onChange={(e) => setElevenKey(e.target.value)} />
          </label>
          <VoiceField
            voiceId={voiceId}
            voiceName={voiceName}
            canBrowse={!!elevenKey.trim()}
            beforeBrowse={async () => {
              await saveConfig({ elevenlabsApiKey: elevenKey.trim() || undefined })
            }}
            onChange={(id, name) => {
              setVoiceId(id)
              setVoiceName(name)
            }}
          />
          <label className="field">
            Anthropic API key (only if using API-key auth instead of sign-in)
            <input
              type="password"
              placeholder="sk-ant-…"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
            />
          </label>
        </div>

        <div className="panel col">
          <h3 style={{ margin: 0 }}>Defaults for new videos</h3>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              Length
              <select
                value={defaults.length}
                onChange={(e) => setDefaults({ ...defaults, length: e.target.value as VideoDefaults['length'] })}
              >
                <option value="short">Short (~1 min)</option>
                <option value="standard">Standard (7–10 min)</option>
                <option value="long">Long (12–18 min)</option>
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              Timings (SRT)
              <select
                value={defaults.transcription}
                onChange={(e) =>
                  setDefaults({ ...defaults, transcription: e.target.value as VideoDefaults['transcription'] })
                }
              >
                <option value="auto">Auto-transcribe</option>
                <option value="manual">I’ll provide an SRT</option>
              </select>
            </label>
          </div>
          <div className="row" style={{ gap: 20 }}>
            <label className="check">
              <input
                type="checkbox"
                checked={defaults.vertical}
                onChange={(e) => setDefaults({ ...defaults, vertical: e.target.checked })}
              />{' '}
              Vertical (Shorts)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={defaults.captions}
                onChange={(e) => setDefaults({ ...defaults, captions: e.target.checked })}
              />{' '}
              Burn captions
            </label>
          </div>
        </div>

        <div className="panel col">
          <h3 style={{ margin: 0 }}>Claude model</h3>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              Model for the Claude stages (script, image prompts, description, thumbnail)
              <select value={modelChoice} onChange={(e) => setModelChoice(e.target.value)}>
                <option value="">Default — let Claude Code pick</option>
                <option value="sonnet">Sonnet — fast, great quality</option>
                <option value="opus">Opus — most capable, slower</option>
                <option value="haiku">Haiku — fastest, lightest</option>
                <option value="custom">Custom model id…</option>
              </select>
            </label>
            {modelChoice === 'custom' && (
              <label className="field" style={{ flex: 1 }}>
                Model id
                <input
                  type="text"
                  placeholder="e.g. claude-sonnet-5"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                />
              </label>
            )}
          </div>
          <div className="sub">
            On a Pro/Max sign-in, heavier models use up your plan’s usage faster; with an API key they bill at that
            model’s rates.
          </div>
        </div>

        <div className="panel col">
          <h3 style={{ margin: 0 }}>Transcription engine</h3>
          <label className="check">
            <input type="checkbox" checked={useGpu} onChange={(e) => setUseGpu(e.target.checked)} /> Use NVIDIA GPU
            (faster)
          </label>
          <div className="sub">
            Off = CPU, which works on any machine. Turn this on only if you have an NVIDIA GPU and installed the GPU
            engine; otherwise leave it off.
          </div>
        </div>

        <UpdatesPanel />
      </div>
    </div>
  )
}
