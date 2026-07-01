---
name: chatgpt-images
description: "Batch-generate images from a text file of `timestamp | prompt` lines using OpenAI's image API (the `openai images generate` CLI, model gpt-image-2). Saves each image into the video's project folder. No browser, no login. Trigger: /chatgpt-images. Use when the user wants to generate a batch of images for a video from prompts."
trigger: /chatgpt-images
---

# /chatgpt-images

Batch-generate images from a list of prompts by calling the **OpenAI image API**
via the `openai` CLI (model `gpt-image-2`). One image per `timestamp | prompt`
line. No browser, no ChatGPT login, no Cloudflare — just the API.

> Paths below use `~/.claude/skills/...` (where Claude Code keeps skills). On
> Windows that's `C:\Users\<you>\.claude\skills\...`.

## Usage

```
/chatgpt-images <input-file>                      # generate images from a prompts file
/chatgpt-images <input-file> --video <name>       # force the output folder name
/chatgpt-images <input-file> --out "<dir>"        # base output dir (default: current dir)
/chatgpt-images --project <slug>                  # read <slug>/*.prompts.txt, write images into <slug>/
/chatgpt-images <input-file> --size 1024x1536     # portrait (default 1536x864, 16:9)
/chatgpt-images <input-file> --model gpt-image-2  # image model (default gpt-image-2)
/chatgpt-images <input-file> --quality high       # auto|high|medium|low (default auto)
/chatgpt-images <input-file> --concurrency 8      # images generated in parallel, 1-16 (default 4)
/chatgpt-images <input-file> --name-prefix "x."   # prefix every filename + the manifest
/chatgpt-images <input-file> --moderation auto    # low|auto (default low)
/chatgpt-images <input-file> --dry-run            # parse + show the plan, don't call the API
/chatgpt-images <input-file> --overwrite          # regenerate even if a file already exists
/chatgpt-images <input-file> --index-prefix       # name files 001_00_00.png instead of 00_00.png
```

Each image file is named by its timestamp by default: `00:00` -> `00_00.png`,
`00:23` -> `00_23.png`.

### Project layout (single flat folder)

Everything for one video lives in **one folder** named after the video's slug —
no `images/` / `audio/` subfolders. With `--project <slug>` the engine reads the
`<slug>/<slug>.prompts.txt` it finds in that folder and writes the PNGs (plus
`_manifest.json`) straight into `<slug>/`:

```
my-first-explainer/
  my-first-explainer.prompts.txt
  00_00.png  00_06.png  00_12.png ...
  _manifest.json
```

### Input file format (plain text)

One image per line: `timestamp | prompt`. An optional `video:` line sets the
folder name. Lines starting with `#` are comments.

```
video: my-first-explainer
00:00 | a stickman waving hello, white background
00:12 | a stickman running to the right, motion lines
```

A ready-to-copy example lives next to this skill: `prompts.example.txt`.

## How it works

- For each prompt it runs `openai images generate --model gpt-image-2 --prompt
  "<prompt>" --size <size> ...`, takes the returned base64 PNG, and writes it.
- Several prompts run **in parallel** (an async worker pool, `--concurrency`,
  default 4) so a batch finishes much faster than one-at-a-time.
- Output: `00_00.png`, `00_23.png`, … plus a `_manifest.json` in the same folder.
  (Use `--index-prefix` for `001_00_00.png`-style ordering instead.)
- `--name-prefix <p>` prepends `<p>` to every filename **and** names the manifest
  `<p>manifest.json` — so a second batch (e.g. thumbnails) can share the project
  folder without overwriting the main run's files.
- Re-running **resumes** — existing files are skipped unless `--overwrite`.
- On a rate-limit or transient API error it waits and retries (up to
  `--max-retries`, default 3). A moderation refusal is logged and skipped.

## Requirements

- The **`openai` CLI** must be installed and on PATH (`openai --version`).
- An **`OPENAI_API_KEY`** must be available. The script reads it from the
  environment; on Windows it also falls back to the **User-scope** env var if the
  current process didn't inherit it. (No key in code, ever.)

## What you must do when invoked

1. **Resolve the input file.** Use the path the user gave, or `--project <slug>`
   (reads `<slug>/<slug>.prompts.txt`). If none, look for a `*.prompts.txt` /
   `*.txt` file in the current directory; if there are several or none, ask which
   file (or point them at `prompts.example.txt`). If `--help`/`-h`, print Usage
   and stop.

2. **Sanity-check the toolchain** (quick): confirm `openai` is on PATH. If it
   isn't, tell the user to install it / add it to PATH and stop. You do NOT need
   `npm install` — the script uses only Node built-ins plus the `openai` CLI.

3. **Default the output base dir to the current working directory** (so a
   non-project `<video>` folder is created here), unless the user passed `--out`.

4. **Run the generator:**
   ```
   node "~/.claude/skills/chatgpt-images/scripts/generate.mjs" --project "<slug>"
   ```
   or for a loose prompts file:
   ```
   node "~/.claude/skills/chatgpt-images/scripts/generate.mjs" --input "<input-file>" --out "<cwd>"
   ```
   Add `--video`, `--size`, `--quality`, `--model`, `--moderation`, `--overwrite`,
   etc. only if asked. A `--dry-run` first shows the plan and filenames. The run
   can take a few minutes (one API call per image) — prefer running it in the
   background and report progress from the output / `_manifest.json`.

5. **Report results** from the script output / `_manifest.json`: how many images
   were generated, skipped, refused, or failed, and the folder path.

## Notes & troubleshooting

- **Aspect ratio:** default is `1536x864` (16:9) for video b-roll. For Shorts /
  vertical use `--size 1024x1536`. `gpt-image-2` accepts arbitrary `WxH` where
  both are divisible by 16 and the aspect ratio is between 1:3 and 3:1.
- **Negative prompts:** the image API has no separate negative-prompt field, so
  any `Negative: …` text in a prompt is just sent as part of the prompt (the
  model reads it as guidance). That's fine and intended.
- **Moderation refusals:** if a prompt is rejected, it's logged as `refused` in
  the manifest and skipped. `--moderation low` (the default) minimizes false
  refusals; rephrase the prompt if something legitimate keeps getting blocked.
- **Resuming:** re-run the same command — existing PNGs are skipped, so only the
  missing/failed ones are regenerated. Use `--overwrite` to redo everything.
- **Concurrency vs. rate limits:** `--concurrency` (default 4) controls how many
  images generate at once. Raise it (up to 16) for speed; rate-limit throttling
  is handled automatically (wait + retry), but lowering concurrency avoids it.
- **Cost reporting:** the run captures each image's token `usage` and prints the
  total tokens and an **estimated USD cost** at the end (also saved in
  `_manifest.json`). The estimate uses `--price-in`/`--price-out` (USD per 1M
  input/output tokens, defaults 5/40) — **verify current OpenAI pricing for
  gpt-image-2** and override the flags so the dollar figure is accurate. Token
  counts themselves are exact (from the API).
