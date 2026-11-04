// Bad data typed into the real screens, in Chrome, on the QA stack: every billing page and form, then the online store.
// A page crash, a script that runs, a 5xx behind a form, letters kept in a number box or junk that gets saved is a finding.
// Results: out/screens.json, screenshots of findings in out/shots/. Starts the apps on ports 3101 and 3103, and stops them.
import { execSync, spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { API, API_PORT, OUT, ownerToken, qaEnv, ROOT, startApi, stopApi } from "./lib.mjs";

const require = createRequire(join(ROOT, "packages", "documents", "package.json"));
const puppeteer = require("puppeteer-core");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BILLING = "http://e2e-bill.localhost:3101";
const STORE = "http://e2e-store.localhost:3103";
const BILLING_PAGES = ["", "invoices", "invoices/new", "quotations", "quotations/new", "credit-book", "customers", "items", "stock", "stock-audit", "batches", "transfers", "transfers/new", "purchases", "purchases/new", "purchase-orders", "purchase-orders/new", "suppliers", "payables", "expenses", "price-lists", "pricing-hints", "reports", "gst", "cash-flow", "loan-pack", "accounting", "accounting/accounts", "accounting/journal", "accounting/journal/new", "accounting/day-book", "accounting/ledger", "accounting/trial-balance", "accounting/profit-loss", "accounting/balance-sheet", "accounting/gst"];
const STORE_PAGES = ["", "products", "search?q=rice", "p/anarkali-kurti", "cart", "checkout", "account", "track", "track-repair", "warranty", "help", "help/new", "book", "compare"];
const JUNK_URLS = ["search?q=%3Cscript%3Ewindow.__qa_xss%3D1%3C%2Fscript%3E", "search?q=%22%3E%3Cimg%20src%3Dx%20onerror%3Dwindow.__qa_xss%3D1%3E", "p/%3Cscript%3E", "c/'%20OR%201%3D1--", "collections/..%2F..%2Fetc", "products?page=-1&limit=abc", "products?offset=99999999999", "track/not-a-token", "order/not-a-token", "pages/%00"];

/** What gets typed. "number" lists a value a number box must not keep as typed. */
const BAD = [
  { label: "letters", text: "abc", number: true },
  { label: "digits+letters", text: "12abc", number: true },
  { label: "symbols", text: "₹#$%", number: true },
  { label: "negative", text: "-5", number: true },
  { label: "exponent", text: "1e5", number: true },
  { label: "huge", text: "99999999999999999999" },
  { label: "script", text: "<script>window.__qa_xss=1</script>" },
  { label: "image onerror", text: '"><img src=x onerror="window.__qa_xss=1">' },
  { label: "SQL", text: "'; DROP TABLE tenants;--" },
  { label: "spaces", text: "     " },
  { label: "emoji", text: "🧾🔥" },
];
const OPENERS = /^(\+\s*)?(new|add|create|receive|record|adjust|invite|import|make|start|upload|set)\b/i;
const SUBMIT = /^(save|create|add|issue|submit|continue|next|confirm|apply|send|record|pay|place|update|sign in|get otp|search|track|find)/i;
const SKIP_BUTTON = /delete|remove|cancel|sign out|log ?out|lock|void|erase/i;

const findings = [];
const seen = new Set();
const pagesDone = [];
function note(kind, page, where, detail, shotPage) {
  const key = `${kind}|${page}|${where}`;
  if (seen.has(key)) return;
  seen.add(key);
  const row = { kind, page, where, detail: String(detail ?? "").slice(0, 300) };
  findings.push(row);
  console.log(`${kind.padEnd(14)} ${page} | ${where} | ${row.detail.slice(0, 100)}`);
  if (shotPage) shotPage.screenshot({ path: join(SHOTS, `${findings.length}-${kind}.jpg`), type: "jpeg", quality: 60 }).catch(() => {});
}

function watch(page, name) {
  const state = { name: () => name.value, writes: [] };
  page.on("pageerror", (e) => note("page-error", name.value, "uncaught error", e.message));
  page.on("dialog", async (d) => {
    if (d.type() === "alert") note("xss", name.value, "a script ran", d.message(), page);
    await d.dismiss().catch(() => {});
  });
  page.on("response", (res) => {
    if (!res.url().includes(`:${API_PORT}/`)) return;
    const method = res.request().method();
    if (res.status() >= 500 && res.status() !== 503) note("api-5xx", name.value, `${method} ${res.url().replace(API, "").split("?")[0]}`, res.status(), page);
    if (method !== "GET" && method !== "OPTIONS") state.writes.push({ method, url: res.url().replace(API, ""), status: res.status(), body: res.request().postData() ?? "" });
  });
  return state;
}

const crashed = (page) => page.evaluate(() => {
  const t = document.body?.innerText ?? "";
  return /application error|a client-side exception|something went wrong|unhandled runtime|this page couldn.t load/i.test(t) ? t.slice(0, 160) : null;
});
const xssRan = (page) => page.evaluate(() => window.__qa_xss === 1);

async function visibleFields(page) {
  const handles = await page.$$("input, textarea");
  const out = [];
  for (const h of handles) {
    const info = await h.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      const label = e.getAttribute("aria-label") || e.placeholder || e.name || e.id || (e.labels && e.labels[0]?.innerText) || e.type;
      return { type: e.type, mode: e.inputMode, disabled: e.disabled || e.readOnly, visible: r.width > 0 && r.height > 0 && s.visibility !== "hidden", label: String(label).slice(0, 40) };
    });
    if (info.visible && !info.disabled && !["checkbox", "radio", "file", "hidden", "date", "time", "color", "range", "submit", "button"].includes(info.type)) out.push({ h, ...info });
  }
  return out;
}

async function fill(page, h, text) {
  await h.evaluate((e) => { e.scrollIntoView({ block: "center", behavior: "instant" }); e.focus(); e.select?.(); });
  await page.keyboard.press("Delete");
  await page.keyboard.type(text);
}

/** Types each bad value into each box and reads back what the box kept. */
async function attackFields(page, name, where) {
  const fields = (await visibleFields(page)).slice(0, 14);
  for (const f of fields) {
    const isNumber = f.type === "number" || f.mode === "decimal" || f.mode === "numeric" || /qty|quantity|price|rate|amount|discount|mrp|cost/i.test(f.label);
    for (const bad of BAD) {
      if (bad.label === "image onerror" && !isNumber) continue;
      try {
        await fill(page, f.h, bad.text);
        await page.keyboard.press("Tab");
        const value = await f.h.evaluate((e) => e.value);
        if (isNumber && bad.number && value === bad.text) note("keeps-bad", name.value, `${where} > ${f.label}`, `number box kept "${bad.text}"`, page);
      } catch {
        break; // The box went away: a dialog closed or the form moved on.
      }
      const c = await crashed(page).catch(() => null);
      if (c) {
        note("crash", name.value, `${where} > ${f.label} = ${bad.label}`, c, page);
        return false;
      }
    }
  }
  return fields.length > 0;
}

/** Fills everything with one bad value and tries to save. Anything accepted with junk in it is worth a look. */
async function attackSubmit(page, state, name, where, bad) {
  const fields = await visibleFields(page);
  for (const f of fields.slice(0, 14)) await fill(page, f.h, bad.text).catch(() => {});
  const before = state.writes.length;
  const buttons = await page.$$("button");
  for (const b of buttons) {
    const t = await b.evaluate((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && !e.disabled ? (e.innerText || "").trim() : ""; }).catch(() => "");
    if (t && SUBMIT.test(t) && !SKIP_BUTTON.test(t)) {
      await b.evaluate((e) => e.click()).catch(() => {});
      await sleep(900);
      break;
    }
  }
  for (const w of state.writes.slice(before)) {
    if (w.status >= 200 && w.status < 300 && w.body.includes(bad.text.slice(0, 8))) note("saved-junk", name.value, `${where}: ${w.method} ${w.url.split("?")[0]}`, `saved with ${bad.label}: ${w.body.slice(0, 200)}`, page);
  }
  const c = await crashed(page).catch(() => null);
  if (c) note("crash", name.value, `${where} > submit ${bad.label}`, c, page);
  if (await xssRan(page).catch(() => false)) note("xss", name.value, `${where} > submit ${bad.label}`, "typed script ran", page);
}

async function openers(page) {
  const names = [];
  for (const b of await page.$$("button, a[role=button]")) {
    const t = await b.evaluate((e) => { const r = e.getBoundingClientRect(); return r.width > 0 ? (e.innerText || "").trim() : ""; }).catch(() => "");
    if (t && t.length < 40 && OPENERS.test(t) && !SKIP_BUTTON.test(t) && !names.includes(t)) names.push(t);
  }
  return names.slice(0, 5);
}
const clickByText = (page, text) => page.evaluate((x) => {
  const el = [...document.querySelectorAll("button, a[role=button]")].find((e) => (e.innerText || "").trim() === x);
  if (el) el.click();
  return !!el;
}, text);

async function runPage(page, state, name, base, path) {
  const url = `${base}/${path}`;
  name.value = url.replace(/^http:\/\//, "");
  state.writes.length = 0;
  try {
    const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
    await sleep(600);
    if (res && res.status() >= 500) note("http-5xx", name.value, "page load", res.status(), page);
  } catch (e) {
    note("timeout", name.value, "page load", e.message);
    return;
  }
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" }).catch(() => {});
  const c = await crashed(page);
  if (c) return note("crash", name.value, "page load", c, page);
  await attackFields(page, name, "page");
  const nums = [BAD[0], BAD[3], BAD[6]];
  await attackSubmit(page, state, name, "page", BAD[6]);
  for (const opener of await openers(page)) {
    for (const bad of nums) {
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        await sleep(300);
        if (!(await clickByText(page, opener))) break;
        await sleep(700);
        if (bad === nums[0]) await attackFields(page, name, opener);
        await attackSubmit(page, state, name, opener, bad);
      } catch (e) {
        note("robot", name.value, opener, e.message.slice(0, 120));
        break;
      }
    }
  }
  pagesDone.push(name.value);
  console.log(`done ${name.value} (${findings.length} findings)`);
}

await startApi();
const token = await ownerToken();
const appEnv = (extra) => ({ ...qaEnv(), NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`, API_URL: `http://localhost:${API_PORT}`, NEXT_PUBLIC_ROOT_DOMAIN: "localhost", ...extra });
const log = openSync(join(OUT, "apps.log"), "a");
const apps = [
  spawn("pnpm --filter @rbms/billing exec next dev --turbopack -p 3101", { cwd: ROOT, env: appEnv({ PORT: "3101" }), shell: true, stdio: ["ignore", log, log] }),
  spawn("pnpm --filter @rbms/store exec next dev --turbopack -p 3103", { cwd: ROOT, env: appEnv({ PORT: "3103" }), shell: true, stdio: ["ignore", log, log] }),
];
for (const port of [3101, 3103]) {
  for (let i = 0; i < 120; i++) {
    const up = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(5000) }).then(() => true).catch(() => false);
    if (up) break;
    await sleep(1000);
  }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const started = Date.now();
try {
  const b = await browser.newPage();
  await b.setViewport({ width: 1366, height: 900 });
  await b.evaluateOnNewDocument((t, s) => {
    localStorage.setItem("sr_token", t);
    localStorage.setItem("sr_tenant", s);
    localStorage.setItem("sr_locale", "en");
  }, token, "e2e-bill");
  const nameB = { value: "" };
  const stateB = watch(b, nameB);
  for (const p of BILLING_PAGES) await runPage(b, stateB, nameB, BILLING, p);
  await b.close();

  const s = await browser.newPage();
  await s.setViewport({ width: 412, height: 860 });
  const nameS = { value: "" };
  const stateS = watch(s, nameS);
  for (const p of STORE_PAGES) await runPage(s, stateS, nameS, STORE, p);
  for (const p of JUNK_URLS) {
    nameS.value = `${STORE}/${p}`.replace(/^http:\/\//, "");
    const res = await s.goto(`${STORE}/${p}`, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => null);
    await sleep(500);
    if (res && res.status() >= 500) note("http-5xx", nameS.value, "junk URL", res.status(), s);
    if (await xssRan(s).catch(() => false)) note("xss", nameS.value, "junk URL", "script in the URL ran", s);
    const c = await crashed(s).catch(() => null);
    if (c) note("crash", nameS.value, "junk URL", c, s);
    pagesDone.push(nameS.value);
  }
} finally {
  writeFileSync(join(OUT, "screens.json"), JSON.stringify({ when: new Date().toISOString(), minutes: Math.round((Date.now() - started) / 60000), pages: pagesDone, findings }, null, 1));
  await browser.close().catch(() => {});
  for (const a of apps) {
    try {
      execSync(`taskkill /F /T /PID ${a.pid}`, { stdio: "ignore" });
    } catch {
      a.kill();
    }
  }
  stopApi();
}
console.log(`pages ${pagesDone.length}, findings ${findings.length}`);
process.exit(0);
