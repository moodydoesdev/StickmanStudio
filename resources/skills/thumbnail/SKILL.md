---
name: thumbnail
description: "Generate YouTube thumbnail concepts for a video — same house character as the b-roll, but pushed for thumbnails (one big close-up subject, exaggerated expression, high contrast) with a short bold TITLE baked into the image by gpt-image-2. Reuses the chatgpt-images engine; renders a few variations to pick from. Trigger: /thumbnail. Use when the user wants a clickable thumbnail for a finished video."
trigger: /thumbnail
---

# /thumbnail

Generate **YouTube thumbnail concepts** for a video. Same house character as the
in-video b-roll, but composed for a **thumbnail**: one **big close-up focal
subject**, **exaggerated expression**, **high contrast**, a bold simple background
— and a **short bold TITLE painted into the image** by gpt-image-2. Renders a few
variations so you can pick the cleanest one.

This skill is **LLM-driven over the existing image engine**: it composes the
thumbnail prompt(s) and calls the same `generate.mjs` that `/chatgpt-images` uses
(model `gpt-image-2`), writing into the video's single project folder.

> Paths below use `~/.claude/skills/...` (where Claude Code keeps skills). On
> Windows that's `C:\Users\<you>\.claude\skills\...`.

## Usage

```
/thumbnail --project <slug>                       # auto: read script/srt, render 3 concepts into <slug>/
/thumbnail --project <slug> --title "WHERE DID THE YEAR GO?"   # set the baked-in title text
/thumbnail --project <slug> --count 4             # how many variations (default 3)
/thumbnail --project <slug> --no-text             # text-free hero images (add title in your editor)
/thumbnail --project <slug> --style house         # match in-video b-roll style instead of the bolder variant
/thumbnail <script-or-srt> --title "…"            # work from a given file (no project)
/thumbnail --project <slug> --size 1280x720       # thumbnail size (default 1280x720, 16:9)
/thumbnail --project <slug> --overwrite           # regenerate even if files exist
/thumbnail --project <slug> --dry-run             # compose + show prompts, don't call the API
/thumbnail --help
```

If `--help`/`-h` is passed, print this Usage block and stop.

## Inputs (auto-discovered with `--project`)

- **Script / transcript** — `<slug>/<slug>.script.txt` and/or `<slug>/<slug>.srt`.
  Read these to find the **hook** and the **single strongest visual moment**, and
  to derive a punchy **title** if `--title` isn't given. (A chosen title may also
  be saved in `<slug>/<slug>.title.txt`.)

## What you must do when invoked

1. **Parse args / resolve inputs.** With `--project <slug>`, read the script (and
   SRT if present) from the project folder. Otherwise use the file given. If
   `--help`, print Usage and stop.

2. **Pick the title.** Use `--title` if given (or the `<slug>.title.txt`). Else
   derive a **short, punchy title — ideally ≤ 5 words, ALL CAPS** — from the
   video's hook. Short titles are critical: gpt-image-2 renders a few big words
   far more legibly than a sentence. (Skip entirely if `--no-text`.)

3. **Pick the hero visual.** Choose the one image that best sells the click — the
   most dramatic / emotional single moment or symbol. One subject, close-up, big.

4. **Load the house style.** Read `base-style.md` (in the `video-image-prompts`
   skill folder) and take its **STYLE PREFIX verbatim** so the character stays
   on-model. **Do not rewrite the prefix.**

5. **Compose the thumbnail prompt(s).** For the default **bolder variant**, take
   the verbatim STYLE PREFIX, then append a **thumbnail composition layer**:

   > …, **YouTube thumbnail composition**: ONE big close-up subject filling the
   > frame, exaggerated emotional expression, dramatic high-contrast lighting,
   > bold simple uncluttered background with strong color, clear focal point that
   > reads at small size, generous negative space on one side. **Large bold
   > title text "<TITLE>"** in a heavy clean sans-serif, high-contrast against the
   > background, occupying the negative space, spelled exactly and fully legible.
   > Full-bleed 16:9. Negative: cluttered background, tiny details, busy scene,
   > small text, gibberish text, watermark, multiple competing subjects.

   - `--no-text`: drop the title clause and the negative-space requirement;
     describe a clean text-free hero instead.
   - `--style house`: skip the bolder-variant layer; use the plain in-video
     framing from the base style.
   - Write **`--count` distinct variations** (default 3): vary composition, camera
     distance, expression, background color, and title placement so there's a real
     choice — and so at least one renders the text cleanly (model text is
     hit-or-miss; variations are the hedge).

6. **Write the prompts file** to `<slug>/<slug>.thumb-prompts.txt`, one line per
   variation in `/chatgpt-images` format:
   ```
   # thumbnails for <slug>
   01 | <full prompt for concept A>
   02 | <full prompt for concept B>
   03 | <full prompt for concept C>
   ```

7. **Render** with the existing engine (one call, variations in parallel). Use
   `--name-prefix` so the thumbnails sit in the single project folder without
   clashing with the b-roll images or its manifest. Run in the **background**
   (each is an API call) unless `--dry-run`:
   ```
   node "~/.claude/skills/chatgpt-images/scripts/generate.mjs" \
     --project "<slug>" \
     --input "<slug>/<slug>.thumb-prompts.txt" \
     --name-prefix "<slug>.thumb-" \
     --size 1280x720 --quality high
   ```
   - Add `--overwrite` / `--dry-run` if passed. Images land as
     `<slug>/<slug>.thumb-01.png`, `<slug>.thumb-02.png`, … plus
     `<slug>.thumb-manifest.json`.
   - Non-project mode: `--out "<cwd>" --video thumbnail` → `<cwd>/thumbnail/`.

8. **Report.** List the generated files with full paths and the title used, and
   tell the user to **pick the variation with the cleanest text/biggest punch**
   (delete the rest). Note the cost from the manifest. If a variation's text came
   out garbled, suggest re-running that one (`--overwrite`) or shortening the
   title — that's the usual fix.

## Notes

- **Why baked-in text + variations:** letting gpt-image-2 paint the title is
  one-step and on-trend, but model text varies per generation — so always render a
  few and pick the best. Shorter, ALL-CAPS titles render much more reliably.
- **Why a bolder variant:** in-video b-roll is framed wide and quiet; a thumbnail
  has to win as a tiny tile in a crowded feed. One big subject + exaggerated
  emotion + high contrast is what makes it pop, while the verbatim STYLE PREFIX
  keeps it unmistakably the same channel.
- **Size:** default `1280x720` (YouTube's recommended 16:9; both dims ÷16, which
  gpt-image-2 requires). For a Shorts cover use `--size 720x1280`.
- **Engine details** (auth, retries, cost reporting, resume-on-rerun) are exactly
  `/chatgpt-images` — see that skill. Re-running skips existing files unless
  `--overwrite`.
