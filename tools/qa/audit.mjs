// Opens every page of every app in Chrome, on the QA stack, and says what is wrong with each. It looks; it does not fill
// in forms, so "no fault" means the page opens and shows real content, not that the feature gives the right answer.
//  1. Desktop, English: load, click every tab, open New / Add dialogs (each module once).
//  2. Phone width, Tamil: load again, looking for sideways overflow and raw labels.
// Faults: a failed build, a crash, a server error behind the page, raw labels (billing.nav.x), undefined / NaN on screen,
// "coming soon", a page stuck loading or blank, a broken image. Results: out/audit.json, screenshots in out/audit-shots/.
// Usage: node tools/qa/audit.mjs [--apps=billing,shop] [--built=billing,shop]   (--built: already built for QA, don't rebuild)
import { execSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { createFixtures, detailValue } from "./audit-fixtures.mjs";
import { API, API_PORT, OUT, ownerToken, qaEnv, QA_DB, ROOT, startApi, stopApi } from "./lib.mjs";

const require = createRequire(join(ROOT, "packages", "documents", "package.json"));
const puppeteer = require("puppeteer-core");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = join(OUT, "audit-shots");
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The shop each app is opened as: its own trade, on its top plan, so few pages are hidden by the plan. */
const APPS = [
  { id: "billing", port: 3101, shop: "raja" },
  { id: "shop", port: 3102, shop: "techzone" },
  { id: "seller", port: 3104, shop: "e2e-store" },
  { id: "pharmacy", port: 3106, shop: "thunai" },
  { id: "restaurant", port: 3107, shop: "arusuvai" },
  { id: "services", port: 3108, shop: "sukham" },
  { id: "school", port: 3109, shop: "thamarai" },
  { id: "admin", port: 3100, shop: "e2e-store", storage: true, files: true },
  { id: "store", port: 3103, shop: "anbu", files: true, open: true },
  { id: "www", port: 3105, open: true, files: true },
];
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--apps="))?.slice(7).split(",");
const built = args.find((a) => a.startsWith("--built="))?.slice(8).split(",") ?? [];
const OPENERS = /^(\+\s*)?(new|add|create|receive|record|adjust|invite|import|make|upload|set up)\b/i;
const NEVER_CLICK = /delete|remove|cancel|sign out|log ?out|lock|void|erase|pay |send/i;
const NAMESPACES = "web|common|billing|pos|orders|commerce|site|inbox|growth|payroll|workspace|ai|platform|scales|serials|jewellery|marketplace|pharmacy|restaurant|bookings|jobcards|memberships|enquiries|school|store|storefront|plans|features|gst|admin";
const RAW_KEY = new RegExp(`\\b(${NAMESPACES})(\\.[a-zA-Z][a-zA-Z0-9_]*){1,5}\\b`);
const BAD_TEXT = /\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date|₹\s*null/;
const UNFINISHED = /coming soon|not implemented|under construction|lorem ipsum|\bTODO\b|\bFIXME\b/i;
const NOT_FOUND = /page not found|பக்கம் கிடைக்கவில்லை/i;
const GATED = /not available on your plan|turned off|no access/i;
const LOAD_ERROR = /couldn.t load|could not load|failed to load|unable to load/i;
const CRASH = /application error|a client-side exception|something went wrong|unhandled runtime|this page couldn.t load/i;

const faults = [];
const pages = [];
const unreached = [];
const builds = [];
const seen = new Set();
const save = () => writeFileSync(join(OUT, "audit.json"), JSON.stringify({ when: new Date().toISOString(), builds, pages, faults, unreached }, null, 1));

const current = { app: "", url: "", phase: "" };
function fault(kind, where, detail, page) {
  const key = `${kind}|${current.app}|${current.url.split("?")[0]}|${where}|${String(detail).slice(0, 60)}`;
  if (seen.has(key)) return;
  seen.add(key);
  faults.push({ kind, app: current.app, url: current.url, phase: current.phase, where, detail: String(detail ?? "").slice(0, 300) });
  console.log(`${kind.padEnd(12)} ${current.app} ${current.url} | ${where} | ${String(detail).slice(0, 110)}`);
  if (page) page.screenshot({ path: join(SHOTS, `${faults.length}-${kind}.jpg`), type: "jpeg", quality: 55 }).catch(() => {});
}

// ------------------------------------------------------------------ the pages an app has
function moduleRoutes(app) {
  const dir = join(ROOT, "apps", app.id);
  const r = spawnSync(`${join(ROOT, "apps/api/node_modules/.bin/tsx")} ${join(ROOT, "tools/qa/audit-routes.mts")}`, { cwd: dir, env: qaEnv(), shell: true, encoding: "utf8" });
  const line = r.stdout.split("\n").find((l) => l.startsWith("@@"));
  if (!line) throw new Error(`no routes for ${app.id}: ${r.stderr.slice(0, 300)}`);
  return JSON.parse(line.slice(2)).map((x) => ({ ...x, full: `/${[x.base, x.path].join("/").split("/").filter(Boolean).join("/")}` }));
}
function fileRoutes(app) {
  const root = join(ROOT, "apps", app.id, "src", "app");
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name === "page.tsx") {
        const parts = relative(root, d).split(/[\\/]/).filter((s) => s && !s.startsWith("("));
        if (parts.some((s) => s.startsWith("[["))) continue;
        out.push({ module: "pages", full: `/${parts.map((s) => (s.startsWith("[") ? `:${s.slice(1, -1)}` : s)).join("/")}` });
      }
    }
  };
  walk(root);
  return out;
}
const matcher = (full) => new RegExp(`^${full.replace(/:[^/]+/g, "[^/]+").replace(/\/$/, "")}/?$`);

// ------------------------------------------------------------------ build and serve
const appEnv = (app) => ({ ...qaEnv(), PORT: String(app.port), NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`, API_URL: `http://localhost:${API_PORT}`, NEXT_PUBLIC_ROOT_DOMAIN: "localhost", NODE_ENV: "production" });
function build(app) {
  if (built.includes(app.id)) return true;
  const started = Date.now();
  const r = spawnSync(`pnpm --filter @rbms/${app.id} exec next build`, { cwd: ROOT, env: appEnv(app), shell: true, encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 1 << 28 });
  const ok = r.status === 0;
  builds.push({ app: app.id, ok, seconds: Math.round((Date.now() - started) / 1000), error: ok ? "" : `${r.stdout}\n${r.stderr}`.slice(-1500) });
  console.log(`build ${app.id}: ${ok ? "ok" : "FAILED"} (${builds.at(-1).seconds} s)`);
  save();
  return ok;
}
async function serve(app) {
  const log = openSync(join(OUT, "audit-apps.log"), "a");
  const child = spawn(`pnpm --filter @rbms/${app.id} exec next start -p ${app.port}`, { cwd: ROOT, env: appEnv(app), shell: true, stdio: ["ignore", log, log] });
  for (let i = 0; i < 90; i++) {
    if (await fetch(`http://localhost:${app.port}/`, { signal: AbortSignal.timeout(5000), redirect: "manual" }).then(() => true).catch(() => false)) break;
    await sleep(1000);
  }
  return () => {
    try {
      execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" });
    } catch {
      child.kill();
    }
  };
}

// ------------------------------------------------------------------ looking at a page
function watch(page) {
  page.on("pageerror", (e) => fault("page-error", "uncaught error", e.message, page));
  // An opened form leaves an "unsaved changes" prompt, and an unanswered prompt blocks every later page.
  page.on("dialog", (d) => d.accept().catch(() => {}));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource|favicon|ERR_|net::/.test(t)) return;
    fault("console", "console error", t);
  });
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes(`:${API_PORT}/`) && !url.includes("/api/v1/")) return;
    const s = res.status();
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    if (s >= 500 && s !== 501 && s !== 503) fault("api-5xx", `${res.request().method()} ${path}`, s, page);
    else if ([400, 402, 403, 404, 405, 409, 422].includes(s) && res.request().method() === "GET") res.text().then((t) => fault("api-refused", `GET ${url.replace(/^https?:\/\/[^/]+/, "")}`, `${s} ${t.slice(0, 160)}`)).catch(() => {});
  });
}
const readPage = (page) =>
  page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const text = document.body?.innerText ?? "";
    const attrs = [...document.querySelectorAll("[placeholder],[aria-label],[title]")].map((e) => [e.getAttribute("placeholder"), e.getAttribute("aria-label"), e.getAttribute("title")].filter(Boolean).join(" ")).join(" ");
    return {
      text,
      attrs,
      title: document.title,
      mainText: (main.innerText ?? "").trim(),
      mainLength: (main.innerText ?? "").trim().length,
      clipped: [...document.querySelectorAll("main table")].filter((t) => t.getBoundingClientRect().width > 0 && t.scrollWidth > (t.parentElement?.clientWidth ?? 0) + 2).length,
      stuck: document.querySelectorAll('.animate-pulse,.animate-spin,[data-slot="skeleton"]').length,
      skeletons: document.querySelectorAll('.animate-pulse,[data-slot="skeleton"]').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getBoundingClientRect().width > 0).map((i) => i.src.slice(0, 120)),
    };
  });
/** Reads the page, reports what is wrong and says what it is: ok, gated, not-found or fault. */
async function inspect(page, where) {
  let r = await readPage(page);
  if (r.stuck) {
    await sleep(4000);
    r = await readPage(page);
  }
  // Only skeletons count here: a spinner may be a small live indicator.
  if (r.skeletons) fault("stuck", where, `${r.skeletons} loading placeholders after 4 s`, page);
  const loadError = r.text.match(LOAD_ERROR);
  if (loadError) fault("load-error", where, r.text.slice(Math.max(0, loadError.index - 40), loadError.index + 60).replace(/s+/g, " "), page);
  if (CRASH.test(r.text)) fault("crash", where, r.text.slice(0, 200), page);
  const raw = `${r.text} ${r.attrs} ${r.title}`.match(RAW_KEY);
  // The admin app shows real feature and message keys on purpose (plan editor, translations).
  if (raw && current.app !== "admin") fault("raw-label", where, raw[0], page);
  const bad = r.text.match(BAD_TEXT);
  if (bad) fault("bad-text", where, r.text.slice(Math.max(0, bad.index - 50), bad.index + 40).replace(/\s+/g, " "), page);
  const unfinished = r.text.match(UNFINISHED);
  if (unfinished) fault("unfinished", where, r.text.slice(Math.max(0, unfinished.index - 50), unfinished.index + 40).replace(/\s+/g, " "), page);
  // Demo files live with the real API on :4000, not in this copy: their absence says nothing.
  for (const src of r.brokenImages.filter((s) => !s.includes("localhost:4000")).slice(0, 3)) fault("broken-image", where, src);
  if (r.clipped && current.phase === "desktop-en") fault("clipped", where, `${r.clipped} table(s) wider than their box on a 1366 px screen`, page);
  // Only the page's own content: the sidebar's words must not hide a "Page not found".
  if (NOT_FOUND.test(r.mainText) && r.mainLength < 400) return "not-found";
  if (GATED.test(r.mainText) && r.mainLength < 600) return "gated";
  if (r.mainLength < 15) {
    fault(r.stuck ? "stuck" : "blank", where, `${r.mainLength} characters of text`, page);
    return "fault";
  }
  return "ok";
}
async function load(page, url) {
  try {
    const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });
    await sleep(400);
    if (res && res.status() >= 500) fault("http-5xx", "page load", res.status(), page);
    return res ? res.status() : 0;
  } catch (e) {
    fault("timeout", "page load", e.message.slice(0, 100), page);
    return -1;
  }
}
const samePath = (page) => new URL(page.url()).pathname;
async function links(page, origin) {
  const hrefs = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.href));
  return [...new Set(hrefs.filter((h) => h.startsWith(origin)).map((h) => h.slice(origin.length).split("#")[0]))];
}
/** Clicks each tab and opens each New / Add dialog, without saving anything. */
async function exercise(page, url) {
  const tabs = await page.$$eval('[role="tab"]', (els) => els.map((e) => (e.innerText || "").trim()).filter(Boolean).slice(0, 10)).catch(() => []);
  for (const tab of tabs) {
    await page.evaluate((x) => [...document.querySelectorAll('[role="tab"]')].find((e) => (e.innerText || "").trim() === x)?.click(), tab).catch(() => {});
    await sleep(500);
    await inspect(page, `tab ${tab}`).catch(() => {});
  }
  const buttons = await page.$$eval("button, a[role=button]", (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => (e.innerText || "").trim())).catch(() => []);
  const openers = [...new Set(buttons)].filter((t) => t && t.length < 40 && OPENERS.test(t) && !NEVER_CLICK.test(t)).slice(0, 4);
  for (const opener of openers) {
    const path = samePath(page);
    await page.evaluate((x) => [...document.querySelectorAll("button, a[role=button]")].find((e) => (e.innerText || "").trim() === x)?.click(), opener).catch(() => {});
    await sleep(700);
    await inspect(page, `opened ${opener}`).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(150);
    if (samePath(page) !== path) await load(page, url);
  }
}
/** A list page whose rows open by click, not by link: follow the first row to find a detail page. */
async function followFirstRow(page, url) {
  const before = samePath(page);
  const clicked = await page.evaluate(() => {
    const cell = document.querySelector("tbody tr td");
    cell?.click();
    return !!cell;
  }).catch(() => false);
  if (!clicked) return null;
  await sleep(900);
  const after = samePath(page);
  if (after === before) return null;
  await load(page, url);
  return after;
}

// ------------------------------------------------------------------ crawling one app
const doneModules = new Set();
async function crawl(browser, app, token, tokens) {
  const host = app.shop && !app.storage ? `${app.shop}.localhost` : "localhost";
  const origin = `http://${host}:${app.port}`;
  const routes = app.files ? fileRoutes(app) : [...moduleRoutes(app), { module: "settings", full: "/settings" }];
  const statics = routes.filter((r) => !r.full.includes(":"));
  const params = routes.filter((r) => r.full.includes(":")).map((r) => ({ ...r, re: matcher(r.full), visited: 0 }));
  const queue = statics.map((r) => ({ path: r.full, route: r }));
  const queued = new Set(queue.map((q) => q.path));
  for (const p of app.files ? [] : params) {
    const path = detailValue(app.shop, p.full, tokens);
    if (!path || queued.has(path)) continue;
    p.visited++;
    queued.add(path);
    queue.push({ path, route: p });
  }
  const firstTime = new Set(routes.map((r) => r.module).filter((m) => !doneModules.has(`${app.files ? app.id : ""}${m}`)));

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  if (!app.open) {
    await page.evaluateOnNewDocument((t, s) => {
      localStorage.setItem("sr_token", t);
      if (s) localStorage.setItem("sr_tenant", s);
      localStorage.setItem("sr_locale", "en");
    }, token, app.shop ?? "");
  }
  watch(page);
  current.app = app.id;
  current.phase = "desktop-en";
  const visited = [];
  while (queue.length) {
    const { path, route } = queue.shift();
    current.url = path;
    const started = Date.now();
    const http = await load(page, `${origin}${path}`);
    let status = http < 0 ? "fault" : "ok";
    if (http >= 0) status = await inspect(page, "page load").catch((e) => (fault("robot", "inspect", e.message), "fault"));
    if (http === 404) status = "not-found";
    const landed = samePath(page);
    if (/\/login|\/select-tenant|\/signin/.test(landed) && !/login|signup|select-tenant/.test(path)) status = app.open ? "sign-in" : "bounced-to-login";
    pages.push({ app: app.id, module: route.module, path, status, http, feature: route.feature ?? null, ms: Date.now() - started });
    visited.push({ path, status, route });
    await page.screenshot({ path: join(SHOTS, `page-${app.id}-${path.replace(/[^a-z0-9]+/gi, "_").slice(0, 80)}.jpg`), type: "jpeg", quality: 45 }).catch(() => {});
    if (status === "ok") {
      const full = `${origin}${path}`;
      const firstVisit = firstTime.has(route.module);
      if (firstVisit && !app.open) await exercise(page, full).catch((e) => fault("robot", "exercise", e.message.slice(0, 120)));
      for (const l of await links(page, origin).catch(() => [])) {
        const clean = l.split("?")[0];
        if (queued.has(clean)) continue;
        const p = params.find((x) => x.re.test(clean));
        if (p && p.visited < 2) {
          p.visited++;
          queued.add(clean);
          queue.push({ path: clean, route: p });
        }
      }
      const waiting = params.filter((x) => x.visited === 0 && x.full.startsWith(path === "/" ? "/\0" : `${path}/`));
      if (waiting.length && !app.open) {
        const found = await followFirstRow(page, full).catch(() => null);
        const p = found && params.find((x) => x.re.test(found));
        if (p && !queued.has(found)) {
          p.visited++;
          queued.add(found);
          queue.push({ path: found, route: p });
        }
      }
    }
    if (pages.length % 10 === 0) save();
  }
  for (const m of firstTime) doneModules.add(`${app.files ? app.id : ""}${m}`);
  for (const p of params) if (!p.visited) unreached.push({ app: app.id, module: p.module, path: p.full });

  // Phone width, Tamil: only pages that opened, once for each module's page across apps.
  current.phase = "phone-ta";
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => localStorage.setItem("sr_locale", "ta"));
  for (const v of visited.filter((x) => x.status === "ok")) {
    const key = `phone|${app.files ? app.id : ""}${v.route.module}|${v.route.path ?? v.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    current.url = v.path;
    if ((await load(page, `${origin}${v.path}`)) < 0) continue;
    await inspect(page, "phone Tamil").catch(() => {});
    const { overflow } = await readPage(page).catch(() => ({ overflow: 0 }));
    if (overflow > 2) fault("overflow", "phone width", `${overflow} px wider than the screen`, page);
  }
  await page.close();
  save();
}

// ------------------------------------------------------------------ run
execSync(`docker exec srikit-postgres-1 psql -q -U srikit -d ${QA_DB} -c "insert into tenant_memberships (tenant_id, user_id, roles, status) select t.id, u.id, '{owner}', 'active' from tenants t, users u where u.email='e2e-owner@example.com' and t.slug in (${APPS.filter((a) => a.shop).map((a) => `'${a.shop}'`).join(",")}) on conflict (tenant_id, user_id) do update set roles='{owner}', status='active'"`, { stdio: "inherit" });
await startApi();
const token = await ownerToken();
// A shop's own switches hide whole areas (accounting, payroll). On here, or those pages are never looked at; two rounds for switches that depend on another.
for (const shop of new Set(APPS.filter((a) => a.shop).map((a) => a.shop))) {
  const headers = { authorization: `Bearer ${token}`, "x-tenant": shop, "content-type": "application/json" };
  for (let round = 0; round < 2; round++) {
    const { features } = await (await fetch(`${API}/v1/features`, { headers })).json();
    for (const f of features.filter((x) => x.shopToggle && x.available && x.shopEnabled === false)) await fetch(`${API}/v1/features/toggles/${encodeURIComponent(f.key)}`, { method: "PUT", headers, body: JSON.stringify({ enabled: true }) });
  }
}
const tokensFor = {};
for (const a of APPS.filter((x) => x.shop && !x.files && (!only || only.includes(x.id)))) {
  const made = await createFixtures(token, a.shop);
  tokensFor[a.shop] = made.tokens;
  for (const refused of made.refused) {
    faults.push({ kind: "fixture", app: a.id, url: refused.path, phase: "setup", where: "creating test data", detail: refused.detail });
    console.log(`fixture      ${a.id} ${refused.path} | ${refused.detail.slice(0, 150)}`);
  }
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
try {
  for (const app of APPS.filter((a) => !only || only.includes(a.id))) {
    if (!build(app)) continue;
    if (!existsSync(join(ROOT, "apps", app.id, ".next", "BUILD_ID"))) continue;
    const stop = await serve(app);
    try {
      await crawl(browser, app, token, tokensFor[app.shop] ?? {});
    } catch (e) {
      fault("robot", "crawl stopped", e.stack ?? e.message);
    } finally {
      stop();
    }
    const here = pages.filter((p) => p.app === app.id);
    console.log(`=== ${app.id}: ${here.length} pages, ${here.filter((p) => p.status === "ok").length} ok; ${faults.filter((f) => f.app === app.id).length} faults`);
    save();
  }
} finally {
  save();
  await browser.close().catch(() => {});
  stopApi();
}
console.log(`pages ${pages.length}, faults ${faults.length}, detail pages not reached ${unreached.length}; API ${API}`);
process.exit(0);
