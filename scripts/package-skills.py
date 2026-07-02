#!/usr/bin/env python3
"""Package the Claude-app-compatible skills into uploadable zips.

Reads each skill listed in APP_SKILLS from resources/skills/ and writes
dist/skills/<name>.zip, ready to upload in the Claude apps via
Settings -> Capabilities -> Skills -> Upload skill.

The bundled SKILL.md files are written for Claude Code (long descriptions, a
nonstandard `trigger:` field). The Claude apps enforce stricter frontmatter —
description <= 200 chars, only documented fields — so the frontmatter is
rewritten on the way into the zip; the source files are not modified.

Only skills that can run in the Claude app's code-execution sandbox belong in
APP_SKILLS: anything needing local binaries or CLIs (ffmpeg, whisper, the
OpenAI/ElevenLabs tools) would upload fine but fail at runtime.

Stdlib only. Run from anywhere: python3 scripts/package-skills.py
"""

import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "resources" / "skills"
OUT = ROOT / "dist" / "skills"

MAX_DESC = 200  # claude.ai description limit (shorter than the API's 1024)
MAX_ZIP = 30 * 1024 * 1024  # claude.ai upload limit

# Skill name -> app-facing description (what it does + when to use it).
APP_SKILLS = {
    "research-video": (
        "Research a topic and write a ready-to-narrate video script where "
        "every sentence is one visual beat, in a cinematic micro-documentary "
        "voice. Use when the user wants a narration script for a video."
    ),
    "video-image-prompts": (
        "Turn a timestamped transcript into one image-generation prompt per "
        "beat, all sharing a single base art style (default: white-faced "
        "stick-figure cartoon). Use to create image prompts for a video."
    ),
    "description": (
        "Write a publish-ready YouTube description for a video - hook, "
        "chapters from the real transcript timings, discussion breakdown, "
        "sources and hashtags. Use when a finished video needs its "
        "description."
    ),
}


def rewrite_frontmatter(text: str, name: str, desc: str) -> str:
    if not re.match(r"^---\n.*?\n---\n", text, re.S):
        sys.exit(f"{name}: SKILL.md has no YAML frontmatter")
    text = re.sub(r"(?m)^description: .*$", f"description: {desc}", text, count=1)
    text = re.sub(r"(?m)^trigger: .*\n", "", text, count=1)
    return text


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, desc in APP_SKILLS.items():
        if not re.fullmatch(r"[a-z0-9-]{1,64}", name) or "anthropic" in name or "claude" in name:
            sys.exit(f"{name}: invalid skill name for the Claude apps")
        if not 0 < len(desc) <= MAX_DESC:
            sys.exit(f"{name}: description is {len(desc)} chars (limit {MAX_DESC})")
        skill_md = SRC / name / "SKILL.md"
        if not skill_md.is_file():
            sys.exit(f"{name}: {skill_md} not found")

        zip_path = OUT / f"{name}.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in sorted((SRC / name).rglob("*")):
                if not f.is_file():
                    continue
                arcname = f"{name}/{f.relative_to(SRC / name).as_posix()}"
                if f == skill_md:
                    zf.writestr(arcname, rewrite_frontmatter(f.read_text(encoding="utf-8"), name, desc))
                else:
                    zf.write(f, arcname)

        size = zip_path.stat().st_size
        if size > MAX_ZIP:
            sys.exit(f"{name}: zip is {size / 1e6:.1f} MB (limit 30 MB)")
        print(f"{name}.zip  {size / 1024:.1f} KB  (description: {len(desc)} chars)")


if __name__ == "__main__":
    main()
