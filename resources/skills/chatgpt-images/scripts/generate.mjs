#!/usr/bin/env node
// chatgpt-images (OpenAI engine): batch-generate images from a list of
// "timestamp | prompt" lines by calling the `openai images generate` CLI.
// No browser, no login, no Cloudflare — just the OpenAI image API.
//
// Runs several requests in parallel (see --concurrency).
//
// Usage:
//   node generate.mjs --input prompts.txt --out "./my-videos" [--concurrency 4]
//
// Auth: uses OPENAI_API_KEY from the environment. On Windows it also falls back
// to the User-scope env var if the process didn't inherit it.

import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// Single flat project folder: everything for a video lives directly in <project>/
// (script, audio, srt, prompts, images, mp4, ...), distinguished by filename — no
// per-stage subfolders.
function ensureProject(arg) {
  const root = path.resolve(process.cwd(), arg);
  fs.mkdirSync(root, { recursive: true });
  return { root, slug: path.basename(root) };
}
function findIn(dir, re) {
  try { return fs.readdirSync(dir).filter((f) => re.test(f)).sort(); } catch { return []; }
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const a = {
    input: null,
    out: process.cwd(),
    video: null,
    project: null,
    model: "gpt-image-2",
    size: "1536x864",      // 16:9 for video b-roll; any WxH divisible by 16
    quality: "auto",        // auto | high | medium | low
    moderation: "low",      // low | auto
    concurrency: 4,         // how many images to generate at once
    maxRetries: 3,
    retryWait: 20,          // seconds to wait on a rate-limit before retrying
    priceIn: Number(process.env.OPENAI_PRICE_IN) || 5,    // USD / 1M input (text) tokens
    priceOut: Number(process.env.OPENAI_PRICE_OUT) || 40, // USD / 1M output (image) tokens
    overwrite: false,
    dryRun: false,
    indexPrefix: false,
    namePrefix: "",        // prepended to every output filename + the manifest name
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    switch (k) {
      case "--input": case "-i": a.input = next(); break;
      case "--out": case "-o": a.out = next(); break;
      case "--video": case "-v": a.video = next(); break;
      case "--project": a.project = next(); break;
      case "--model": a.model = next(); break;
      case "--size": a.size = next(); break;
      case "--quality": a.quality = next(); break;
      case "--moderation": a.moderation = next(); break;
      case "--concurrency": case "-c": a.concurrency = Math.max(1, Math.min(16, Number(next()) || 1)); break;
      case "--max-retries": a.maxRetries = Number(next()); break;
      case "--price-in": a.priceIn = Number(next()); break;
      case "--price-out": a.priceOut = Number(next()); break;
      case "--overwrite": a.overwrite = true; break;
      case "--dry-run": a.dryRun = true; break;
      case "--index-prefix": a.indexPrefix = true; break;
      case "--name-prefix": a.namePrefix = next() || ""; break;
      case "--help": case "-h": a.help = true; break;
      default:
        if (!a.input && !k.startsWith("-")) a.input = k;
        else console.error(`Unknown arg: ${k}`);
    }
  }
  return a;
}

const HELP = `chatgpt-images (OpenAI engine) — batch image generation via the openai CLI

  node generate.mjs --input <file> [options]

Required
  --input, -i <file>     Text file of "timestamp | prompt" lines.

Options
  --out, -o <dir>        Base output dir (default: cwd). Images go to <out>/<video>/.
  --video, -v <name>     Video/folder name. Default: "video:" line in file, else filename.
  --project <name>       Project folder: reads prompts/ if no input, writes images to images/.
  --model <m>            OpenAI image model (default gpt-image-2).
  --size <WxH>           Image size (default 1536x864). Portrait e.g. 1024x1536.
  --quality <q>          auto | high | medium | low (default auto).
  --moderation <m>       low | auto (default low — fewer false refusals).
  --concurrency, -c <n>  Images to generate in parallel, 1-16 (default 4).
  --max-retries <n>      Retries per image on rate-limit/transient errors (default 3).
  --price-in <usd>       USD per 1M input (text) tokens, for the cost estimate (default 5).
  --price-out <usd>      USD per 1M output (image) tokens, for the cost estimate (default 40).
  --overwrite            Regenerate even if the output file already exists.
  --index-prefix         Name files 001_<ts>.png. Default names them <ts>.png.
  --name-prefix <p>      Prepend <p> to every output filename + the manifest (e.g.
                         "myvid.thumb-" → myvid.thumb-01.png), so several batches
                         can share one folder without colliding.
  --dry-run              Parse + plan only; don't call the API.
`;

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------
function parseInput(text) {
  let video = null;
  const items = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const vm = line.match(/^#?\s*video\s*[:=]\s*(.+)$/i);
    if (vm) { video = vm[1].trim(); continue; }
    if (line.startsWith("#") || line.startsWith("//")) continue;
    let timestamp, prompt;
    const bar = line.indexOf("|");
    if (bar !== -1) {
      timestamp = line.slice(0, bar).trim();
      prompt = line.slice(bar + 1).trim();
    } else {
      const m = line.match(/^([0-9][0-9:.\-hms]*)\s+(.+)$/i);
      if (m) { timestamp = m[1].trim(); prompt = m[2].trim(); }
      else { timestamp = String(items.length + 1); prompt = line; }
    }
    if (!prompt) continue;
    if (!timestamp) timestamp = String(items.length + 1);
    items.push({ timestamp, prompt });
  }
  return { video, items };
}

function sanitize(s) {
  return s.replace(/[:.]/g, "-").replace(/[\\/<>"|?*\s]+/g, "-")
    .replace(/-+/g, "-").replace(/^-|-$/g, "") || "img";
}
function tsToFile(ts) {
  return String(ts).trim().replace(/[:.]/g, "_").replace(/[\\/<>"|?*\s]+/g, "_")
    .replace(/_+/g, "_").replace(/^_|_$/g, "") || "img";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
function log(...args) { console.log(`[${now()}]`, ...args); }

// ---------------------------------------------------------------------------
// Resolve the API key and the openai executable
// ---------------------------------------------------------------------------
function resolveApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (process.platform === "win32") {
    try {
      const reg = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
      const r = spawnSync(reg, ["query", "HKCU\\Environment", "/v", "OPENAI_API_KEY"], { encoding: "utf8" });
      const m = r.stdout && r.stdout.match(/OPENAI_API_KEY\s+REG_\w+\s+(.+)/);
      if (m) return m[1].trim();
    } catch {}
  }
  return null;
}

function findExe(name) {
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = path.join(dir, name + e.toLowerCase());
      const P = path.join(dir, name + e);
      if (fs.existsSync(p)) return p;
      if (fs.existsSync(P)) return P;
    }
  }
  return name; // last resort; spawn may still resolve it
}

// Call the openai CLI once (async). Returns { ok, b64, error }.
async function generateOne(bin, key, { prompt, model, size, quality, moderation }) {
  const args = [
    "images", "generate",
    "--model", model,
    "--prompt", prompt,
    "--size", size,
    "--quality", quality,
    "--moderation", moderation,
    "--output-format", "png",
    "--format", "json",
  ];
  try {
    const { stdout, stderr } = await execFileP(bin, args, {
      maxBuffer: 128 * 1024 * 1024,
      env: { ...process.env, OPENAI_API_KEY: key },
    });
    // Full JSON response so we get both the image AND token usage (for cost).
    let json = null;
    try { json = JSON.parse(stdout); }
    catch {
      const s = stdout.indexOf("{"), e = stdout.lastIndexOf("}");
      if (s >= 0 && e > s) { try { json = JSON.parse(stdout.slice(s, e + 1)); } catch {} }
    }
    const raw = json && json.data && json.data[0] && json.data[0].b64_json;
    if (!raw) {
      return { ok: false, error: `no image in response: ${((stdout || "") + (stderr || "")).slice(0, 300)}` };
    }
    const b64 = raw.replace(/[^A-Za-z0-9+/=]/g, "");
    return { ok: true, b64, usage: json.usage || null };
  } catch (e) {
    const out = ((e.stdout || "") + "\n" + (e.stderr || "") + "\n" + (e.message || "")).trim();
    return { ok: false, error: out.slice(0, 600) };
  }
}

function classifyError(msg) {
  const m = (msg || "").toLowerCase();
  if (/rate.?limit|429|too many requests|please try again/.test(m)) return "ratelimit";
  if (/moderation|safety|content policy|content_policy|rejected|not allowed|violat/.test(m)) return "refusal";
  return "transient";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(HELP); return; }

  let project = args.project ? ensureProject(args.project) : null;
  // In project mode with no explicit input, pull the prompts file from the folder.
  if (!args.input && project) {
    const cands = findIn(project.root, /\.prompts\.txt$/i);
    const pick = cands.find((f) => f.startsWith(project.slug)) || cands[0];
    if (pick) args.input = path.join(project.root, pick);
  }

  if (!args.input) { console.error("Error: --input <file> is required (or --project with a *.prompts.txt file).\n"); console.log(HELP); process.exit(1); }
  if (!fs.existsSync(args.input)) { console.error(`Error: input file not found: ${args.input}`); process.exit(1); }

  const parsed = parseInput(fs.readFileSync(args.input, "utf8"));
  const video = args.video || parsed.video || (project ? project.slug : path.basename(args.input).replace(/\.[^.]+$/, ""));
  if (!parsed.items.length) { console.error("Error: no prompt lines found in input file."); process.exit(1); }

  // Project mode: images go straight into the single project folder.
  const outDir = project ? project.root : path.resolve(args.out, sanitize(video));
  fs.mkdirSync(outDir, { recursive: true });

  const usedNames = new Set();
  const plan = parsed.items.map((it, idx) => {
    const base = args.namePrefix + (args.indexPrefix
      ? `${String(idx + 1).padStart(3, "0")}_${tsToFile(it.timestamp)}`
      : tsToFile(it.timestamp));
    let file = `${base}.png`, n = 2;
    while (usedNames.has(file.toLowerCase())) file = `${base}_${n++}.png`;
    usedNames.add(file.toLowerCase());
    return { ...it, idx, file, path: path.join(outDir, file) };
  });

  const concurrency = Math.min(args.concurrency, plan.length);
  log(`Engine: OpenAI API  (model ${args.model}, size ${args.size}, quality ${args.quality}, concurrency ${concurrency})`);
  log(`Video folder: ${outDir}`);
  log(`Prompts: ${plan.length}`);
  for (const p of plan) log(`  ${p.file}  <-  [${p.timestamp}] ${p.prompt.slice(0, 64)}`);
  if (args.dryRun) { log("Dry run — not calling the API."); return; }

  const key = resolveApiKey();
  if (!key) {
    console.error("Error: OPENAI_API_KEY is not set (env or Windows User scope). Set it and retry.");
    process.exit(1);
  }
  const bin = findExe("openai");

  const manifestPath = path.join(outDir, args.namePrefix ? `${args.namePrefix}manifest.json` : "_manifest.json");
  const manifest = {
    video, outDir, engine: "openai", model: args.model, size: args.size, concurrency,
    items: plan.map((p) => ({ timestamp: p.timestamp, prompt: p.prompt, file: p.file, status: "pending" })),
  };
  const writeManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  writeManifest();

  let done = 0, skipped = 0, failed = 0;
  let totIn = 0, totOut = 0; // accumulated token usage across generated images

  // Process one plan item (with retries), updating its manifest record in place.
  async function processItem(item) {
    const rec = manifest.items[item.idx];
    if (!args.overwrite && fs.existsSync(item.path)) {
      rec.status = "skipped (exists)"; skipped++;
      log(`= [${item.idx + 1}/${plan.length}] ${item.file} exists — skip`);
      writeManifest(); return;
    }
    for (let attempt = 1; attempt <= args.maxRetries; attempt++) {
      log(`▶ [${item.idx + 1}/${plan.length}] ${item.timestamp} — generating (try ${attempt})`);
      const res = await generateOne(bin, key, {
        prompt: item.prompt, model: args.model, size: args.size,
        quality: args.quality, moderation: args.moderation,
      });
      if (res.ok) {
        fs.writeFileSync(item.path, Buffer.from(res.b64, "base64"));
        if (res.usage) {
          const ui = res.usage.input_tokens || 0, uo = res.usage.output_tokens || 0;
          totIn += ui; totOut += uo;
          rec.usage = res.usage;
          rec.cost_est_usd = +(((ui / 1e6) * args.priceIn) + ((uo / 1e6) * args.priceOut)).toFixed(4);
        }
        rec.status = "done"; done++;
        const costStr = rec.cost_est_usd != null ? `, ~$${rec.cost_est_usd.toFixed(4)}` : "";
        log(`✓ [${item.idx + 1}/${plan.length}] saved ${item.file} (${Math.round(fs.statSync(item.path).size / 1024)} KB${costStr})`);
        writeManifest(); return;
      }
      const kind = classifyError(res.error);
      if (kind === "refusal") {
        rec.status = "refused"; rec.error = res.error; failed++;
        log(`✗ [${item.idx + 1}/${plan.length}] Refused (moderation) — skipping: ${res.error.slice(0, 140)}`);
        writeManifest(); return;
      }
      if (attempt < args.maxRetries) {
        const wait = kind === "ratelimit" ? args.retryWait : 3;
        log(`… [${item.idx + 1}/${plan.length}] ${kind} — waiting ${wait}s then retrying: ${res.error.slice(0, 120)}`);
        await sleep(wait * 1000);
      } else {
        rec.status = "failed"; rec.error = res.error; failed++;
        log(`✗ [${item.idx + 1}/${plan.length}] Failed after ${attempt} tries: ${res.error.slice(0, 200)}`);
        writeManifest(); return;
      }
    }
  }

  // Worker pool: up to `concurrency` items in flight at once.
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= plan.length) return;
      await processItem(plan[i]);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const totalCost = ((totIn / 1e6) * args.priceIn) + ((totOut / 1e6) * args.priceOut);
  manifest.usage = { input_tokens: totIn, output_tokens: totOut, total_tokens: totIn + totOut };
  manifest.price_in_per_1m = args.priceIn;
  manifest.price_out_per_1m = args.priceOut;
  manifest.estimated_cost_usd = +totalCost.toFixed(4);
  writeManifest();

  log(`\nDone. ${done} generated, ${skipped} skipped, ${failed} failed.`);
  if (totIn || totOut) {
    log(`Tokens: ${totIn} input + ${totOut} output = ${totIn + totOut} total`);
    log(`Est. cost: $${totalCost.toFixed(4)} for ${done} image(s)` +
      (done ? ` (~$${(totalCost / done).toFixed(4)} each)` : ""));
    log(`  estimate at $${args.priceIn}/$${args.priceOut} per 1M in/out tokens —`);
    log(`  verify current OpenAI pricing; override with --price-in/--price-out.`);
  } else {
    log(`(No token usage returned by the API — no cost estimate available.)`);
  }
  log(`Images: ${outDir}`);
  log(`Manifest: ${manifestPath}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
