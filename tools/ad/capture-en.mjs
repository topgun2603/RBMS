// Films different screens for the English ad (out/clips-en/). Read-only, as capture.mjs: demo sign-ins, stores only browsed.
import { execSync, spawn } from "node:child_process";
import { mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "out", "clips-en");
mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(join(ROOT, "packages", "documents", "package.json"))("puppeteer-core");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = "http://localhost:4000";
const up = (url) => fetch(url, { signal: AbortSignal.timeout(4000) }).then(() => true).catch(() => false);

async function film(page, name, act) {
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.createCDPSession();
  const frames = [];
  const started = Date.now();
  cdp.on("Page.screencastFrame", async (f) => {
    const file = `${String(frames.length).padStart(4, "0")}.jpg`;
    frames.push({ t: (Date.now() - started) / 1000, file });
    writeFileSync(join(dir, file), Buffer.from(f.data, "base64"));
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
  await act();
  await cdp.send("Page.stopScreencast");
  await sleep(200);
  writeFileSync(join(dir, "index.json"), JSON.stringify({ seconds: (Date.now() - started) / 1000, frames }));
  console.log(`${name}: ${frames.length} frames`);
}
const glide = (page, px, ms) => page.evaluate((d, t) => new Promise((done) => {
  const from = window.scrollY;
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / t);
    window.scrollTo({ top: from + d * (k * k * (3 - 2 * k)), behavior: "instant" });
    k < 1 ? requestAnimationFrame(step) : done();
  };
  requestAnimationFrame(step);
}), px, ms);
const CLEAN = "nextjs-portal,[data-nextjs-toast]{display:none!important}html{scroll-behavior:auto!important}";
async function prepare(page) {
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.evaluateOnNewDocument((css, dismissed) => {
    try {
      localStorage.setItem("theme", "light");
      localStorage.setItem("sr_pwa_dismissed", dismissed);
      localStorage.setItem("sr_locale", "en");
    } catch {}
    const add = () => {
      const s = document.createElement("style");
      s.textContent = css;
      document.documentElement.appendChild(s);
    };
    if (document.documentElement) add();
    else document.addEventListener("DOMContentLoaded", add);
  }, CLEAN, String(Date.now()));
}
const signIn = async (shop) => {
  const d = await (await fetch(`${API}/v1/auth/demo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shop }) })).json();
  if (!d.token) throw new Error(`demo sign-in ${shop}: ${JSON.stringify(d).slice(0, 160)}`);
  return d.token;
};

const log = openSync(join(HERE, "out", "apps.log"), "a");
const started = [];
for (const [pkg, port] of [["@rbms/billing", 3001], ["@rbms/store", 3003]]) {
  if (!(await up(`http://localhost:${port}/`))) started.push(spawn(`pnpm --filter ${pkg} exec next dev --turbopack -p ${port}`, { cwd: ROOT, shell: true, stdio: ["ignore", log, log] }));
  for (let i = 0; i < 120 && !(await up(`http://localhost:${port}/`)); i++) await sleep(1000);
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
try {
  const desk = async (shop, base, shots, locale = "en") => {
    const token = await signIn(shop);
    const p = await browser.newPage();
    await p.setViewport({ width: 1440, height: 900 });
    await prepare(p);
    await p.evaluateOnNewDocument((t, s, l) => { localStorage.setItem("sr_token", t); localStorage.setItem("sr_tenant", s); localStorage.setItem("sr_locale", l); }, token, shop, locale);
    for (const [name, path, act] of shots) {
      await p.goto(base + path, { waitUntil: "networkidle2", timeout: 180000 });
      await sleep(1000);
      await p.goto(base + path, { waitUntil: "networkidle2", timeout: 120000 });
      await sleep(900);
      if (act?.before) await act.before(p);
      await film(p, name, async () => {
        await sleep(300);
        await (act?.run ?? ((q) => glide(q, 220, 2200)))(p);
        await sleep(300);
      });
    }
    await p.close();
  };
  const clickText = (text) => async (p) => {
    await p.evaluate((x) => [...document.querySelectorAll("button,a,[role=tab]")].find((e) => e.innerText.trim() === x)?.click(), text);
    await sleep(1500);
  };
  await desk("kumar", "http://kumar.localhost:3001", [
    ["bills", "/invoices"],
    ["stock", "/stock"],
    ["sales", "/reports", { before: clickText("Last month") }],
  ]);
  // The same screen in both languages, held still: the ad wipes from one to the other.
  await desk("kumar", "http://kumar.localhost:3001", [["lang-en", "/reports", { before: clickText("Last month"), run: () => sleep(300) }]]);
  await desk("kumar", "http://kumar.localhost:3001", [["lang-ta", "/reports", { before: clickText("கடந்த மாதம்"), run: () => sleep(300) }]], "ta");
  const s = await browser.newPage();
  await s.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await prepare(s);
  for (const slug of ["arasan", "azhagu", "techzone", "malligai"]) {
    const url = `http://${slug}.localhost:3003/`;
    await s.goto(url, { waitUntil: "networkidle2", timeout: 180000 });
    await sleep(600);
    await s.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
    await sleep(900);
    await film(s, `store-${slug}`, async () => {
      await sleep(350);
      await glide(s, 1300, 2800);
      await sleep(200);
    });
  }
} finally {
  await browser.close().catch(() => {});
  for (const a of started) {
    try {
      execSync(`taskkill /F /T /PID ${a.pid}`, { stdio: "ignore" });
    } catch {
      a.kill();
    }
  }
}
process.exit(0);
