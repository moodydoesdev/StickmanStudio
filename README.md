# Stickman Studio

Turn a topic into a **finished, upload-ready stick-figure explainer video** — script,
voiceover, timed images, a rendered MP4, a thumbnail and a YouTube description — from
one desktop app. Stickman Studio is a friendly front-end over a set of
[Claude Code skills](../youtube-explainer-skills): it installs everything for you,
manages all your videos, and drives the whole pipeline with live progress.

You pay the underlying **OpenAI**, **ElevenLabs** and **Claude** rates directly — no
per-video markup, no third-party "AI video" subscription.

> **Windows + macOS** · Electron + React + TypeScript · MIT

---

## What it does

- 🧩 **One-click setup.** A first-run wizard detects what's missing and installs it —
  Node.js, the **Claude Code CLI**, Python + the **faster-whisper** transcription
  engine, **ffmpeg/ffprobe**, and the OpenAI/ElevenLabs CLIs — then copies the video
  skills into `~/.claude/skills`. Everything lands in the app's private data folder,
  so **no admin rights** are needed.
- 🎬 **A library of your videos.** Every video is one flat folder. Browse them as a
  grid, play the finished MP4 in-app, flip through the generated images, and read the
  script/description.
- ✨ **Make a video from a topic.** Type a topic, pick length/aspect, and the pipeline
  runs end-to-end. It **pauses after the script** so you can approve or edit it before
  spending any credits, then continues through narration → images → render →
  description → thumbnail.
- 🔊 **Browse & preview ElevenLabs voices.** Search your own voices *and* the full
  public Voice Library, filter by **language, accent, use case, type, gender and age**,
  **preview** each voice inline, and pick one — it's added to your account and stored by
  name.
- ✍️ **Bring your own timings.** Auto-transcribe the narration (CPU or NVIDIA GPU), or
  **paste / import your own SRT** (e.g. from another tool) if you'd rather.
- 🔁 **Re-run any stage.** Regenerate images, re-render, redo the thumbnail — finished
  stages are detected on disk and skipped.

---

## Install (end users)

1. Download and run **`Stickman Studio-Setup-<version>.exe`** (Windows) or the
   `.dmg` (macOS).
2. Launch it. The **Setup** screen opens automatically. Click **Install everything**
   (or install each item individually), then **sign in to Claude** (Pro/Max) or paste
   an Anthropic API key.
3. Add your **OpenAI API key**, **ElevenLabs API key**, and choose a **narrator voice**
   (browse + preview from the app).
4. When every required item shows a green check, the app unlocks itself — no button to
   press. Head to **New Video**.

> The installer is small (~80 MB) because the heavy dependencies are downloaded by the
> wizard on first run rather than bundled.

### Make your first video

1. **New Video** → enter a topic (e.g. *"the history of the lighthouse"*).
2. Pick **length** (Short / Standard / Long), aspect (16:9 or vertical), captions, and
   whether to auto-transcribe or provide your own SRT.
3. Click **Generate**. Review/edit the script at the pause, then let it run.
4. When it finishes, open the project to watch the MP4 and grab the description +
   thumbnails. Everything lives in `Documents/Stickman Studio/videos/<slug>/`.

### Use the skills in the Claude apps (no desktop app, free plan works)

The three skills that don't need local tools — **research-video**,
**video-image-prompts** and **description** — are also published as ready-to-upload
packages on the rolling
[`skills` release](https://github.com/moodydoesdev/StickmanStudio/releases/tag/skills).
CI rebuilds them (`scripts/package-skills.py` via `release-skills.yml`) whenever
`resources/skills/` changes on `main`.

To install one: download its `.zip`, then in Claude open **Settings → Capabilities →
Skills**, enable **code execution**, and choose **Upload skill**. Attach your
script/transcript files to the chat when using them — the app can't see your local
video folders. The remaining skills (narrate, transcribe, images, render, …) need
local binaries and only work through this app or Claude Code.

---

## What gets installed, and where

Nothing touches system folders or needs admin. Managed runtimes live under the app's
`userData/runtime` and are added to the child-process `PATH`.

| Dependency | How it's installed |
|---|---|
| **Node.js** | Portable build from nodejs.org → `userData/runtime/node` |
| **Claude Code CLI** | `npm install -g @anthropic-ai/claude-code --prefix userData/runtime/npm-global` |
| **ffmpeg + ffprobe** | Win: gyan.dev static zip · macOS: evermeet static binaries → `userData/runtime/ffmpeg` |
| **Python 3.12** | Best-effort via `winget` (Win) / `brew` (macOS); otherwise links to python.org |
| **OpenAI / ElevenLabs CLIs** | A dedicated pip venv at `userData/runtime/py-tools` |
| **faster-whisper** | A venv inside the installed `transcribe` skill (`…/transcribe/scripts/.venv`) |
| **Skills** | Copied from the bundled `resources/skills` → `~/.claude/skills` |

GPU (NVIDIA) transcription is an optional advanced step — the wizard installs the CPU
engine, which works everywhere. Toggle GPU in **Settings** once you've set up the GPU
engine.

### Keys & privacy
API keys are stored only in the app's private `config.json` (Electron `userData`) and
injected into child processes as environment variables at runtime (`OPENAI_API_KEY`,
`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, and `ANTHROPIC_API_KEY` only when API-key
auth is chosen). They are **never** written into the skill files.

---

## The pipeline

```
topic
  │  research + script        (claude -p)           ⏸ pause to approve the script
  ▼
script → narrate (ElevenLabs) → transcribe (whisper, optional) → image prompts (claude -p)
       → images (OpenAI) → render (ffmpeg) → description (claude -p) → thumbnail (claude -p)
  ▼
Documents/Stickman Studio/videos/<slug>/<slug>.mp4  (+ script, srt, images, description, thumbs)
```

- **Deterministic stages** (`narrate`, `transcribe`, `images`, `render`) spawn the
  skill helper scripts directly, so the UI shows live logs and real progress.
- **LLM stages** (`research`, `image-prompts`, `description`, `thumbnail`) run
  `claude -p "<instruction that uses the skill>"` headlessly with the working directory
  set to your videos folder, so Claude writes artifacts straight into `<slug>/`.

---

## Develop

```bash
npm install
npm run dev          # launches the app with HMR (renderer on http://localhost:5280)
npm run typecheck    # tsc for main + renderer
```

> Requires Node 18+ to build. (The packaged app ships its own portable Node for running
> the skills; the build itself uses your system Node.)

### Project layout

```
Electron main (Node)                          Renderer (React + TS)
├─ lib/doctor.ts      detect dependencies       Setup       ← install wizard / doctor
├─ lib/installers.ts  install them (portable)   Library     ← all your videos
├─ lib/runtime.ts     portable Node/ffmpeg/venv NewVideo    ← topic → run the pipeline
├─ lib/auth.ts        claude login / verify     VideoDetail ← player, images, re-run
├─ lib/pipeline.ts    run stages + claude -p    Settings    ← keys, voice, folder, defaults
├─ lib/elevenlabs.ts  voice list/search/add     components/VoicePicker ← browse + preview
├─ lib/projects.ts    scan the videos folder
├─ lib/config.ts      private config + keys + one-time migrations
└─ ipc.ts             typed IPC  ◄─────────────► preload (window.api)
```

## Build installers

```bash
npm run build:win    # → dist/Stickman Studio-Setup-<version>.exe   (NSIS)
npm run build:mac    # → dist/Stickman Studio-<version>-arm64.dmg   (+ x64)  — must run on macOS
npm run build:all    # both  (macOS target requires a Mac)
```

- The Claude Code skills are bundled via `extraResources` (see `electron-builder.yml`)
  so the first-run wizard can copy them to `~/.claude/skills`.
- The Windows icon is a multi-resolution `build/icon.ico` (16→256) so it stays crisp at
  every DPI; the app mascot lives at `src/renderer/src/assets/mascot.svg`.
- **Code signing:** builds are unsigned by default, so Windows SmartScreen warns on
  first run and macOS needs signing + notarization for distribution. Provide
  `CSC_LINK` / `CSC_KEY_PASSWORD` (and an Apple API key for notarization) at build time.

---

## Configuration notes

- **Claude auth** — sign in with a Pro/Max account (no per-token charge for the LLM
  stages) or use an Anthropic API key.
- **Transcription** — Auto (CPU by default, GPU optional) or "I'll provide an SRT".

### `claude -p` headless flags — the one version-sensitive spot
The LLM stages assume `claude -p "<prompt>" --permission-mode bypassPermissions` will
auto-load the relevant skill and write the artifact. The exact flag names for
non-interactive permission bypass have changed across Claude Code releases. If a stage
stalls on a permission prompt, adjust the flags in **`src/main/lib/pipeline.ts`**
(`claudeArgs()` / `buildStage()`) to match your installed version.

---

## Troubleshooting

- **SmartScreen "unknown publisher"** — expected for an unsigned build; click *More
  info → Run anyway*, or sign the build.
- **Explorer still shows a blurry icon after a rebuild** — Windows caches icons. Rename
  the exe or clear the cache (`ie4uinit.exe -show`).
- **"Voice limit reached" when adding a Voice Library voice** — adding a public voice
  consumes a slot in your ElevenLabs account (plan-limited). Remove one in ElevenLabs,
  or pick from **My voices**.
- **A stage fails** — the run stops and reports which stage; finished artifacts are kept
  on disk, so fix the cause and re-run from that stage in **Video detail**.

---

## Credits & license

Built on the [YouTube Explainer skills](../youtube-explainer-skills) video pipeline and
[Claude Code](https://claude.com/claude-code). Icons by
[Phosphor](https://phosphoricons.com/). MIT licensed.
