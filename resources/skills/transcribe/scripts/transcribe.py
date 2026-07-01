#!/usr/bin/env python3
"""
transcribe: GPU (faster-whisper) audio/video -> SRT, with optional .txt and a
`MM:SS | text` prompts file that feeds straight into /chatgpt-images.

  python transcribe.py <input> [options]

Run `python transcribe.py --help` for the full list.
"""
import argparse
import glob
import os
import site
import subprocess
import sys
import tempfile

# The Windows console is often cp1252; transcripts can contain non-Latin chars
# (incl. the occasional hallucinated glyph), which would crash print(). Force
# UTF-8 on the console streams so a stray character never aborts a run.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    except Exception:
        pass

# Single flat project folder: everything for a video lives directly in <project>/,
# distinguished by filename — no per-stage subfolders.
def ensure_project(arg):
    root = os.path.abspath(os.path.join(os.getcwd(), arg))
    os.makedirs(root, exist_ok=True)
    return root, os.path.basename(root)


# ---------------------------------------------------------------------------
# Make CUDA DLLs from the nvidia-*-cu12 pip packages discoverable on Windows,
# so GPU works without a manual CUDA/cuDNN install or PATH edits.
# ---------------------------------------------------------------------------
def add_cuda_dll_dirs():
    if os.name != "nt":
        return
    roots = []
    try:
        roots += site.getsitepackages()
    except Exception:
        pass
    try:
        roots.append(site.getusersitepackages())
    except Exception:
        pass
    roots.append(os.path.join(os.path.dirname(sys.executable), "Lib", "site-packages"))
    seen = set()
    path_dirs = []
    for sp in roots:
        for d in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
            if d not in seen and os.path.isdir(d):
                seen.add(d)
                path_dirs.append(d)
                try:
                    os.add_dll_directory(d)
                except Exception:
                    pass
    # cuDNN 8 (used by the pinned GPU venv) is split into sub-DLLs that its
    # loader stub cudnn64_8.dll pulls in with a plain LoadLibrary — that ignores
    # os.add_dll_directory and only searches PATH + its own folder. So also put
    # the nvidia bin dirs on PATH. Harmless on the CPU venv (libs go unused).
    if path_dirs:
        os.environ["PATH"] = os.pathsep.join(path_dirs) + os.pathsep + os.environ.get("PATH", "")


add_cuda_dll_dirs()

try:
    from faster_whisper import WhisperModel
except Exception as e:  # pragma: no cover
    print("ERROR: faster-whisper is not installed in this environment.")
    print("       Install with:  pip install -r requirements.txt")
    print(f"       ({e})")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Time formatting
# ---------------------------------------------------------------------------
def fmt_srt(seconds):
    if seconds < 0:
        seconds = 0
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def fmt_mmss(seconds):
    total = int(seconds)
    m, s = divmod(total, 60)
    return f"{m:02d}_{s:02d}"  # 00_23  (matches /chatgpt-images file naming)


def fmt_mmss_colon(seconds):
    total = int(seconds)
    m, s = divmod(total, 60)
    return f"{m:02d}:{s:02d}"  # 00:23  (timestamp column in prompts file)


# ---------------------------------------------------------------------------
# Cue building (optionally re-split long segments using word timestamps)
# ---------------------------------------------------------------------------
class Cue:
    __slots__ = ("start", "end", "text")

    def __init__(self, start, end, text):
        self.start = start
        self.end = end
        self.text = text


def build_cues(segments, max_chars, max_dur):
    cues = []
    for seg in segments:
        words = getattr(seg, "words", None)
        if not max_chars or not words:
            cues.append(Cue(seg.start, seg.end, seg.text.strip()))
            continue
        cur, cur_start = [], None
        for w in words:
            if cur_start is None:
                cur_start = w.start
            tentative = ("".join(cur) + w.word).strip()
            too_long = len(tentative) > max_chars
            too_far = max_dur and (w.end - cur_start) > max_dur
            if cur and (too_long or too_far):
                cues.append(Cue(cur_start, prev_end, "".join(cur).strip()))
                cur, cur_start = [w.word], w.start
            else:
                cur.append(w.word)
            prev_end = w.end
        if cur:
            cues.append(Cue(cur_start, prev_end, "".join(cur).strip()))
    return [c for c in cues if c.text]


# ---------------------------------------------------------------------------
# Model loading with graceful GPU -> CPU fallback
# ---------------------------------------------------------------------------
def load_model(model_name, device, compute_type):
    if device != "auto":
        candidates = [(device, compute_type or ("float16" if device == "cuda" else "int8"))]
    elif compute_type:
        candidates = [("cuda", compute_type), ("cpu", "int8")]
    else:
        candidates = [
            ("cuda", "float16"),       # ~5 GB VRAM on large-v3
            ("cuda", "int8_float16"),  # ~3 GB VRAM, fits even with other apps open
            ("cpu", "int8"),           # always works, slower
        ]
    last_err = None
    for dev, ct in candidates:
        try:
            print(f"Loading model '{model_name}' on {dev} ({ct})...", flush=True)
            m = WhisperModel(model_name, device=dev, compute_type=ct)
            print(f"  -> using {dev} / {ct}", flush=True)
            return m, dev, ct
        except Exception as e:
            last_err = e
            print(f"  -> {dev}/{ct} unavailable: {str(e).splitlines()[0][:140]}", flush=True)
    raise RuntimeError(f"Could not load model on any device. Last error: {last_err}")


def extract_audio(src):
    """Fallback: pull a 16 kHz mono wav out of a container with ffmpeg."""
    fd, wav = tempfile.mkstemp(suffix=".wav", prefix="transcribe_")
    os.close(fd)
    subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", wav],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return wav


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="GPU faster-whisper -> SRT")
    ap.add_argument("input", nargs="?", help="Audio or video file (optional with --project)")
    ap.add_argument("-o", "--out", help="Output .srt path (default: <input>.srt next to input)")
    ap.add_argument("--outdir", help="Directory for outputs (default: input's folder)")
    ap.add_argument("--project", help="Single project folder: reads its audio if no input, writes <slug>.{srt,txt} into it")
    ap.add_argument("--model", default="large-v3",
                    help="large-v3 (default), distil-large-v3, medium, small, ...")
    # Default CPU: reliable everywhere. CUDA currently hangs at the encoder on
    # this Windows + CTranslate2 4.8 + cuDNN 9 combo (model loads, first compute
    # call deadlocks). Pass --device cuda to try the GPU path.
    ap.add_argument("--device", default="cpu", choices=["auto", "cuda", "cpu"])
    ap.add_argument("--compute-type", default=None,
                    help="float16 | int8_float16 | int8 (default: auto-pick)")
    ap.add_argument("--language", default=None, help="Force language code (default: auto-detect)")
    ap.add_argument("--task", default="transcribe", choices=["transcribe", "translate"])
    ap.add_argument("--beam-size", type=int, default=5)
    ap.add_argument("--no-vad", action="store_true", help="Disable voice-activity filtering")
    # condition_on_previous_text defaults OFF: feeding prior text forward lets a
    # single hallucinated/looped segment cascade into pages of garbage (repeated
    # lines, foreign-script gibberish) on long narration. Off = each window
    # decodes independently. Pass --condition-prev to restore Whisper's default.
    ap.add_argument("--condition-prev", action="store_true",
                    help="Condition each window on previously decoded text (Whisper default; risks hallucination cascades)")
    ap.add_argument("--words", action="store_true", help="Compute word-level timestamps")
    ap.add_argument("--max-chars", type=int, default=0,
                    help="Re-split cues to <= N chars (implies --words). 0 = keep Whisper's segments")
    ap.add_argument("--max-dur", type=float, default=7.0, help="Max cue seconds when --max-chars is set")
    ap.add_argument("--txt", action="store_true", help="Also write a plain-text transcript")
    ap.add_argument("--prompts", action="store_true",
                    help="Also write a `MM:SS | text` file for /chatgpt-images")
    args = ap.parse_args()

    project_root = project_slug = None
    if args.project:
        project_root, project_slug = ensure_project(args.project)
        if not args.input:  # auto-find the narration audio in the project folder
            exts = (".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus")
            cands = sorted(f for f in (os.listdir(project_root) if os.path.isdir(project_root) else [])
                           if f.lower().endswith(exts))
            pick = next((f for f in cands if f.startswith(project_slug)), cands[0] if cands else None)
            if pick:
                args.input = os.path.join(project_root, pick)

    if not args.input:
        print("ERROR: an input file is required (or --project with an audio file in the folder).")
        sys.exit(1)
    src = os.path.abspath(args.input)
    if not os.path.isfile(src):
        print(f"ERROR: input not found: {src}")
        sys.exit(1)

    stem = os.path.splitext(os.path.basename(src))[0]
    if args.out:
        base = os.path.splitext(os.path.abspath(args.out))[0]  # -o sets all output names
    elif project_root:
        base = os.path.join(project_root, project_slug)  # <slug>.{srt,txt} in the project folder
    else:
        outdir = os.path.abspath(args.outdir) if args.outdir else os.path.dirname(src)
        base = os.path.join(outdir, stem)
    os.makedirs(os.path.dirname(base) or ".", exist_ok=True)
    srt_path = base + ".srt"
    txt_path = base + ".txt"
    prompts_path = base + ".prompts.txt"

    want_words = args.words or args.max_chars > 0

    model, dev, ct = load_model(args.model, args.device, args.compute_type)

    def run(path):
        return model.transcribe(
            path,
            language=args.language,
            task=args.task,
            beam_size=args.beam_size,
            vad_filter=not args.no_vad,
            word_timestamps=want_words,
            condition_on_previous_text=args.condition_prev,
        )

    print(f"Transcribing: {src}", flush=True)
    try:
        seg_iter, info = run(src)
    except Exception as e:
        print(f"  direct decode failed ({str(e).splitlines()[0][:100]}); extracting audio via ffmpeg...")
        wav = extract_audio(src)
        try:
            seg_iter, info = run(wav)
        finally:
            pass  # leave temp wav; OS tmp will be cleaned eventually

    print(f"  language: {info.language} ({info.language_probability:.2f})  "
          f"duration: {info.duration:.1f}s", flush=True)

    # Iterating the generator is where transcription actually happens.
    segments = []
    for seg in seg_iter:
        segments.append(seg)
        print(f"  [{fmt_srt(seg.start)} -> {fmt_srt(seg.end)}] {seg.text.strip()}", flush=True)

    cues = build_cues(segments, args.max_chars, args.max_dur)
    if not cues:
        print("WARNING: no speech detected — nothing written.")
        sys.exit(2)

    # --- write SRT ---
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, c in enumerate(cues, 1):
            f.write(f"{i}\n{fmt_srt(c.start)} --> {fmt_srt(c.end)}\n{c.text}\n\n")
    outputs = [srt_path]

    if args.txt:
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(" ".join(c.text for c in cues).strip() + "\n")
        outputs.append(txt_path)

    if args.prompts:
        with open(prompts_path, "w", encoding="utf-8") as f:
            f.write(f"video: {stem}\n")
            for c in cues:
                f.write(f"{fmt_mmss_colon(c.start)} | {c.text}\n")
        outputs.append(prompts_path)

    print(f"\nDone. {len(cues)} cues on {dev}/{ct}.")
    for p in outputs:
        print(f"  -> {p}")


if __name__ == "__main__":
    main()
