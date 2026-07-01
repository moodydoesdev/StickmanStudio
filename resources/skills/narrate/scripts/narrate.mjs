#!/usr/bin/env node
// narrate: turn a narration script (.txt) into an ElevenLabs voiceover MP3.
// No deps — Node built-in fetch + ffmpeg (for stitching multi-chunk audio).
//
//   node narrate.mjs --input script.txt [--out name.mp3] [options]
//
// API key resolution order: ELEVENLABS_API_KEY env -> .env in cwd -> ~/.elevenlabs/api_key
// (the file the `elevenlabs auth login` CLI writes). The key is never stored here.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// No narrator voice is bundled. Pick one from your ElevenLabs Voice Library and
// pass it with --voice <id>, or set the ELEVENLABS_VOICE_ID environment variable.
const ENV_VOICE = (process.env.ELEVENLABS_VOICE_ID || "").trim();
const API = "https://api.elevenlabs.io/v1/text-to-speech";

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

// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const a = {
    input: null,
    out: null,
    voice: ENV_VOICE || null,
    model: "eleven_v3",
    stability: 0.5,
    similarity: 0.75,
    style: 0.0,
    speed: 1.0,
    speakerBoost: true,
    format: "mp3_44100_128",
    maxChars: null, // resolved by model: v3 fits ~one request, v2 chunks smaller
    project: null,
    dryRun: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    switch (k) {
      case "--input": case "-i": a.input = next(); break;
      case "--out": case "-o": a.out = next(); break;
      case "--voice": case "-v": a.voice = next(); break;
      case "--model": a.model = next(); break;
      case "--stability": a.stability = Number(next()); break;
      case "--similarity": a.similarity = Number(next()); break;
      case "--style": a.style = Number(next()); break;
      case "--speed": a.speed = Number(next()); break;
      case "--no-speaker-boost": a.speakerBoost = false; break;
      case "--format": a.format = next(); break;
      case "--max-chars": a.maxChars = Number(next()); break;
      case "--project": a.project = next(); break;
      case "--dry-run": a.dryRun = true; break;
      case "--help": case "-h": a.help = true; break;
      default:
        if (!a.input && !k.startsWith("-")) a.input = k;
        else console.error(`Unknown arg: ${k}`);
    }
  }
  return a;
}

const HELP = `narrate — ElevenLabs voiceover from a script file

  node narrate.mjs --input <script.txt> [options]

Options
  --out, -o <file>     Output MP3 (default: <script>.mp3 next to the input).
  --voice, -v <id>     ElevenLabs voice ID (REQUIRED; or set ELEVENLABS_VOICE_ID).
  --model <id>         TTS model (default: eleven_v3).
  --stability <0-1>    Voice stability (v3 snaps to 0/0.5/1; default 0.5 = Natural).
  --similarity <0-1>   Similarity boost (default 0.75).
  --style <0-1>        Style exaggeration (default 0).
  --speed <0.7-1.2>    Speaking speed (default 1.0).
  --no-speaker-boost   Disable speaker boost.
  --format <fmt>       Output format (default mp3_44100_128).
  --max-chars <n>      Chunk size for long scripts (default 2800).
  --project <name>     Project folder: reads script/ if no input, writes audio/<slug>.mp3.
  --dry-run            Show the chunk plan + character count; no API calls.
`;

// ---------------------------------------------------------------------------
function resolveKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  try {
    const env = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
    const m = env.match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  try {
    const k = fs.readFileSync(path.join(os.homedir(), ".elevenlabs", "api_key"), "utf8").trim();
    if (k) return k;
  } catch {}
  return null;
}

// Split into chunks <= maxChars on paragraph, then sentence, boundaries.
function chunkText(text, maxChars) {
  const paras = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  let cur = "";
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ""; };
  for (const p of paras) {
    if (p.length > maxChars) {
      const sents = p.match(/[^.!?]+[.!?]+["')\]]*\s*|.+$/g) || [p];
      for (const s of sents) {
        if (cur && (cur + " " + s).length > maxChars) push();
        cur = cur ? cur + " " + s.trim() : s.trim();
      }
    } else {
      if (cur && (cur + "\n\n" + p).length > maxChars) push();
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  push();
  return chunks;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildVoiceSettings(opts) {
  if (/eleven_v3/i.test(opts.model)) {
    // v3 stability is discrete: 0 = Creative, 0.5 = Natural, 1 = Robust.
    // v3 ignores the v2 similarity/style/speed knobs, so don't send them.
    const snap = [0, 0.5, 1].reduce(
      (a, b) => (Math.abs(b - opts.stability) < Math.abs(a - opts.stability) ? b : a),
      0.5
    );
    return { stability: snap, use_speaker_boost: opts.speakerBoost };
  }
  return {
    stability: opts.stability,
    similarity_boost: opts.similarity,
    style: opts.style,
    use_speaker_boost: opts.speakerBoost,
    speed: opts.speed,
  };
}

async function ttsChunk(key, opts, text, prevText, nextText, outPath) {
  const body = {
    text,
    model_id: opts.model,
    voice_settings: buildVoiceSettings(opts),
  };
  // v3 doesn't support previous_text/next_text yet — only send them for v2 models.
  if (!/eleven_v3/i.test(opts.model)) {
    if (prevText) body.previous_text = prevText;
    if (nextText) body.next_text = nextText;
  }

  const url = `${API}/${opts.voice}?output_format=${encodeURIComponent(opts.format)}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(outPath, buf);
      return buf.length;
    }
    const errText = await res.text().catch(() => "");
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(30, 2 ** attempt) * 1000;
      console.log(`  HTTP ${res.status}, retry ${attempt}/3 in ${wait / 1000}s — ${errText.slice(0, 160)}`);
      await sleep(wait);
      continue;
    }
    throw new Error(`ElevenLabs HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
  throw new Error("Exhausted retries calling ElevenLabs.");
}

function ffmpegConcat(parts, outPath) {
  const listPath = outPath + ".concat.txt";
  fs.writeFileSync(
    listPath,
    parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
  );
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  fs.rmSync(listPath, { force: true });
  if (r.status !== 0) {
    throw new Error("ffmpeg concat failed:\n" + (r.stderr ? r.stderr.toString().slice(-500) : ""));
  }
}

// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(HELP); return; }

  let project = args.project ? ensureProject(args.project) : null;
  // In project mode with no explicit input, pull the script (a *.script.txt) from
  // the project folder.
  if (!args.input && project) {
    const cands = findIn(project.root, /\.script\.txt$/i);
    const pick = cands.find((f) => f.startsWith(project.slug)) || cands[0];
    if (pick) args.input = path.join(project.root, pick);
  }

  if (!args.input) { console.error("Error: --input <script.txt> is required (or --project with a *.script.txt file).\n"); console.log(HELP); process.exit(1); }
  if (!fs.existsSync(args.input)) { console.error(`Error: input not found: ${args.input}`); process.exit(1); }

  const text = fs.readFileSync(args.input, "utf8").replace(/\r\n/g, "\n").trim();
  if (!text) { console.error("Error: input file is empty."); process.exit(1); }

  // Resolve chunk size by model unless the user set it. v3 supports large
  // requests, so keep the whole script in one seamless generation when it fits.
  if (args.maxChars == null) args.maxChars = /eleven_v3/i.test(args.model) ? 4500 : 2800;

  const stem = path.basename(args.input).replace(/\.[^.]+$/, "");
  const outPath = path.resolve(
    args.out ||
    (project
      ? path.join(project.root, project.slug + ".mp3")
      : path.join(path.dirname(path.resolve(args.input)), stem + ".mp3"))
  );

  const chunks = chunkText(text, args.maxChars);
  const totalChars = text.length;
  console.log(`Script: ${args.input}`);
  console.log(`Characters: ${totalChars} (~${totalChars} ElevenLabs credits)`);
  console.log(`Voice: ${args.voice}   Model: ${args.model}`);
  console.log(`Chunks: ${chunks.length} (max ${args.maxChars} chars each)`);
  chunks.forEach((c, i) => console.log(`  [${i + 1}] ${c.length} chars — "${c.slice(0, 60).replace(/\n/g, " ")}..."`));
  console.log(`Output: ${outPath}`);
  if (args.dryRun) { console.log("\nDry run — no API calls made."); return; }

  if (!args.voice) {
    console.error("Error: no narrator voice set. Pass --voice <id> or set ELEVENLABS_VOICE_ID.");
    console.error("  Find a voice ID in your ElevenLabs Voice Library (Voices → a voice → ID).");
    process.exit(1);
  }

  const key = resolveKey();
  if (!key) {
    console.error("Error: no ElevenLabs API key found.");
    console.error("  Set ELEVENLABS_API_KEY, add it to .env, or run: elevenlabs auth login");
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "narrate-"));
  const parts = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      const partPath = path.join(tmpDir, `part_${String(i + 1).padStart(3, "0")}.mp3`);
      const prev = i > 0 ? chunks[i - 1].slice(-400) : "";
      const nextT = i < chunks.length - 1 ? chunks[i + 1].slice(0, 400) : "";
      process.stdout.write(`Generating chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)... `);
      const bytes = await ttsChunk(key, args, chunks[i], prev, nextT, partPath);
      console.log(`${(bytes / 1024).toFixed(0)} KB`);
      parts.push(partPath);
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (parts.length === 1) fs.copyFileSync(parts[0], outPath);
    else ffmpegConcat(parts, outPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`\nDone. Wrote ${outPath} (${kb} KB).`);
}

main().catch((e) => { console.error("Fatal:", e.message || e); process.exit(1); });
