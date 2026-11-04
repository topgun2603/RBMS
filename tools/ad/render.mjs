// Renders an ad frame by frame and joins it with its mixed sound (run mix.mjs first). Run:
//   node tools/ad/render.mjs en           English first: out/RBMS-ad-english-16x9.mp4 and -9x16.mp4
//   node tools/ad/render.mjs ta           Tamil first: out/RBMS-ad-tamil-16x9.mp4 and -9x16.mp4
//   node tools/ad/render.mjs en stills    one picture per scene instead, to check the layout quickly
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findFfmpeg } from "./ffmpeg.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "out");
const puppeteer = createRequire(join(ROOT, "packages", "documents", "package.json"))("puppeteer-core");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const ADS = {
  ta: { html: "ad.html", sound: "sound-ta.wav", name: "RBMS-ad-tamil", stills: [1.0, 2.6, 4.5, 8.6, 10.9, 13, 16, 18.5, 20.6, 23.8, 26, 29.5] },
  en: { html: "ad-en.html", sound: "sound-en.wav", name: "RBMS-ad-english", stills: [1.6, 4.5, 6.8, 8.6, 11, 14, 15.8, 19.9, 21.0, 21.9, 24, 26, 29.5] },
};
const ad = ADS[process.argv[2]];
if (!ad) throw new Error("say which ad: en or ta");
const mode = process.argv[3];
const FPS = 30, SECONDS = 30;
const FORMATS = [{ name: "16x9", w: 1920, h: 1080 }, { name: "9x16", w: 1080, h: 1920 }];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--allow-file-access-from-files", "--disable-web-security"] });

async function open({ w, h }) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`${pathToFileURL(join(HERE, ad.html)).href}?w=${w}&h=${h}`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(() => window.ready);
  return page;
}

if (mode === "stills") {
  mkdirSync(join(OUT, "stills"), { recursive: true });
  for (const f of FORMATS) {
    const page = await open(f);
    for (const t of ad.stills) {
      await page.evaluate((x) => window.seek(x), t);
      await page.screenshot({ path: join(OUT, "stills", `${process.argv[2]}-${f.name}-${String(t).replace(".", "_")}.jpg`), type: "jpeg", quality: 70 });
    }
    await page.close();
  }
  console.log("stills written");
} else {
  const ffmpeg = findFfmpeg();
  for (const f of FORMATS) {
    const page = await open(f);
    const file = join(OUT, `${ad.name}-${f.name}.mp4`);
    const enc = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-i", join(OUT, ad.sound), "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", String(SECONDS), "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
    const started = Date.now();
    for (let i = 0; i < FPS * SECONDS; i++) {
      await page.evaluate((x) => window.seek(x), i / FPS);
      const shot = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!enc.stdin.write(shot)) await new Promise((r) => enc.stdin.once("drain", r));
      if (i % 150 === 0) console.log(`${f.name}: ${i / FPS} s rendered (${Math.round((Date.now() - started) / 1000)} s elapsed)`);
    }
    enc.stdin.end();
    await new Promise((r) => enc.on("close", r));
    await page.close();
    console.log(`written ${file}`);
  }
}
await browser.close();
process.exit(0);
