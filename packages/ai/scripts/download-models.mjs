// Downloads the image-cleanup weights into the git-ignored models folder and verifies their SHA-256.
//   pnpm --filter @rbms/ai models:download [u2netp|u2net ...]   (default: the configured model only)
// Folder: AI_MODELS_DIR, else <repo>/.models. Licence: Apache-2.0 (U2-Net), see docs/ai.md "Phase 4 part C".
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0";
const MODELS = {
  u2netp: { file: "u2netp.onnx", sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8" },
  u2net: { file: "u2net.onnx", sha256: "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491" },
};
const dir = process.env.AI_MODELS_DIR?.trim() ? resolve(process.env.AI_MODELS_DIR.trim()) : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.models");
const want = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const ids = want.length ? want : [process.env.IMAGE_CLEANUP_MODEL?.trim() || "u2net"];

const sha = async (p) => {
  const h = createHash("sha256");
  await pipeline(createReadStream(p), h);
  return h.digest("hex");
};

mkdirSync(dir, { recursive: true });
let failed = false;
for (const id of ids) {
  const m = MODELS[id];
  if (!m) {
    console.error(`unknown model "${id}" (choose: ${Object.keys(MODELS).join(", ")})`);
    failed = true;
    continue;
  }
  const dest = join(dir, m.file);
  if (existsSync(dest) && (await sha(dest)) === m.sha256) {
    console.log(`${id}: already installed and verified (${dest})`);
    continue;
  }
  console.log(`${id}: downloading ${REL}/${m.file} ...`);
  const res = await fetch(`${REL}/${m.file}`, { redirect: "follow" });
  if (!res.ok || !res.body) {
    console.error(`${id}: download failed (HTTP ${res.status})`);
    failed = true;
    continue;
  }
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const got = await sha(tmp);
  if (got !== m.sha256) {
    rmSync(tmp, { force: true });
    console.error(`${id}: CHECKSUM MISMATCH (expected ${m.sha256}, got ${got}); file removed`);
    failed = true;
    continue;
  }
  renameSync(tmp, dest);
  console.log(`${id}: installed and verified -> ${dest}`);
}
process.exit(failed ? 1 : 0);
