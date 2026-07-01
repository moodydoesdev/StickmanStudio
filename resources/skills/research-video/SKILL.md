---
name: research-video
description: "Research a topic and write a narration script structured so each sentence is one deliberate visual beat. Beat discipline makes the whole pipeline (script → narration → /transcribe → /video-image-prompts → /chatgpt-images → /render) line up cleanly, one image per beat. Defaults to a cinematic micro-documentary voice you can fully customize. Trigger: /research-video. Use when the user wants a researched, ready-to-narrate video script."
trigger: /research-video
---

# /research-video

Research a topic, then write a **narration script** where **every sentence is one
deliberate visual beat**. Beat discipline is the whole point: it means narration →
transcript → images → video all line up, one clean image per beat, with natural
pacing.

> Paths below use `~/.claude/skills/...` (where Claude Code keeps skills). On
> Windows that's `C:\Users\<you>\.claude\skills\...`.

## Usage

```
/research-video <topic>                     # research + write a full script (default ~7-10 min, ~60-100 beats)
/research-video <topic> --beats 14          # target a specific number of beats
/research-video <topic> --length short      # a Short (~8-12 beats, ~40-60s)
/research-video <topic> --length long       # extended piece (~12-18 min, ~120-180 beats)
/research-video <topic> --out <file>        # where to save the script .txt (default: cwd)
/research-video <topic> --project <slug>    # save into <slug>/<slug>.script.txt (pipeline layout)
/research-video <topic> --no-research       # skip web research, write from known facts only
```

## The default style (customizable)

The bundled default is a cinematic, dramatic **micro-documentary** voice — works
well for true stories, history, science, and explainers. **This is just a default;
describe your own channel's voice and the skill adapts to it** (more comedic, more
casual, longer-form, etc.). The beat-discipline mechanic below stays the same
whatever voice you choose.

- **Voice:** authoritative, spare, dramatic. No filler, no "in this video", no
  "did you know". Let the facts hit.
- **Arc (5 moves):** Hook (a striking status quo or intrigue) → Turn (the inciting
  loss/betrayal/conflict) → Escalation (what they did about it) → Climax (the peak)
  → Legacy (a resonant closing line).
- **Sentences:** short, declarative, punchy. ~8-16 words. Vary rhythm but keep
  momentum. Strong first line as the hook; memorable last line as the button.
- **Tone over hype:** dramatize the *telling*, never the *facts*.

## Beat discipline (the most important rule)

**One period = one beat = one image.** Write every sentence so it stands alone as a
single, concrete, visualizable moment — a person, place, object, or action you
could draw. Do NOT cram two different images into one sentence; split them. Keep
beats roughly even in weight so on-screen durations come out smooth.

Bad:  "She sold her lands and jewels, bought three black ships, and hunted them for years."  (three images in one beat)
Good: "She sold her lands, her jewels, everything." / "Three ships, black hulls, blood-red sails." / "For thirteen years she hunted them."

This is exactly what makes `/transcribe` segment the narration into clean beats and
`/video-image-prompts` produce one coherent image per beat.

## What you must do when invoked

1. **Parse the topic.** If `--help`/`-h`, print Usage and stop. If the topic is too
   vague to research well, ask 1-2 quick clarifying questions (era, person/event,
   angle, desired length). Otherwise proceed.

2. **Research (unless `--no-research`).** Use `WebSearch` to find the topic, then
   `WebFetch` the best 2-4 sources to gather **verified specifics**: names, dates,
   places, numbers, vivid concrete details. **Do not fabricate facts**; if sources
   conflict, prefer the well-supported version or omit it. Keep a short source list.

3. **Write the script** with strict beat discipline:
   - Default ~60-100 beats (~7-10 min); `--length short` → ~8-12 beats; `--length
     long` → ~120-180 beats; honor `--beats N` if given.
   - For longer videos, go **deeper** into the research — more scenes, named people,
     turning points, concrete sensory detail. Never pad or repeat to hit a count;
     find more real story instead.
   - Each beat = one self-contained visual sentence. Follow the 5-move arc.
   - Open on the hook; close on a line that lands.
   - **Outro (every video):** after the closing line, add a short on-voice channel
     sign-off, each sentence its own beat (its own line) so it gets its own image.
     A sensible default: *"Thanks for watching."* / *"If you liked this video, give
     it a thumbs up and hit subscribe."* Keep it consistent across videos; the user
     can set their own wording.

4. **Output** in this format:
   ```
   Topic: <topic>
   Style: <1 line>
   Length: <N> beats (~<sec>s narrated)
   Sources: <urls used>

   Script (beats):
   1. <sentence>            — visual: <what the image shows>
   2. <sentence>            — visual: <...>
   ...

   Narration (paste into narration — one beat per line):
   <beat 1>
   <beat 2>
   ...
   ```

5. **Save the narration** as the clean one-beat-per-line block (no numbering or
   visual notes — ready for `/narrate`). Use `Write`.
   - **With `--project <slug>`:** save to `<slug>/<slug>.script.txt` (the single
     project folder; the rest of the chain then just needs `--project <slug>`).
   - Else honor `--out`, default the current dir (`<slug>.script.txt`).

6. **Hand off the pipeline.** The whole rest of the chain is `--project`-driven, so
   each stage only needs the slug:
   ```
   /narrate --project <slug> --voice <id>   → <slug>/<slug>.mp3
   /transcribe --project <slug>             → <slug>/<slug>.srt
   /video-image-prompts --project <slug>    → <slug>/<slug>.prompts.txt
   /chatgpt-images --project <slug>         → <slug>/00_00.png …
   /render --project <slug>                 → <slug>/<slug>.mp4
   ```
   Or do all of it at once with **/new-video "<topic>"**.

## Notes

- **Why sentences = beats:** the downstream `/transcribe` step segments the *audio*
  into lines and the image step makes one image per line. One clean visual per
  sentence keeps the finished video tight.
- **Length math:** narration runs ~2.5-3.5 words/sec and each one-sentence beat
  plays ~5-7s, so ~9-10 beats ≈ one minute. The default ~60-100 beats ≈ a 7-10 min
  video; ~8-12 beats ≈ a 40-60s Short. Tune with `--beats`.
- **Accuracy first:** for fact-based videos, wrong dates/names break trust. When
  unsure, omit rather than invent.
