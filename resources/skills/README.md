# YouTube Explainer Skills

A bundle of [Claude Code](https://claude.com/claude-code) skills that turn a single
topic into a **finished, upload-ready explainer video** — script, voiceover, timed
images, a rendered MP4, a thumbnail, and a YouTube description — by talking to the
**OpenAI** and **ElevenLabs** APIs directly through Claude. No third-party
"AI video" subscription, no per-video markup. You pay the underlying API rates and
nothing else.

The default look is the popular **white-faced stick-figure cartoon on white** —
but the style is one editable file, so you can make it your own.

## The pipeline

```
topic
  │  /research-video      research + write a beat-disciplined script
  ▼
script ──► /narrate ──► audio ──► /transcribe ──► timed SRT
                                       │  /video-image-prompts   one image prompt per beat
                                       ▼
                                   prompts ──► /chatgpt-images ──► one image per beat
                                                                       │  /render
                                                                       ▼
                                                                  finished MP4
  /description  → YouTube description + chapters (from the real timings)
  /thumbnail    → clickable thumbnail concepts
```

`/new-video "<topic>"` runs the whole thing end-to-end. Or run any stage on its own.

### One flat folder per video

Every artifact for a video lives in **one folder** named after its slug — no
`script/` / `audio/` / `images/` subfolders to dig through:

```
my-first-explainer/
  my-first-explainer.script.txt      my-first-explainer.title.txt
  my-first-explainer.mp3
  my-first-explainer.srt
  my-first-explainer.prompts.txt
  00_00.png  00_06.png  00_12.png …  _manifest.json
  my-first-explainer.mp4
  my-first-explainer.description.txt
  my-first-explainer.thumb-prompts.txt  my-first-explainer.thumb-01.png …
```

## The skills

| Skill | Trigger | Does |
|-------|---------|------|
| **research-video** | `/research-video` | Researches a topic and writes a script where one sentence = one visual beat |
| **narrate** | `/narrate` | Script → ElevenLabs voiceover MP3 (you pick the voice) |
| **transcribe** | `/transcribe` | Audio → SRT with real per-beat timings (faster-whisper) |
| **video-image-prompts** | `/video-image-prompts` | Transcript → one styled image prompt per beat |
| **chatgpt-images** | `/chatgpt-images` | Prompts → one image per beat (OpenAI `gpt-image-2`) |
| **render** | `/render` | Audio + timed images → one synced MP4 (ffmpeg) |
| **thumbnail** | `/thumbnail` | Clickable thumbnail concepts with baked-in title text |
| **description** | `/description` | Full YouTube description + chapters from the real timings |
| **new-video** | `/new-video` | Orchestrates all of the above into one folder |

## Install

1. Copy each skill folder in here into your Claude Code skills directory:

   ```
   ~/.claude/skills/
   ```
   On Windows that's `C:\Users\<you>\.claude\skills\`. After copying you should
   have `~/.claude/skills/new-video/SKILL.md`, `~/.claude/skills/narrate/…`, etc.

2. Restart Claude Code (or start a new session) so it picks up the skills. The
   triggers (`/new-video`, `/narrate`, …) become available.

## Prerequisites

| Tool | Used by | Install / notes |
|------|---------|-----------------|
| **Node.js** (18+) | narrate, chatgpt-images, render | Scripts use only Node built-ins — no `npm install`. |
| **ffmpeg + ffprobe** | narrate, transcribe, render | Must be on your PATH (`ffmpeg -version`). |
| **OpenAI CLI** + `OPENAI_API_KEY` | chatgpt-images, thumbnail | `pip install openai` (gives the `openai` CLI). Set `OPENAI_API_KEY`. |
| **ElevenLabs** key + a voice ID | narrate | `pip install elevenlabs`, then `elevenlabs auth login` (or set `ELEVENLABS_API_KEY`). No voice is bundled — set `ELEVENLABS_VOICE_ID` or pass `--voice <id>`. |
| **Python 3.10–3.12** venv | transcribe | One-time venv install (see `transcribe/SKILL.md`). CPU works everywhere; an NVIDIA GPU is much faster. |

### API keys (never stored in the skills)

- **OpenAI:** `OPENAI_API_KEY` from the environment (on Windows the image script
  also reads the User-scope env var).
- **ElevenLabs:** `ELEVENLABS_API_KEY` env → `.env` in the current dir →
  `~/.elevenlabs/api_key` (written by `elevenlabs auth login`).

Keys live in your environment only — they are never written into the skill files.

## Quick start

```
# everything at once (pauses once after the script for your approval)
/new-video "the history of the lighthouse" --voice <your-elevenlabs-voice-id>

# or stage by stage
/research-video "the history of the lighthouse" --project lighthouse
/narrate --project lighthouse --voice <id>
/transcribe --project lighthouse
/video-image-prompts --project lighthouse
/chatgpt-images --project lighthouse
/render --project lighthouse
/description --project lighthouse
/thumbnail --project lighthouse
```

## Make the look your own

The visual identity is one file: `video-image-prompts/base-style.md`. It holds a
**STYLE PREFIX** that is prepended verbatim to every image prompt — that single
constant is what keeps a whole video (and every video) consistent. Edit it to
change the look, or run `/video-image-prompts <transcript> --restyle <reference>
--save-style` to capture a new style from an image/video you like.

## Cost (you pay the APIs directly)

- **Images:** one `gpt-image-2` call per beat. A ~7-10 min video is ~60-100 images.
  Check current OpenAI image pricing; the engine prints an estimated cost per run.
- **Narration:** ElevenLabs bills ~1 credit per character; a `--dry-run` prints the
  character count before you spend anything.
- **Transcription, render, description:** local and free (just CPU/GPU time).

## How it hangs together (the one idea that matters)

**Beat discipline:** the script is written so *one sentence = one beat = one image*.
That makes `/transcribe` segment the audio into exactly those beats, and
`/chatgpt-images` produce exactly one image per beat, and `/render` cut on each
beat's real timing. Keep that discipline and the whole pipeline stays in sync.
