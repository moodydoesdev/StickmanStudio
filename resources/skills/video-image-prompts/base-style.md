# Base image style (the "house style")

The visual identity that every image prompt in a video shares, so the whole video
— and every video on your channel — looks like one consistent series. The default
captured here is a **white-faced stick-figure cartoon on a plain white background**
(the look these explainer videos are known for). The active reference frame lives
beside this file: `base-style-ref-white.png`.

You can keep this default, edit it, or replace it entirely with your own look (see
`--restyle` / `--save-style` in `SKILL.md`). The mechanics below stay the same
whatever style you choose — the point is that **one fixed STYLE PREFIX is reused
verbatim on every prompt**, which is what holds the look together.

## Style summary (the default)

Hand-drawn **stickman cartoon on white**. Characters are minimalist stick figures —
round/oval white blank faces, small black dot eyes and barely-there features, thin
black inked stick limbs, scribbly bold black outlines, loose rough linework. Their
clothing, armor, and held props get **simple flat color** in a muted earthy palette
(slate blue, gold, brown, ochre, brick red) with bold black outlines and only
minimal flat shading. The crucial rule: the **background stays pure white** — no
texture, no gradient, no landscape, no sky. Props/scenery are drawn as simple
colored doodle objects on the white, never a filled painted scene. Composed
full-bleed 16:9. Drama comes from pose, scale, gesture and composition, not from
cinematic lighting or backgrounds.

Why this look: a flat "colored marker doodle on blank white paper" cartoon reads as
hand-made and charming, and — unlike a painterly, textured, golden-hour render — it
doesn't immediately read as AI-generated. Keeping colored characters but dropping
the painted *environment* removes the AI tell while keeping the charm.

## STYLE PREFIX — prepend verbatim to every prompt

Reuse it **verbatim**; tune only the per-beat scene text after it. The wording can
look crude, but the model elevates it into the consistent cartoon look — rewriting
it drifts the style from image to image.

```
Crude hand-drawn stickman cartoon in the style of a simple web/meme explainer cartoon: white oval-faced characters with small dot eyes and scribbly thick black ink outlines, thin stick limbs, simple flat color on clothing and props only (muted earthy tones — slate blue, gold, brown, ochre, brick red), bold black outlines, minimal flat shading, rough sketchy linework, drawn on a completely plain solid white background with no scenery, no texture and no gradient — characters and props only, like a colored marker doodle on blank white paper
```

## NEGATIVE (append verbatim, tune per image)

```
Negative: textured background, parchment, paper texture, colored background, background scenery, landscape, sky, sunset, gradient, painted rendering, cross-hatch shading, photorealism, 3D render, realistic rendering, watermark, logos, text, captions, gibberish text, gore, blood, extra fingers, detailed rendering
```

## How to use

- Prepend the STYLE PREFIX **unchanged** to every beat's prompt, then describe the
  scene in simple terms (who's doing what, what they wear, any props), then append
  the NEGATIVE. The constant prefix is what keeps a whole video consistent.
- **Keep the background pure white.** Color goes on the *characters and props*, not
  the environment. Draw scene elements (ships, castles, thrones, banners) as simple
  colored doodle objects on white — think "what you'd sketch and color on a
  whiteboard," not a painted landscape.
- For dramatic beats, lean on **pose, gesture, scale, and composition** (plus simple
  line marks — motion lines, a few wavy lines for water) rather than colored skies
  or lighting.
- This base style is the default. To match a *different* look for a one-off video,
  the skill can re-derive a style from a provided reference (see `SKILL.md`
  `--restyle`); `--save-style` overwrites this file with a new capture.

## Making it your own

Want a different signature look (flat vector, watercolor, retro print, 3D clay,
photoreal)? Two ways:

1. Edit this file — rewrite the STYLE PREFIX and NEGATIVE once, and every future
   video adopts it.
2. Run `/video-image-prompts <transcript> --restyle <reference> --save-style` to
   have the skill capture a new prefix from a reference you like and save it here.

The only rule that matters: **one fixed prefix, used verbatim on every prompt.**
