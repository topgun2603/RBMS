// Puts the "Try it on" browser assets on the store's own static path (public/tryon), so shoppers' phones load them from
// the store itself (no third-party host at runtime):
//   - the MediaPipe WebAssembly runtime, copied from the installed @mediapipe/tasks-vision package (Apache-2.0)
//   - face_landmarker.task, downloaded once and checked against its SHA-256 (Apache-2.0 per its model cards, see docs/ai.md)
// Runs before `dev` and `build` (idempotent; offline or failing downloads only warn, the store then hides "Try it on").
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../public/tryon");
const MODEL = {
  file: "face_landmarker.task",
  url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
};
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

mkdirSync(join(out, "wasm"), { recursive: true });

// 1. the wasm runtime
const candidates = [resolve(here, "../../../packages/storefront-ui/node_modules/@mediapipe/tasks-vision/wasm"), resolve(here, "../node_modules/@mediapipe/tasks-vision/wasm")];
const src = candidates.find((d) => existsSync(d));
if (!src) console.warn("tryon-assets: @mediapipe/tasks-vision is not installed; run pnpm install");
else {
  for (const f of readdirSync(src)) copyFileSync(join(src, f), join(out, "wasm", f));
  console.log(`tryon-assets: wasm runtime ready (${readdirSync(src).length} files)`);
}

// 2. the model
const dest = join(out, MODEL.file);
if (existsSync(dest) && sha(dest) === MODEL.sha256) console.log("tryon-assets: face_landmarker.task already installed and verified");
else {
  try {
    const res = await fetch(MODEL.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = createHash("sha256").update(buf).digest("hex");
    if (got !== MODEL.sha256) throw new Error(`checksum mismatch (got ${got})`);
    writeFileSync(`${dest}.part`, buf);
    renameSync(`${dest}.part`, dest);
    console.log("tryon-assets: face_landmarker.task installed and verified");
  } catch (e) {
    console.warn(`tryon-assets: could not install ${MODEL.file} (${e instanceof Error ? e.message : e}). "Try it on" stays hidden until it is there.`);
  }
}
