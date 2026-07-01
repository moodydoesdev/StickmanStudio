---
name: transcribe
description: "Transcribe an audio or video file into SRT subtitles using faster-whisper (large-v3). Runs on CPU by default (works everywhere); can use an NVIDIA GPU for ~10-20x speed. Outputs standard SRT (HH:MM:SS,mmm --> ...), and optionally a plain-text transcript and a `MM:SS | text` prompts file that feeds directly into /chatgpt-images. Trigger: /transcribe. Use when the user wants to transcribe/caption audio or video, generate subtitles, or turn narration into timestamps."
trigger: /transcribe
---

# /transcribe

Turn an audio/video file into **SRT subtitles** with `faster-whisper` (CTranslate2).
Defaults to **large-v3** on **CPU** (reliable everywhere); add `--device cuda` to
use an NVIDIA GPU, which is dramatically faster (~8 min of audio in ~1 min).
Optionally emits a `MM:SS | text` file that pipes straight into `/chatgpt-images`.

> Paths below use `~/.claude/skills/...` (where Claude Code keeps skills). On
> Windows that's `C:\Users\<you>\.claude\skills\...`.

## Usage

```
/transcribe <audio-or-video>                       # -> <name>.srt
/transcribe <file> --prompts                       # also write <name>.prompts.txt for /chatgpt-images
/transcribe <file> --txt                           # also write a plain-text transcript
/transcribe <file> --model distil-large-v3         # ~2x faster, near-equal English accuracy
/transcribe <file> --max-chars 42                  # tighter subtitle cues (re-split by words)
/transcribe <file> --language en                   # skip auto-detect
/transcribe <file> --task translate                # translate speech to English
/transcribe <file> --device cuda                   # use the NVIDIA GPU (much faster)
/transcribe <file> --condition-prev                # restore Whisper's prev-text conditioning (default OFF)
/transcribe --project <slug>                        # read <slug>/<slug>.mp3, write <slug>/<slug>.srt
/transcribe <file> --outdir "<dir>"                # choose output folder
```

Output is standard SRT:

```
1
00:00:00,000 --> 00:00:06,340
A stickman stands alone on a plain white background.
```

## Project layout (single flat folder)

With `--project <slug>` it finds the audio in `<slug>/` (e.g. `<slug>.mp3`) and
writes `<slug>/<slug>.srt` (and `.txt` / `.prompts.txt` if asked) into the same
folder — no `audio/` or `transcription/` subfolders.

## First-run setup (one Python venv)

The engine is `faster-whisper` (CTranslate2 under the hood — far lighter on VRAM
than `openai-whisper`). Install it once into a venv next to the script. Python
3.10–3.12 all work; model weights (~3 GB for large-v3) download on first run.

**CPU venv** (`.venv`, the default, works everywhere):
```
python -m venv "~/.claude/skills/transcribe/scripts/.venv"
"~/.claude/skills/transcribe/scripts/.venv/Scripts/python.exe" -m pip install -U pip
"~/.claude/skills/transcribe/scripts/.venv/Scripts/python.exe" -m pip install -r "~/.claude/skills/transcribe/scripts/requirements.txt"
```
(On macOS/Linux the interpreter is `.venv/bin/python` instead of
`.venv/Scripts/python.exe`.)

**Optional GPU venv** (`.venv-gpu`, NVIDIA only — much faster): same steps but
install `requirements-gpu.txt`. See *GPU notes* below for why it's pinned.

## What you must do when invoked

1. **Resolve the input file** from the user's args (or `--project <slug>`). If
   none, ask for the audio/video path. If `--help`/`-h`, print Usage and stop.

2. **Ensure a venv exists** (create it per *First-run setup* if missing). Don't
   use a short timeout on the first transcription — it downloads the model.

3. **Run it** (default CPU; add `--device cuda` if a GPU venv is set up):
   ```
   "~/.claude/skills/transcribe/scripts/.venv/Scripts/python.exe" \
     "~/.claude/skills/transcribe/scripts/transcribe.py" --project "<slug>"
   ```
   Add `--prompts` when chaining into `/chatgpt-images`. CPU is slow (several ×
   real-time) — prefer the background for long files; GPU is fast enough for the
   foreground.

4. **Report** the detected language, the device/compute-type used (printed as
   `using cpu/int8` etc.), the cue count, and the output file paths.

## GPU notes (NVIDIA, optional)

- `--device cuda` with the GPU venv uses `float16` (~5 GB VRAM on large-v3) and is
  the fast path. The runtime CUDA/cuDNN libs come from the `nvidia-*-cu12` pip
  wheels in `requirements*.txt`, so no manual CUDA install is needed; the script
  puts their `bin` dirs on PATH itself.
- **If the GPU loads the model but deadlocks at first inference on Windows**, that
  is the known CTranslate2 4.8 + cuDNN 9 issue. `requirements-gpu.txt` pins the
  working cuDNN-8 era stack (`ctranslate2==4.4.0`, `faster-whisper==1.0.3`,
  `nvidia-cublas-cu12==12.4.5.8`, `nvidia-cudnn-cu12==8.9.7.29`, plus `requests`).
  Install that into `.venv-gpu` and use it for `--device cuda`.
- `--model distil-large-v3` roughly halves time with near-equal English accuracy
  (good on CPU).

## condition_on_previous_text (default OFF)

With it ON, a single looped/hallucinated segment can cascade into pages of garbage
(repeated lines, foreign-script glyphs) on long narration. OFF = each window
decodes independently. Pass `--condition-prev` only if you want Whisper's default
back. Stdout is forced to UTF-8 so a stray glyph can't crash printing on a
cp1252 console.

## Chaining into /chatgpt-images

`--prompts` writes `<name>.prompts.txt` as `MM:SS | <spoken line>` with a leading
`video:` line — the exact input `/chatgpt-images` reads. Usually you'll rewrite
those spoken lines into visual descriptions first, or just use
`/video-image-prompts` to do it automatically.

## Troubleshooting

- **`ffmpeg` not found:** required for video inputs. The script auto-extracts
  audio with ffmpeg if direct decode fails — install ffmpeg and put it on PATH.
- **Looped lines / foreign-script gibberish:** the `condition_on_previous_text`
  cascade. It's OFF by default; don't pass `--condition-prev` on long narration.
- **Subtitles too long per line:** add `--max-chars 42` (re-splits cues using
  word timestamps), optionally with `--max-dur 5`.
