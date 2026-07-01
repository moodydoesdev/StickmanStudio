---
name: render
description: "Render a narration audio track + a folder of timestamp-named images into one synced slideshow video with ffmpeg. Each image shows from its timestamp until the next; the last runs to the end of the audio. Optional crossfades, fade in/out, and burned-in captions. Trigger: /render. Use when the user wants to turn audio + timed images (e.g. from /chatgpt-images) into a finished video."
trigger: /render
---

# /render

Combine **audio + timestamped images** into one synced video. Built for the
pipeline: `/transcribe` → `/video-image-prompts` → `/chatgpt-images` → **`/render`**.
Images named by timestamp (`00_00.png`, `00_06.png`, …) are shown each from its
timestamp until the next image's; the last image runs until the audio ends.

> Paths below use `~/.claude/skills/...` (where Claude Code keeps skills). On
> Windows that's `C:\Users\<you>\.claude\skills\...`.

## Usage

```
/render --audio narration.mp3 --images <dir>        # render to <dir-name>.mp4
/render --project <slug>                            # use <slug>/'s images + audio, write <slug>/<slug>.mp4
/render -a voice.mp3 -i ./imgs --crossfade 0.4      # add crossfade transitions
/render -a voice.mp3 -i ./imgs --out final.mp4      # choose output path
/render -a voice.mp3 -i ./imgs --size 1080x1920     # vertical / Shorts
/render -a voice.mp3 -i ./imgs --captions subs.srt  # burn in subtitles
/render -i ./imgs --dry-run                          # show timings + ffmpeg cmd, don't render
```

Options: `--size` (default `1920x1080`), `--fps` (30), `--crossfade <sec>`
(default 0 = hard cuts), `--fade <sec>` (overall fade in/out, default 0.5),
`--captions <file.srt>`, `--align <file.srt>` / `--no-align` / `--align-tol`
(snap cuts to transcript timing; auto in `--project` mode), `--breath <sec>`,
`--crf` (18), `--preset` (medium), `--out`, `--dry-run`.

## Project layout (single flat folder)

With `--project <slug>` everything is read from and written to the one folder:
images = the timestamp PNGs in `<slug>/`, audio = the `<slug>.mp3` it finds there,
captions/align = the `<slug>.srt` there, output = `<slug>/<slug>.mp4`. Thumbnail
files (named `<slug>.thumb-01.png` etc.) don't match the `mm_ss` pattern, so they
are ignored — only true b-roll frames are used.

## Inputs

- **Audio** (`--audio`): the narration (mp3/wav/m4a/…). If omitted (non-project),
  it auto-detects a single audio file in the images dir or cwd.
- **Images** (`--images`): a folder of timestamp-named images (`mm_ss.png`,
  optionally with an index prefix like `001_00_06.png`). Exactly what
  `/chatgpt-images` produces.
- **Timing** is read from the image filenames — no separate timestamps file is
  needed. (A `--captions` SRT is only used for subtitles.)
- **Sub-second sync** (`--align`): filenames carry only whole-second timestamps
  (`mm_ss`), so cuts can land up to ~1s early. With `--align <srt>` — **auto-on in
  `--project` mode** using the project's `<slug>.srt` — each cut snaps to the
  nearest transcript cue start (within `--align-tol`, default 1.5s). `--no-align`
  turns it off; the first image stays at 0 and unmatched cuts keep their filename
  time, so it's always safe.
- **Cut on the breath** (`--breath <sec>`, off by default): builds on `--align` —
  detects silent pauses and moves each cut up to `<sec>` into the pause *before*
  its line, so images change on the breath. Try `--breath 0.4`.

## How it works

- Reads the audio duration with `ffprobe`, sorts images by timestamp, computes
  each image's on-screen duration (`next start − this start`; last runs to audio
  end).
- **Hard cuts (default):** an ffmpeg `concat` demuxer with exact per-image
  durations — frame-accurate sync.
- **Crossfade (`--crossfade <sec>`):** one looped input per image chained with
  `xfade` transitions for a smoother slideshow.
- Every image is scaled + padded to the canvas (`--size`), set to `--fps`, and
  encoded H.264 + AAC, `+faststart`, with an optional overall fade in/out.

## Requirements

- **ffmpeg** and **ffprobe** on PATH (`ffmpeg -version`).

## What you must do when invoked

1. If `--help`/`-h`, print the Usage block and stop.
2. **Resolve images + audio** (`--project <slug>` fills both from the folder; or
   pass `--images` / `--audio`). Confirm which audio it found if ambiguous.
3. Confirm `ffmpeg`/`ffprobe` are available; if not, tell the user to install
   them and stop.
4. **Run a `--dry-run` first** to show the computed per-image timings and the
   ffmpeg command, so the user can sanity-check sync before the encode.
5. **Run the render:**
   ```
   node "~/.claude/skills/render/scripts/render.mjs" --project "<slug>"
   ```
   Add `--crossfade`, `--size`, `--captions`, `--out`, etc. only if asked. A long
   video can take a while to encode — prefer the background and report the output
   path + size when done.
6. **Report** the output file path and size.

## Notes

- **Aspect ratio:** default `1920x1080` (16:9). For vertical Shorts use
  `--size 1080x1920`; images are letterboxed/pillarboxed to fit, so generate them
  in the matching aspect for a full-frame look.
- **Sync:** hard cuts are frame-accurate to each timestamp. A crossfade starts
  slightly *before* the timestamp (by the fade length) — keep it short (~0.3–0.5s)
  to stay in sync.
- **Captions:** `--captions` burns an SRT via the `subtitles` filter (paths are
  auto-escaped for Windows). Style is ffmpeg's default.
