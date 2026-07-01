---
name: new-video
description: "End-to-end video factory: given a topic, orchestrate the whole pipeline into ONE project folder — research + script, narration, transcription, house-style image prompts, image generation, final ffmpeg render, plus a title, description, and thumbnail. Pauses once after the script for approval by default, or runs fully autonomously with --auto. Trigger: /new-video. Use when the user gives a topic and wants a finished narrated video, not just one stage."
trigger: /new-video
---

# /new-video

Topic in → finished `<slug>/<slug>.mp4` **plus a title, a publish-ready
description, and a thumbnail** out. This is the **orchestrator** that runs the full
pipeline in order, all into **one flat project folder**, using each stage's
`--project` mode so outputs flow stage→stage automatically.

```
research+script → narrate → transcribe → image prompts → images → render → description → thumbnail
```

Everything lands in a single folder named after the slug — no per-stage
subfolders:

```
<slug>/
  <slug>.script.txt   <slug>.title.txt   <slug>.sources.txt
  <slug>.mp3
  <slug>.srt
  <slug>.prompts.txt
  00_00.png  00_06.png  …            _manifest.json
  <slug>.mp4
  <slug>.description.txt
  <slug>.thumb-prompts.txt  <slug>.thumb-01.png …   <slug>.thumb-manifest.json
```

> Paths below use `~/.claude/skills/...` (where Claude Code keeps skills). On
> Windows that's `C:\Users\<you>\.claude\skills\...`.

**Default run mode: pause once after the script.** Write the script, show it,
**STOP for approval/edits**, then run narration → images → render → description →
thumbnail straight through (the narration/images/thumbnail stages spend ElevenLabs
+ OpenAI credits, so the script gets a human check first).

**`--auto` = fully autonomous.** No human interaction at any point. Skip the script
checkpoint; never ask clarifying questions (pick the most defensible interpretation
and note it in the final report); auto-pick the title and the thumbnail variation
yourself; run topic → finished package without stopping. It still **stops and
reports on a hard stage failure** and still **spends credits with no preview**.

## Usage

```
/new-video "<topic>"                    # research → script → (approve) → full build (~7-10 min, ~60-100 beats)
/new-video "<topic>" --slug my-name     # set the project folder name (default: from topic)
/new-video "<topic>" --voice <id>       # ElevenLabs narrator voice ID (required for narration)
/new-video "<topic>" --length short     # a Short (~8-12 beats, ~40-60s)
/new-video "<topic>" --length long      # extended piece (~12-18 min, ~120-180 beats)
/new-video "<topic>" --beats N          # force an exact beat count
/new-video "<topic>" --vertical         # Shorts: images 1024x1536, render 1080x1920
/new-video "<topic>" --captions         # burn the transcript SRT into the final video
/new-video "<topic>" --auto             # FULLY AUTONOMOUS — no prompts, topic → finished package
/new-video "<topic>" --checkpoint images  # also pause after images, before render
/new-video "<topic>" --title "…"        # force the video title
/new-video "<topic>" --no-thumbnail     # skip the thumbnail stage
/new-video "<topic>" --no-description   # skip the description stage
/new-video --resume <slug>              # continue an existing project (skips finished stages)
```

The project folder is `<cwd>/<slug>` — run it from wherever you keep your videos.
Re-running is safe: narration/images/render skip outputs that already exist.

## Tool paths (use these exact commands)

- narrate:    `node "~/.claude/skills/narrate/scripts/narrate.mjs" --project "<slug>" --voice "<id>"`
- transcribe: `"~/.claude/skills/transcribe/scripts/.venv/Scripts/python.exe" "~/.claude/skills/transcribe/scripts/transcribe.py" --project "<slug>"` (add `--device cuda` if a GPU venv is set up)
- images:     `node "~/.claude/skills/chatgpt-images/scripts/generate.mjs" --project "<slug>"`
- render:     `node "~/.claude/skills/render/scripts/render.mjs" --project "<slug>"`
- description: LLM-driven — apply the **/description** method (read that skill). Reads the project's script + srt, writes `<slug>/<slug>.description.txt`.
- thumbnail:  LLM-driven over the image engine — apply the **/thumbnail** method (read that skill). Composes the prompt(s), then runs the image engine flat into the project folder:
  `node "~/.claude/skills/chatgpt-images/scripts/generate.mjs" --project "<slug>" --input "<slug>/<slug>.thumb-prompts.txt" --name-prefix "<slug>.thumb-" --size 1280x720 --quality high`

Run these from the working dir so `--project "<slug>"` resolves to `<cwd>/<slug>`.

## What you must do when invoked

If `--help`/`-h`, print Usage and stop.

**0. Slug + project.** Derive `<slug>` from `--slug`, else a short kebab-case of the
topic. The stage scripts create the single folder on first run; you only need to
make sure the script file lands as `<slug>/<slug>.script.txt`.

**1. Research + script** — apply the **/research-video** method (read that skill):
research the topic (WebSearch + WebFetch the best sources; verify names/dates/
numbers, don't fabricate), then write a script with strict beat discipline (one
sentence = one visual beat). **End every script with the channel outro** (1-2 short
on-voice "thanks for watching / subscribe" sign-off beats, each its own line). Save
the clean one-beat-per-line narration to `<slug>/<slug>.script.txt` with `Write`.
Under `--auto`, do NOT pause for clarifying questions — choose the most defensible
angle and note it in step 10.

**1b. Title candidates.** Propose ~5 titles in the channel voice: punchy and
curiosity-driving but true to the story, roughly 40-60 characters, no clickbait the
video doesn't pay off. Lead with the strongest. (If `--title "…"` was given, use it
verbatim.)

**2. ⏸ CHECKPOINT (unless `--auto`).** Show the script, the sources, **and the title
options**. **Stop and wait** for the user to approve/edit the script and pick a
title. Don't spend credits yet. If they edit the script, update the file. Once
approved, save the chosen title as a single line to `<slug>/<slug>.title.txt` with
`Write`, then continue. (With `--auto`: pick your strongest title, save it, continue.)

**3. Narrate** — `narrate ... --project "<slug>" --voice "<id>"`. Reads
`<slug>.script.txt`, writes `<slug>.mp3`. **A voice ID is required** (`--voice` or
the `ELEVENLABS_VOICE_ID` env var) — if none is set, ask the user for theirs before
spending credits. Long + paid — run in the background; report when done.

**4. Transcribe** — `transcribe ... --project "<slug>"`. Reads the `<slug>.mp3`,
writes `<slug>.srt`. Defaults to CPU (slow — prefer the background; add
`--device cuda` if a GPU venv is installed). This gives the **real beat timings**
measured from the spoken audio.

**5. Image prompts** — apply the **/video-image-prompts** method (read that skill):
parse `<slug>.srt` into beats, prepend the verbatim house STYLE PREFIX from
`video-image-prompts/base-style.md`, write one prompt per beat to
`<slug>/<slug>.prompts.txt` (format `video: <slug>` then `MM:SS | prompt`). Use
`--vertical` framing notes if set.

**6. Generate images** — `images ... --project "<slug>"` (add `--size 1024x1536` if
`--vertical`). Reads `<slug>.prompts.txt`, writes one PNG per beat into `<slug>/`.
Paid — run in the background.
   - If `--checkpoint images` (ignored under `--auto`): show the generated images,
     let the user flag any to regenerate (re-run with `--overwrite` after editing
     those prompt lines), then continue.

**7. Render** — `render ... --project "<slug>"` (add `--size 1080x1920` if
`--vertical`; add `--captions "<slug>/<slug>.srt"` if `--captions`). Reads the
project's images + audio, writes `<slug>/<slug>.mp4`. Run in the background.

**8. Description** (unless `--no-description`) — apply the **/description** method
(read that skill): read the script (incl. `<slug>.title.txt`) + `<slug>.srt`, lead
with the chosen title, build chapters from the real beat timings, and write the
full YouTube description to `<slug>/<slug>.description.txt`. LLM-driven, no credits.
Verify any Sources with a quick research pass — don't fabricate citations.

**9. Thumbnail** (unless `--no-thumbnail`) — apply the **/thumbnail** method (read
that skill): compose `--count 3` bolder-variant thumbnail prompts (verbatim house
STYLE PREFIX + thumbnail composition + the title), write them to
`<slug>/<slug>.thumb-prompts.txt`, then run the image engine with
`--name-prefix "<slug>.thumb-"` (see Tool paths; `--size 720x1280` if `--vertical`)
so thumbnails land flat in the project folder. Paid — run in the background. Show
the variations so the user can pick the cleanest. **Under `--auto`, auto-select the
strongest variation (name it in the report) and continue.**

**10. Report.** Give the **chosen title**, the final `<slug>/<slug>.mp4` path +
size, the `<slug>.description.txt` path, the thumbnail variation paths, and a
one-line map of everything created in the project folder — the complete upload-ready
package.

## Notes

- **Failure handling:** if a stage fails, stop and report which one and why; the
  finished stages are already saved in the project folder, so fix the cause and
  re-run from that stage (or `--resume <slug>`). Don't blow away prior outputs.
- **Money + time:** narration, images, and the thumbnail are the paid stages;
  transcription, render, and the description are local/free but can take minutes.
  At ~7-10 min length that's roughly **60-100 beat images** plus a few thousand
  ElevenLabs characters per video. Prefer background runs and keep the user posted.
- **Length:** default ~7-10 min (~60-100 one-sentence beats). `--length short` →
  ~40-60s Short (~8-12 beats); `--length long` → ~12-18 min (~120-180 beats);
  `--beats N` forces a count. **`--vertical` (Shorts) overrides to short length.**
  Honor the target by actually writing that many beats — go deeper into the research;
  never pad.
- **Beat discipline is what makes it line up:** because each script sentence is one
  beat, `/transcribe` segments the audio into those beats and there's exactly one
  image per beat. Keep that discipline in step 1.
- **Aspect:** default 16:9. `--vertical` switches both image size and render canvas
  to 9:16 for Shorts (and forces the short length).
