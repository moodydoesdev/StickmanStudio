---
name: narrate
description: "Generate an ElevenLabs voiceover MP3 from a narration script (.txt). Uses the eleven_v3 model by default. You supply the narrator voice (--voice <id> or the ELEVENLABS_VOICE_ID env var) — no voice is bundled. Reads the API key from the existing `elevenlabs auth login` (env -> .env -> ~/.elevenlabs/api_key); the key is never stored in the skill. Long scripts are chunked under the per-request limit and stitched with ffmpeg. Trigger: /narrate. Use when the user wants to turn a script into spoken narration audio for a video."
trigger: /narrate
---

# /narrate

Turn a narration script into an ElevenLabs voiceover MP3. Defaults to the
**`eleven_v3`** model. **You choose the narrator voice** — none is bundled. This
is the audio step of the video pipeline: script -> **/narrate** -> /transcribe ->
/video-image-prompts -> /chatgpt-images -> /render.

> Paths below use `~/.claude/skills/...` (where Claude Code keeps skills). On
> Windows that's `C:\Users\<you>\.claude\skills\...`.

## Usage

```
/narrate <script.txt>                         # -> <script>.mp3 next to the file
/narrate <script.txt> --out narration.mp3     # choose output path
/narrate <script.txt> --voice <voiceId>       # REQUIRED: your ElevenLabs voice ID
/narrate <script.txt> --stability 0.0         # v3: 0=Creative, 0.5=Natural(default), 1=Robust
/narrate <script.txt> --model eleven_v3       # model (default eleven_v3 — keep unless asked otherwise)
/narrate --project <slug>                     # read <slug>/<slug>.script.txt, write <slug>/<slug>.mp3
/narrate <script.txt> --dry-run               # show chunk plan + character/credit count, no API calls
```

## Choosing a voice (no default is bundled)

There is **no built-in narrator voice**. Provide one of:
1. `--voice <id>` on the command, or
2. the `ELEVENLABS_VOICE_ID` environment variable.

Find a voice ID in your ElevenLabs account: **Voices → pick a voice → copy its
ID**, or grab one from the Voice Library. A real run with no voice set exits with
a clear error (a `--dry-run` still works so you can preview the chunk plan).

## How it works

- Reads the script, splits it into chunks under `--max-chars` (v3 default ~4500)
  on paragraph/sentence boundaries, and calls the ElevenLabs text-to-speech API
  for each chunk with `model_id=eleven_v3`.
- Single chunk -> written directly. Multiple chunks -> stitched into one MP3 with
  `ffmpeg` (concat, stream copy — no re-encode).
- **v3 voice settings:** stability is discrete (0 Creative / 0.5 Natural / 1
  Robust); the v2 knobs (`similarity`, `style`, `speed`) don't apply to v3 and
  are not sent, so there are no 422s.

## Project layout (single flat folder)

With `--project <slug>` the script is read from `<slug>/<slug>.script.txt` and the
audio is written to `<slug>/<slug>.mp3` — everything in the one project folder, no
`script/` or `audio/` subfolders.

## API key (never stored here)

Resolved at runtime, first hit wins:
1. `ELEVENLABS_API_KEY` environment variable
2. `ELEVENLABS_API_KEY` in a `.env` file in the current directory
3. `~/.elevenlabs/api_key` — written by `elevenlabs auth login`

If none is found, the script tells the user to run `elevenlabs auth login`.

## What you must do when invoked

1. **Resolve the script file** from the user's args (or `--project <slug>`). If
   none, look for a `*.script.txt` / `*.txt` narration file in the current
   directory and confirm which one. If `--help`/`-h`, print Usage and stop.

2. **Confirm a voice is set** (`--voice` or `ELEVENLABS_VOICE_ID`). If not, ask
   the user for their ElevenLabs voice ID before spending credits.

3. **Run it** with the skill's Node script (no install needed — Node built-ins +
   ffmpeg). It calls a paid API and can take a bit for long scripts, so prefer
   the background over a short timeout:
   ```
   node "~/.claude/skills/narrate/scripts/narrate.mjs" --project "<slug>" --voice "<id>"
   ```
   A `--dry-run` first is a cheap way to show the chunk plan and the credit cost
   (~1 credit per character) before spending credits.

4. **Report** the output MP3 path and size, and offer the next pipeline step
   (`/transcribe --project <slug>` to get the timed SRT).

## Notes

- **v3 access:** `eleven_v3` must be enabled for the account. If the API returns
  a model/permission error, surface it — the user may need v3 access or should
  fall back with `--model eleven_multilingual_v2` (only if they explicitly ask).
- **Audio tags:** v3 supports inline emotion/delivery tags like `[whispers]`,
  `[somber]`, `[building intensity]`. If the script contains them, they're sent
  through as-is.
- **Cost:** characters ≈ credits. `--dry-run` prints the count before spending.
