---
name: description
description: "Write a full YouTube description for a video — hook, 'in this video' setup, auto-generated chapters from the real transcript timings, a 'we discuss' breakdown, a resonant closing line, optional Sources, and hashtags. Reads the project's script + transcription so the chapters and copy match the finished video. Trigger: /description. Use when the user wants the publish-ready description/chapters for a video."
trigger: /description
---

# /description

Turn a finished video's **script + transcript** into a **publish-ready YouTube
description**: a gripping hook, a spoiler-light setup, **chapters built from the
real beat timings**, a "what we discuss" breakdown, a resonant closing line,
optional **Sources**, and hashtags.

> Paths below use `~/.claude/skills/...` (where Claude Code keeps skills). On
> Windows that's `C:\Users\<you>\.claude\skills\...`.

The output follows this shape (adapt the voice to your channel):

```
<hook — 1-2 short second-person paragraphs that dramatize the central tension,
 ending on the core question/promise>

<"In this video, we explore/discover…" — what the video covers + the payoff,
 without spoiling the answer>

   • <Related video title>          ← editable end-screen/card link line

Chapters:
0:00 <curiosity-driven chapter title>
0:32 <…>
…
9:24 Thanks for watching

In this video, we discuss:

<Named Concept 1>: <1-2 sentence teaser>.

<Named Concept 2>: <…>.

…

<closing paragraph — a hopeful / resonant button, second person>

Sources:

<formal citation 1>

<formal citation 2>
…

#Tag1 #Tag2 #Tag3 #YourChannel
```

## Usage

```
/description --project <slug>            # read <slug>/'s script + srt, write <slug>/<slug>.description.txt
/description <script-or-srt>             # work from a given file (script .txt and/or .srt)
/description --project <slug> --title "Where Did the Year Go?"   # set the video title (used for tags/voice)
/description --project <slug> --related "Another Video Title"     # related-video link line
/description --project <slug> --sources <file>   # use a saved sources list instead of researching
/description --project <slug> --no-sources       # omit the Sources section
/description --out "<dir>"               # where to write the .txt (default: cwd / project folder)
/description --print                     # print only, don't write a file
/description --help
```

If `--help`/`-h` is passed, print this Usage block and stop.

## Inputs (auto-discovered with `--project`)

All in the single project folder `<slug>/`:
- **Transcript (required for chapters):** `<slug>/<slug>.srt` (or a `.srt` /
  `MM:SS | text` file passed directly). This gives the **real beat timings
  measured from the spoken audio** — chapters MUST be built from these, not guessed.
- **Script (for the copy):** `<slug>/<slug>.script.txt` — the narration, used to
  write the hook, the "we discuss" points, and the closing line on-voice.
- **Sources (optional):** `<slug>/<slug>.sources.txt`, a `Sources:` block inside
  the script file, or `--sources <file>`. If none exists and sources aren't
  suppressed, do a brief verification pass (step 5).

If no transcript is available, say so and ask for it — do **not** invent timestamps.

## What you must do when invoked

1. **Parse args / resolve inputs.** With `--project <slug>`, read the SRT and the
   script from `<slug>/`. Otherwise use the file(s) given. Parse the SRT into
   ordered beats `{ start, text }`.

2. **Write the hook (1-2 short paragraphs).** Second person, present tense, in the
   channel's voice — dramatize the central tension the video resolves and land on
   the core question or promise. No "in this video" yet, no clickbait lies.

3. **Write the setup paragraph.** One paragraph framing what the video explores and
   the payoff — compelling but **don't spoil the answer**. The "In this video, we
   explore…/discover…" beat.

4. **Build chapters from the transcript** (the important mechanical step):
   - Group the per-beat SRT segments into **~8-14 thematic chapters** (roughly one
     per 30-60s; never one-per-beat). Each chapter starts at the **start time of
     its first beat**.
   - **The first chapter MUST be `0:00`.** Use **`M:SS`** format (no leading zero
     on minutes, no `H:` unless the video passes 60 min). Keep each chapter ≥ ~10s
     apart (YouTube requirement).
   - Title each chapter with a **short, curiosity-driven phrase** matching the
     section. Use numbered "Reason N:" / "Part N:" titles when the script
     enumerates points.
   - The **last chapter is the outro** at the timestamp the outro begins.
   - Sanity-check: times strictly increasing, first is `0:00`, last ≤ video length.

5. **Write "In this video, we discuss:"** — 3-5 items, each a **Named Concept** (a
   memorable, capitalized label) followed by a 1-2 sentence teaser that creates
   curiosity without giving away the resolution. Mirror the script's main points.

6. **Write the closing paragraph.** A short, resonant, second-person button that
   leaves the viewer with the video's emotional takeaway. (Echo the script's final
   beat.)

7. **Sources** (unless `--no-sources`): if the video makes factual claims,
   citations must be **real and accurate**.
   - If a saved sources list exists (`--sources`, `<slug>.sources.txt`, or a
     `Sources:` block in the script), format those as clean citations.
   - Otherwise do a brief **WebSearch/WebFetch** pass to verify the key claims and
     cite the real works (author, year, title, venue). **Never fabricate a
     citation.** If a claim can't be sourced, leave a `[verify: …]` note rather
     than inventing one.
   - Format like: `Topic: Author, Year (Venue). "Title"`.

8. **Related-video line.** Output the editable end-screen/card link line
   `   • <title>` using `--related` if given, else exactly the placeholder
   `   • [Add a related video here]` for the user to fill in.

9. **Hashtags.** 4-6 relevant tags derived from the topic, ending with your channel
   tag (replace the `#YourChannel` placeholder with the real one), e.g.
   `#TimePerception #Psychology #Neuroscience #YourChannel`.

10. **Assemble & save.** Compose the full description in the exact order above.
    Print it in the chat, then (unless `--print`) `Write` it to:
    - **`--project`:** `<slug>/<slug>.description.txt`
    - else `--out` / cwd as `<slug>.description.txt`.

11. **Hand off.** Tell the user it's ready to paste into the YouTube description
    box, and that the chapter list also auto-creates the video's chapter markers.
    Remind them to fill the related-video line if it's still a placeholder.

## Notes

- **Chapters come from the audio, not the script.** The SRT timings are measured
  from the spoken narration, so they line up with the real video. Always group the
  actual SRT beats; never paste raw per-sentence timestamps or guess.
- **`M:SS`, first at 0:00.** YouTube only renders chapters if the first stamp is
  `0:00`, there are ≥3, and each is ≥10s. Honor all three.
- **Voice match.** The hook, "we discuss", and closing should sound like the
  narration. Read the script before writing them.
- **Accuracy first.** Wrong citations break trust. Prefer omitting or flagging over
  inventing.
- **Pipeline fit.** This is a publish-stage skill: it consumes the project's
  script + srt and writes `<slug>.description.txt`. `/new-video` runs it
  automatically near the end.
