// Films the real apps for the ad, as frames with timings (out/clips/<clip>/). Read-only: billing uses the demo sign-in and
// nothing is saved, the stores are only browsed. Needs the dev API on :4000; starts billing on :3001 and the store on :3003.
import { execSync, spawn } from "node:child_process";
import { mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "out", "clips");
mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(join(ROOT, "packages", "documents", "package.json"))("puppeteer-core");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = "http://localhost:4000";

async function waitFor(url, seconds = 120) {
  for (let i = 0; i < seconds; i++) {
    if (await fetch(url, { signal: AbortSignal.timeout(4000) }).then(() => true).catch(() => false)) return;
    await sleep(1000);
  }
  throw new Error(`${url} did not start`);
}

/** Records one page while `act` runs: JPEG frames plus the time each appeared. */
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
  const seconds = (Date.now() - started) / 1000;
  writeFileSync(join(dir, "index.json"), JSON.stringify({ seconds, frames }));
  console.log(`${name}: ${frames.length} frames, ${seconds.toFixed(1)} s`);
}

/** Takes dev-only badges out of the picture, and keeps the page in light mode with no install prompt. */
const CLEAN = "nextjs-portal,[data-nextjs-toast]{display:none!important}html{scroll-behavior:auto!important}";
async function prepare(page) {
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.evaluateOnNewDocument((css, dismissed) => {
    try {
      localStorage.setItem("theme", "light");
      localStorage.setItem("sr_pwa_dismissed", dismissed);
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

/** A smooth, eased scroll down the page, like a thumb. */
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

const log = openSync(join(HERE, "out", "apps.log"), "a");
const started = [];
for (const [pkg, port] of [["@rbms/billing", 3001], ["@rbms/store", 3003]]) {
  const up = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(3000) }).then(() => true).catch(() => false);
  if (!up) started.push(spawn(`pnpm --filter ${pkg} exec next dev --turbopack -p ${port}`, { cwd: ROOT, shell: true, stdio: ["ignore", log, log] }));
  await waitFor(`http://localhost:${port}/`);
}

const demo = await (await fetch(`${API}/v1/auth/demo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shop: "kumar" }) })).json();
if (!demo.token) throw new Error(`demo sign-in failed: ${JSON.stringify(demo).slice(0, 200)}`);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });

try {
  // ---- billing, desktop
  const b = await browser.newPage();
  await b.setViewport({ width: 1440, height: 900 });
  await prepare(b);
  await b.evaluateOnNewDocument((t) => {
    localStorage.setItem("sr_token", t);
    localStorage.setItem("sr_tenant", "kumar");
    localStorage.setItem("sr_locale", "en");
    localStorage.setItem("sr_theme", "light");
  }, demo.token);
  const billing = "http://kumar.localhost:3001";
  // Warm the pages first, so the film doesn't show a dev compile.
  for (const p of ["/invoices/new", "/credit-book", "/"]) await b.goto(billing + p, { waitUntil: "networkidle2", timeout: 120000 });
  await sleep(800);

  await b.goto(`${billing}/invoices/new`, { waitUntil: "networkidle2" });
  await sleep(500);
  await b.evaluate(() => window.scrollTo({ top: 420, behavior: "instant" }));
  await sleep(300);
  const itemName = async (i) => (await b.$$('input[placeholder^="Type an item"]'))[i];
  // Typing a saved item fills in its price, GST and HSN: that is what this shot shows.
  const typeLine = async (i, name) => {
    const n = await itemName(i);
    await n.click();
    await b.keyboard.type(name, { delay: 55 });
    await sleep(350);
    // As a cashier does: arrow to the suggestion, Enter. That fills in its price, GST and HSN.
    await b.keyboard.press("ArrowDown");
    await sleep(120);
    await b.keyboard.press("Enter");
    await sleep(700);
  };
  await film(b, "bill", async () => {
    await sleep(300);
    await typeLine(0, "Sunflower oil 1 L");
    await b.evaluate(() => [...document.querySelectorAll("button")].find((e) => e.innerText.trim() === "Add item")?.click());
    await b.waitForFunction(() => document.querySelectorAll('input[placeholder^="Type an item"]').length > 1, { timeout: 5000 });
    await sleep(300);
    await typeLine(1, "Ponni rice (loose)");
    await sleep(1300);
    // The ad's printed slip has to match this figure.
    const total = await b.evaluate(() => [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && /^₹[\d,]+\.\d\d$/.test(e.textContent.trim())).map((e) => e.textContent.trim()).join(" "));
    console.log("amounts on the bill:", total);
  });

  await b.goto(`${billing}/credit-book`, { waitUntil: "networkidle2" });
  await sleep(500);
  await film(b, "credit", async () => {
    await sleep(300);
    await glide(b, 260, 1800);
    await sleep(300);
  });

  await b.close();

  // ---- stores, phone
  const s = await browser.newPage();
  await s.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await prepare(s);
  for (const [name, slug] of [["store-thari", "thari"], ["store-cauvery", "cauvery"], ["store-padham", "padham"]]) {
    const url = `http://${slug}.localhost:3003/`;
    await s.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
    await sleep(600);
    await s.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
    await sleep(900);
    await film(s, name, async () => {
      await sleep(400);
      await glide(s, 1500, 3000);
      await sleep(200);
    });
  }
  const list = await s.goto("http://thari.localhost:3003/products", { waitUntil: "networkidle2", timeout: 120000 }).then(() => s.evaluate(() => [...document.querySelectorAll('a[href*="/p/"]')].map((a) => a.getAttribute("href"))[0]));
  await s.goto(`http://thari.localhost:3003${list}`, { waitUntil: "networkidle2", timeout: 120000 });
  await sleep(900);
  await film(s, "store-product", async () => {
    await sleep(500);
    await glide(s, 520, 1800);
    await sleep(400);
  });
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
