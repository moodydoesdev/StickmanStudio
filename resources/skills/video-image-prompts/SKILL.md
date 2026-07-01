---
name: video-image-prompts
description: "Turn a timestamped transcript into a consistent set of image-generation prompts — one per beat — that all share a single base art style (default: a white-faced stick-figure cartoon on white). Prepends a fixed base STYLE PREFIX to every prompt and saves a `MM:SS | prompt` file ready for /chatgpt-images. Can re-derive a different style from a reference for a one-off. Trigger: /video-image-prompts."
trigger: /video-image-prompts
---

# /video-image-prompts

Turn a **timestamped transcript** into a **consistent set of image prompts** —
one per beat — that all share one **base art style**. Output is a human-readable
list plus a ready-to-run `MM:SS | prompt` file for **/chatgpt-images**.

The base style is captured in `base-style.md` (next to this file), with a
reference frame `base-style-ref-white.png`. By default every prompt uses that
style, so all videos look like one channel. The default is a white-faced
stick-figure cartoon on a plain white background; edit `base-style.md` (or use
`--restyle`) to make it your own.

> Paths below use `~/.claude/skills/...` (where Claude Code keeps skills). On
> Windows that's `C:\Users\<you>\.claude\skills\...`.

## Usage

```
/video-image-prompts <transcript-file>        # use the saved base style (default)
/video-image-prompts                          # paste the transcript when asked
/video-image-prompts <file> --video <name>    # set the output folder/slug name
/video-image-prompts --project <slug>         # read <slug>/<slug>.srt, write <slug>/<slug>.prompts.txt
/video-image-prompts <file> --out "<dir>"     # where to write the prompts .txt (default: cwd)
/video-image-prompts <file> --no-file         # print only, don't write the .txt
/video-image-prompts <file> --restyle <url|frames-dir>     # derive a DIFFERENT style for THIS video
/video-image-prompts <file> --restyle <ref> --save-style   # ...and overwrite the saved base style
/video-image-prompts --help
```

If `--help`/`-h` is passed (no other args), print this Usage block and stop.

## Input — a timestamped transcript

Accept any of: an `.srt`/`.vtt`, a `MM:SS | text` file (what `/transcribe`
produces), or pasted lines like `00:00 ...`. Each timestamped segment = one beat
= one image. If no transcript is given, ask for it; do not invent one.

## Project layout (single flat folder)

With `--project <slug>` the transcript is read from `<slug>/<slug>.srt` and the
prompts are written to `<slug>/<slug>.prompts.txt` — both in the one project
folder, no subfolders.

## What you must do when invoked

1. **Resolve the transcript** (file you Read, or inline text). Parse it into
   ordered beats of `{ timestamp, text }`. For SRT/VTT, use each cue's start time
   and text; for `MM:SS | text`, split on `|`.
   - **With `--project <slug>`:** if no transcript file is given, read
     `<slug>/<slug>.srt`.

2. **Load the style.**
   - **Default:** Read `base-style.md` from this skill's folder and use its
     **STYLE PREFIX** and **NEGATIVE** exactly. Optionally Read
     `base-style-ref-white.png` to keep scene descriptions on-model.
     **Reuse the STYLE PREFIX verbatim — do not "improve" or rephrase it.** The
     wording can look crude but the model elevates it into the look; rewriting it
     drifts the style.
   - **`--restyle <ref>`:** instead, derive a fresh style from the reference
     (Read frame screenshots if a dir is given; else WebFetch a YouTube URL's
     thumbnail/metadata) and lock a new STYLE PREFIX + NEGATIVE for this video.
     State what the analysis was based on. If `--save-style` is also set, rewrite
     `base-style.md` with the new prefix/negative (and update the ref frame).

3. **For each beat, write a prompt** =
   - the **STYLE PREFIX verbatim**, then
   - a concrete scene illustrating that beat's text (literal subject, or a
     symbolic visual when the line is abstract — keep words out of the image),
     keeping characters on-model and composing full-bleed 16:9, then
   - the **NEGATIVE** line (tune per beat, e.g. add `gore, blood` for violent beats).

4. **Print** the Style Prefix once, then each beat as:
   ```
   [MM:SS] - <brief topic label>
   Prompt: <STYLE PREFIX>. <scene>. Negative: <…>
   ```

5. **Write the pipeline file** (unless `--no-file`) in /chatgpt-images format:
   ```
   video: <slug>
   00:00 | <full prompt>
   00:06 | <full prompt>
   ```
   Slug from `--project`/`--video`, else the transcript filename. Use `Write`.
   - **With `--project <slug>`:** write to `<slug>/<slug>.prompts.txt`.
   - Else default `<cwd>/<slug>.prompts.txt` (honor `--out`).

6. **Hand off:**
   ```
   /chatgpt-images --project <slug>      # (or: /chatgpt-images "<the .txt you just wrote>")
   ```

## Notes

- **Consistency is the point.** The shared, verbatim STYLE PREFIX + a fixed
  NEGATIVE is what makes the whole video (and every video) look like one series.
- **Don't polish the prefix.** The captured prefix is the *proven input* that
  produced the reference frame — keep it exactly; only the per-beat scene text
  changes.
- **Abstract beats:** pick a recurring symbolic visual (a relevant object, place,
  or the character) rather than on-screen text — image models render text poorly.
- **Outro beats:** a "thanks for watching" beat → the character waving goodbye; a
  subscribe beat → a character reaching out and **pressing a big red "Subscribe"
  button** (a thumbs-up icon nearby is good). This is the ONE beat where a button
  label is the subject, so **drop `text, captions` from the NEGATIVE for this beat
  only** (keep the rest) so the button reads clearly. Still no other on-screen text.
- **Aspect:** base style is 16:9; for vertical Shorts, note it and adjust the
  scene framing (and generate with `/chatgpt-images --size 1024x1536`).
- **Updating the look:** to evolve the channel style, run `--restyle <ref>
  --save-style`, or just edit `base-style.md` directly.
