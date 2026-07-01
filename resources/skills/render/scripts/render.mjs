#!/usr/bin/env node
// render: combine a narration audio track + a folder of timestamp-named images
// into one synced slideshow video, using the image timestamps for timing.
//
// Images are named by timestamp (00_00.png, 00_06.png, ...), exactly what the
// chatgpt-images skill produces. Each image is shown from its timestamp until
// the next image's timestamp; the last image runs until the audio ends.
//
// Usage:
//   node render.mjs --audio narration.mp3 --images ./my-video
//   node render.mjs -a narration.mp3 -i ./imgs --crossfade 0.4 --out final.mp4
//
// Requires ffmpeg + ffprobe on PATH.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const a = {
    audio: null,
    images: null,
    project: null,      // project folder: auto-fills images/audio/out + (video/<slug>.mp4)
    prompts: null,      // optional: a prompts/SRT file (used for captions only)
    captions: null,     // optional: an .srt to burn in
    align: null,        // snap cuts to transcript cue starts (auto in --project mode); false = off
    alignTol: 1.5,      // max seconds an image start may be nudged when snapping
    breath: 0,          // move each cut up to N sec into the pause BEFORE the line (0 = off)
    silenceThresh: -30, // dB threshold for pause detection
    silenceMin: 0.12,   // min pause length (sec) to count
    out: null,
    size: "1920x1080",
    fps: 30,
    crossfade: 0,       // seconds; 0 = hard cuts
    fade: 0.5,          // overall fade in/out seconds (0 = none)
    crf: 18,
    preset: "medium",
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    switch (k) {
      case "--audio": case "-a": a.audio = next(); break;
      case "--images": case "-i": a.images = next(); break;
      case "--project": a.project = next(); break;
      case "--prompts": case "-p": a.prompts = next(); break;
      case "--captions": a.captions = next(); break;
      case "--align": a.align = next(); break;
      case "--no-align": a.align = false; break;
      case "--align-tol": a.alignTol = Number(next()); break;
      case "--breath": a.breath = Math.max(0, Number(next()) || 0); break;
      case "--silence-thresh": a.silenceThresh = Number(next()); break;
      case "--silence-min": a.silenceMin = Number(next()); break;
      case "--out": case "-o": a.out = next(); break;
      case "--size": a.size = next(); break;
      case "--fps": a.fps = Number(next()); break;
      case "--crossfade": a.crossfade = Math.max(0, Number(next()) || 0); break;
      case "--fade": a.fade = Math.max(0, Number(next()) || 0); break;
      case "--crf": a.crf = Number(next()); break;
      case "--preset": a.preset = next(); break;
      case "--dry-run": a.dryRun = true; break;
      case "--help": case "-h": a.help = true; break;
      default:
        if (!a.images && !k.startsWith("-")) a.images = k;
        else console.error(`Unknown arg: ${k}`);
    }
  }
  return a;
}

const HELP = `render — combine audio + timestamped images into one synced video

  node render.mjs --audio <file> --images <dir> [options]

Required
  --audio, -a <file>     Narration audio (mp3/wav/m4a/...). Auto-detected if a
                         single audio file sits in the images dir or cwd.
  --images, -i <dir>     Folder of timestamp-named images (00_00.png, 00_06.png …).

Options
  --project <name>       Single project folder: uses its images + audio, writes <slug>.mp4 into it.
  --out, -o <file>       Output video (default: <images-dir>.mp4 in cwd).
  --size <WxH>           Canvas size (default 1920x1080).
  --fps <n>              Frames per second (default 30).
  --crossfade <sec>      Crossfade between images (default 0 = hard cuts). Try 0.4.
  --fade <sec>           Overall fade in/out (default 0.5; 0 = none).
  --captions <file.srt>  Burn subtitles from an SRT file.
  --align <file.srt>     Snap each image cut to the nearest transcript cue start
                         (sub-second sync). Auto-on in --project mode using the
                         project's <slug>.srt. Use --no-align to disable.
  --align-tol <sec>      Max nudge when snapping a cut (default 1.5).
  --breath <sec>         Move each cut up to this far into the silent pause BEFORE
                         the line, so images change on the breath, not the first
                         word (default 0 = off). Needs --align; try 0.4.
  --silence-thresh <dB>  Pause-detection threshold (default -30).
  --silence-min <sec>    Min pause length to count as a pause (default 0.12).
  --crf <n>              x264 quality, lower=better (default 18).
  --preset <p>           x264 preset (default medium).
  --dry-run              Show timings + the ffmpeg command, don't render.

Timing comes from the image filenames (mm_ss). Each image shows from its
timestamp to the next; the last runs until the audio ends.
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
function log(...args) { console.log(`[${now()}]`, ...args); }

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i;

// Single flat project folder: everything for a video lives directly in <project>/,
// distinguished by filename — no per-stage subfolders.
function ensureProject(arg) {
  const root = path.resolve(process.cwd(), arg);
  fs.mkdirSync(root, { recursive: true });
  return { root, slug: path.basename(root) };
}
function findIn(dir, re) {
  try { return fs.readdirSync(dir).filter((f) => re.test(f)).sort(); } catch { return []; }
}

function findExe(name) {
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      for (const cand of [path.join(dir, name + e.toLowerCase()), path.join(dir, name + e)]) {
        if (fs.existsSync(cand)) return cand;
      }
    }
  }
  return name;
}

// Parse "mm_ss" (optionally with an index prefix like 001_) from a filename.
function tsFromName(file) {
  const m = path.basename(file).match(/(\d{1,2})_(\d{2})\.[a-z]+$/i);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function probeDuration(ffprobe, file) {
  const r = spawnSync(ffprobe, [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ], { encoding: "utf8" });
  const d = parseFloat((r.stdout || "").trim());
  return Number.isFinite(d) ? d : null;
}

// Detect silent pauses in the audio via ffmpeg silencedetect → [{start,end}].
function detectSilences(ffmpeg, audio, threshDb, minDur) {
  const r = spawnSync(ffmpeg, [
    "-hide_banner", "-i", audio,
    "-af", `silencedetect=noise=${threshDb}dB:d=${minDur}`,
    "-f", "null", "-",
  ], { encoding: "utf8" });
  const out = (r.stderr || "") + (r.stdout || "");
  const sil = []; let cur = null;
  for (const m of out.matchAll(/silence_(start|end):\s*(-?[0-9.]+)/g)) {
    if (m[1] === "start") cur = parseFloat(m[2]);
    else if (cur != null) { sil.push({ start: cur, end: parseFloat(m[2]) }); cur = null; }
  }
  return sil;
}

// ffmpeg path escaping for the subtitles filter (Windows drive colons etc.).
function escapeForSubtitles(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(HELP); return; }

  const ffmpeg = findExe("ffmpeg");
  const ffprobe = findExe("ffprobe");

  // Project mode: images, audio, and output all live in the single project folder.
  let project = args.project ? ensureProject(args.project) : null;
  if (project) {
    if (!args.images) args.images = project.root;
    if (!args.audio) {
      const hits = findIn(project.root, AUDIO_EXT).map((f) => path.join(project.root, f));
      args.audio = hits.find((f) => path.basename(f).startsWith(project.slug)) || hits[0] || null;
    }
    if (!args.out) args.out = path.join(project.root, project.slug + ".mp4");
  }

  // Resolve images dir
  const imagesDir = path.resolve(args.images || process.cwd());
  if (!fs.existsSync(imagesDir) || !fs.statSync(imagesDir).isDirectory()) {
    console.error(`Error: images dir not found: ${imagesDir}`); process.exit(1);
  }

  // Collect + time-sort images
  const imgs = fs.readdirSync(imagesDir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => ({ file: path.join(imagesDir, f), ts: tsFromName(f) }))
    .filter((x) => x.ts !== null)
    .sort((a, b) => a.ts - b.ts);
  if (!imgs.length) {
    console.error(`Error: no timestamp-named images (e.g. 00_06.png) found in ${imagesDir}`); process.exit(1);
  }

  // Resolve audio (explicit, else auto-detect one audio file near images/cwd)
  let audio = args.audio ? path.resolve(args.audio) : null;
  if (!audio) {
    for (const dir of [imagesDir, process.cwd()]) {
      const hits = fs.readdirSync(dir).filter((f) => AUDIO_EXT.test(f)).map((f) => path.join(dir, f));
      if (hits.length === 1) { audio = hits[0]; break; }
      if (hits.length > 1) {
        console.error(`Error: multiple audio files in ${dir} — pass one with --audio:\n  ${hits.join("\n  ")}`);
        process.exit(1);
      }
    }
  }
  if (!audio || !fs.existsSync(audio)) {
    console.error("Error: no audio file. Pass --audio <file> (mp3/wav/m4a/...).");
    process.exit(1);
  }

  const audioDur = probeDuration(ffprobe, audio);
  if (!audioDur) { console.error(`Error: could not read audio duration of ${audio}`); process.exit(1); }

  // Optional sub-second alignment: image filenames carry only whole-second
  // timestamps (mm_ss), which makes cuts land up to ~1s before the spoken line.
  // Snap each cut to the nearest transcript cue start to recover real timing.
  let alignSrt = null;
  if (args.align === false) alignSrt = null;                 // explicitly disabled
  else if (typeof args.align === "string") alignSrt = path.resolve(args.align);
  else if (project) {                                        // auto in project mode
    const hit = findIn(project.root, /\.srt$/i).find((f) => f.startsWith(project.slug))
      || findIn(project.root, /\.srt$/i)[0];
    if (hit) alignSrt = path.join(project.root, hit);
  }
  let cueStarts = [];
  if (alignSrt && fs.existsSync(alignSrt)) {
    const srt = fs.readFileSync(alignSrt, "utf8");
    for (const m of srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d{3})\s*-->/g))
      cueStarts.push(+m[1] * 3600 + +m[2] * 60 + +m[3] + (+m[4]) / 1000);
    cueStarts.sort((a, b) => a - b);
  }

  // Optional "cut on the breath": detect silent pauses so each cut can land in
  // the pause BEFORE its line rather than on the first word.
  const breathOn = args.breath > 0 && cueStarts.length;
  const silences = breathOn ? detectSilences(ffmpeg, audio, args.silenceThresh, args.silenceMin) : [];

  // Compute per-image start (first image always 0), snapping to cue starts when
  // a cue is within tolerance, and keeping starts strictly increasing.
  let aligned = 0, shiftSum = 0, breathed = 0, breathSum = 0;
  const starts = [];
  for (let i = 0; i < imgs.length; i++) {
    let s = i === 0 ? 0 : imgs[i].ts;
    let snapped = false;
    if (i > 0 && cueStarts.length) {
      let best = null, bd = Infinity;
      for (const c of cueStarts) { const d = Math.abs(c - imgs[i].ts); if (d < bd) { bd = d; best = c; } }
      if (best != null && bd <= args.alignTol) { aligned++; shiftSum += best - s; s = best; snapped = true; }
    }
    if (breathOn && snapped) {
      // the pause whose END coincides with this line's first word
      let gap = null, bd = Infinity;
      for (const sil of silences) { const d = Math.abs(sil.end - s); if (sil.start < s && d < bd) { bd = d; gap = sil; } }
      if (gap && bd <= 0.5) {
        const moved = Math.max(gap.start, s - args.breath);
        if (moved < s) { breathed++; breathSum += s - moved; s = moved; }
      }
    }
    if (i > 0) s = Math.max(s, starts[i - 1] + 0.10); // keep cuts strictly increasing
    starts.push(s);
  }
  if (cueStarts.length) {
    const mean = aligned ? shiftSum / aligned : 0;
    log(`Aligned ${aligned}/${imgs.length} cuts to ${path.basename(alignSrt)} (mean shift ${mean >= 0 ? "+" : ""}${mean.toFixed(2)}s)`);
    if (breathOn) log(`Cut on the breath: moved ${breathed} cuts into the pause before the line (avg lead ${(breathed ? breathSum / breathed : 0).toFixed(2)}s)`);
  }

  const durations = starts.map((s, i) =>
    (i < starts.length - 1 ? starts[i + 1] - s : audioDur - s));
  // Guard against bad/zero/negative durations (e.g. audio shorter than last ts).
  for (let i = 0; i < durations.length; i++) {
    if (!(durations[i] > 0.05)) durations[i] = 0.5;
  }

  const [W, H] = args.size.split("x").map((n) => parseInt(n, 10));
  const outFile = path.resolve(args.out || path.join(process.cwd(), path.basename(imagesDir) + ".mp4"));

  log(`Images : ${imgs.length} from ${imagesDir}`);
  log(`Audio  : ${audio}  (${audioDur.toFixed(2)}s)`);
  log(`Canvas : ${W}x${H} @ ${args.fps}fps   crossfade=${args.crossfade}s  fade=${args.fade}s`);
  log(`Output : ${outFile}`);
  imgs.forEach((x, i) =>
    log(`  ${path.basename(x.file)}  start ${starts[i].toFixed(2)}s  dur ${durations[i].toFixed(2)}s`));

  const baseChain = (label) =>
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${args.fps},format=yuv420p,setsar=1${label ? `[${label}]` : ""}`;

  // Optional trailing filters applied to the assembled video stream.
  const tail = [];
  if (args.fade > 0) {
    tail.push(`fade=t=in:st=0:d=${args.fade}`);
    tail.push(`fade=t=out:st=${Math.max(0, audioDur - args.fade).toFixed(3)}:d=${args.fade}`);
  }
  if (args.captions) {
    if (!fs.existsSync(args.captions)) { console.error(`Error: captions file not found: ${args.captions}`); process.exit(1); }
    tail.push(`subtitles='${escapeForSubtitles(path.resolve(args.captions))}'`);
  }

  let ffArgs;
  let cleanup = [];

  if (args.crossfade > 0 && imgs.length > 1) {
    // ---- Crossfade path: one looped input per image, chained xfades. ----
    const cf = args.crossfade;
    const inputs = [];
    imgs.forEach((x, i) => {
      const len = (audioDur - starts[i]) + cf; // long enough to survive to the end
      inputs.push("-loop", "1", "-t", len.toFixed(3), "-i", x.file);
    });
    inputs.push("-i", audio);
    const audioIdx = imgs.length;

    const parts = [];
    imgs.forEach((_, i) => parts.push(`[${i}:v]${baseChain(`s${i}`)}`));
    let last = "s0";
    for (let m = 1; m < imgs.length; m++) {
      const offset = Math.max(0, starts[m] - cf);
      const out = m === imgs.length - 1 ? "vx" : `x${m}`;
      parts.push(`[${last}][s${m}]xfade=transition=fade:duration=${cf}:offset=${offset.toFixed(3)}[${out}]`);
      last = out;
    }
    let vlabel = imgs.length > 1 ? "vx" : "s0";
    if (tail.length) { parts.push(`[${vlabel}]${tail.join(",")}[v]`); vlabel = "v"; }
    const filter = parts.join(";");

    ffArgs = [
      "-y", ...inputs,
      "-filter_complex", filter,
      "-map", `[${vlabel}]`, "-map", `${audioIdx}:a`,
      "-c:v", "libx264", "-crf", String(args.crf), "-preset", args.preset,
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
      "-t", audioDur.toFixed(3), "-movflags", "+faststart", outFile,
    ];
  } else {
    // ---- Hard-cut path: concat demuxer with per-image durations. ----
    const listPath = path.join(imagesDir, "_render_concat.txt");
    const lines = ["ffconcat version 1.0"];
    imgs.forEach((x, i) => {
      lines.push(`file '${x.file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`);
      lines.push(`duration ${durations[i].toFixed(3)}`);
    });
    // repeat the last image so its duration is honored by the concat demuxer
    lines.push(`file '${imgs[imgs.length - 1].file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`);
    fs.writeFileSync(listPath, lines.join("\n"));
    cleanup.push(listPath);

    const vchain = `[0:v]${baseChain("")}${tail.length ? "," + tail.join(",") : ""}[v]`;
    ffArgs = [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-i", audio,
      "-filter_complex", vchain,
      "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-crf", String(args.crf), "-preset", args.preset,
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
      "-shortest", "-movflags", "+faststart", outFile,
    ];
  }

  if (args.dryRun) {
    log("Dry run — ffmpeg command:");
    console.log("ffmpeg " + ffArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "));
    cleanup.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    return;
  }

  log("Rendering with ffmpeg...");
  const r = spawnSync(ffmpeg, ffArgs, { stdio: "inherit" });
  cleanup.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
  if (r.status !== 0) { console.error(`\nffmpeg failed (exit ${r.status}).`); process.exit(1); }

  const sz = fs.existsSync(outFile) ? (fs.statSync(outFile).size / (1024 * 1024)).toFixed(1) : "?";
  log(`\n✓ Done. Wrote ${outFile} (${sz} MB)`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
