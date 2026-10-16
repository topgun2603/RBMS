// Marketing-site browser test: pricing → sign-up wizard → shop created → handoff, then /login → Open, in headless Chrome.
//
//   pnpm --filter @srirealtime/www test:e2e
//
// Needs the dev servers running (api :4000 with the test OTP on — apps/api/.env TEST_OTP_CODE / TEST_OTP_TARGETS — and
// this app on :3005). Signs up with a fresh +91 99990 xxxxx test phone and the fixed test OTP on an `e2e-` slug, so
// apps/api `cleanup:e2e-data` removes the shop. The shop apps (:3001/:3002) don't need to be running: the test only
// checks that the browser is sent to `<slug>.<app host>/login?handoff=<code>`.
//
// Env: WWW_URL (default http://localhost:3005), API_URL (default http://localhost:4000), TEST_OTP_CODE (default 123456),
// TAKEN_SLUG (an existing shop, default e2e-store), CHROME_PATH, SHOTS_DIR (default <tmp>/srikit-www-e2e).
// Exit codes: 0 passed, 1 failed, 2 servers not running (skipped).
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = (process.env.WWW_URL || "http://localhost:3005").replace(/\/$/, "");
const API = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");
const OTP = process.env.TEST_OTP_CODE || "123456";
const TAKEN = process.env.TAKEN_SLUG || "e2e-store";
// CHROME_PATH wins; otherwise the usual Google Chrome location for this OS (CI sets CHROME_PATH=/usr/bin/google-chrome).
const CHROME =
  process.env.CHROME_PATH ||
  { win32: "C:/Program Files/Google/Chrome/Application/chrome.exe", darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }[process.platform] ||
  "/usr/bin/google-chrome";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "srikit-www-e2e");
const stamp = Date.now().toString(36).slice(-6);
const phone = `99990${String(Date.now()).slice(-5)}`;
const SHOP = `E2E Www ${stamp}`;
const SLUG = `e2e-www-${stamp}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let total = 0;

function loadPuppeteer() {
  const candidates = [path.join(__dirname, "../../../packages/documents/node_modules/puppeteer-core"), "puppeteer-core"];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* next */
    }
  }
  throw new Error("puppeteer-core not found (it is installed with @srirealtime/documents: run pnpm install)");
}

async function up(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(90000), redirect: "manual" });
    return r.status < 500;
  } catch {
    return false;
  }
}

async function step(name, fn) {
  total++;
  const started = Date.now();
  await fn();
  passed++;
  console.log(`  ok  ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function api(method, p, token, body, headers = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

(async () => {
  const [apiUp, wwwUp] = await Promise.all([up(`${API}/health`), up(`${BASE}/`)]);
  if (!apiUp || !wwwUp) {
    console.log(`SKIPPED: www browser test needs the dev servers (${apiUp ? "" : `api ${API} down; `}${wwwUp ? "" : `www ${BASE} down; `}start them with pnpm dev).`);
    process.exit(2);
  }
  if (!fs.existsSync(CHROME)) {
    console.log(`SKIPPED: Chrome not found at ${CHROME} (set CHROME_PATH).`);
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = (name) => page.screenshot({ path: path.join(OUT, `www-${name}.png`) });
  let token = null;
  let handoffNav = null;

  try {
    console.log(`www e2e: ${BASE} (shop ${SLUG}, phone +91${phone})`);

    await step("pricing lists plans with a yearly toggle", async () => {
      await page.goto(`${BASE}/pricing?lang=en`, { waitUntil: "networkidle0", timeout: 120000 });
      await page.waitForSelector('[data-testid="plan-starter"]');
      await page.click('[data-testid="interval-yearly"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="plan-cta-starter"]')?.getAttribute("href")?.includes("interval=yearly"));
      assert(await page.$('[data-testid="compare-table"]'), "comparison table missing");
      await shot("pricing");
    });

    await step("plan CTA opens the wizard with the plan pre-selected", async () => {
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('[data-testid="plan-cta-starter"]')]);
      assert(page.url().includes("/signup?") && page.url().includes("plan=starter"), `unexpected URL ${page.url()}`);
      await page.waitForSelector('[data-testid="signup-wizard"][data-step="need"]');
      await page.evaluate(() => sessionStorage.clear());
    });

    await step("step 1: choose Online Store", async () => {
      await page.click('[data-testid="need-EC"]');
      await page.click('[data-testid="wizard-next"]');
      await page.waitForSelector('[data-testid="signup-wizard"][data-step="signin"]');
    });

    await step("step 2: OTP sign-in with the test code", async () => {
      await page.waitForSelector('[data-testid="otp-target"]');
      await page.type('[data-testid="otp-name"]', "E2E Owner");
      await page.type('[data-testid="otp-target"]', phone);
      await page.click('[data-testid="otp-send"]');
      await page.waitForSelector('input[autocomplete="one-time-code"]', { timeout: 60000 });
      await sleep(300);
      await page.focus('input[autocomplete="one-time-code"]');
      await page.keyboard.type(OTP, { delay: 40 });
      await page.waitForSelector('[data-testid="signup-wizard"][data-step="shop"]', { timeout: 20000 });
      token = await page.evaluate(() => sessionStorage.getItem("sr_www_token"));
      assert(token, "no session token after OTP verify");
    });

    await step("step 3: live slug check (taken → suggestions, then available)", async () => {
      await page.waitForSelector('[data-testid="shop-name"]');
      await page.type('[data-testid="shop-name"]', SHOP);
      const auto = await page.$eval('[data-testid="shop-slug"]', (el) => el.value);
      assert(auto === SLUG, `slug not derived from the name: ${auto}`);
      await page.click('[data-testid="shop-slug"]', { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type('[data-testid="shop-slug"]', TAKEN);
      await page.waitForSelector('[data-testid="slug-status"][data-status="taken"]', { timeout: 15000 });
      await shot("slug-taken");
      await page.click('[data-testid="shop-slug"]', { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type('[data-testid="shop-slug"]', SLUG);
      await page.waitForSelector('[data-testid="slug-status"][data-status="available"]', { timeout: 15000 });
      await shot("shop");
      await page.click('[data-testid="wizard-next"]');
      await page.waitForSelector('[data-testid="signup-wizard"][data-step="plan"]');
    });

    await step("step 4: plan + interval carried over from pricing", async () => {
      await page.waitForSelector('[data-testid="wiz-plan-starter"]');
      const checked = await page.$eval('[data-testid="wiz-plan-starter"]', (el) => el.getAttribute("aria-checked"));
      assert(checked === "true", "starter not pre-selected");
      const yearly = await page.$eval('[data-testid="interval-yearly"]', (el) => el.getAttribute("data-state"));
      assert(yearly === "on", "yearly not pre-selected");
      await shot("plan");
    });

    await step("step 5: creating your shop → redirect to the app with a handoff code", async () => {
      const nav = page.waitForRequest((r) => r.isNavigationRequest() && r.url().includes("handoff="), { timeout: 30000 });
      await page.click('[data-testid="wizard-next"]');
      await page.waitForSelector('[data-testid="creating"]', { timeout: 5000 });
      await shot("creating");
      await page.waitForSelector('[data-testid="create-done"]', { timeout: 20000 });
      await shot("done");
      handoffNav = (await nav).url();
      const u = new URL(handoffNav);
      assert(u.hostname.startsWith(`${SLUG}.`), `redirect host ${u.hostname} isn't the new shop`);
      assert(u.pathname.endsWith("/login") && u.searchParams.get("handoff"), `redirect isn't a handoff login: ${handoffNav}`);
    });

    await step("API: shop exists with a Starter yearly trial", async () => {
      const mine = await api("GET", "/v1/tenancy/mine", token);
      const row = mine.body?.items?.find((r) => r.tenant.slug === SLUG);
      assert(row, `shop ${SLUG} not in /tenancy/mine`);
      assert(row.tenant.appId === "EC", `appId ${row.tenant.appId}`);
      const cur = await api("GET", "/v1/subscriptions/current", token, undefined, { "x-tenant": SLUG });
      assert(cur.status === 200, `subscriptions/current ${cur.status}`);
      const s = cur.body.subscription;
      assert(s.status === "trialing" && s.planId === "starter" && s.interval === "yearly", `subscription ${JSON.stringify(s)}`);
    });

    await step("/login lists the shop and Open hands off to it", async () => {
      await page.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 60000 }).catch(() => undefined);
      // sessionStorage is per tab + origin, so the www session is still here after the cross-origin redirect.
      await page.waitForSelector(`[data-testid="open-${SLUG}"]`, { timeout: 20000 });
      await shot("login-shops");
      const nav = page.waitForRequest((r) => r.isNavigationRequest() && r.url().includes("handoff="), { timeout: 20000 });
      await page.click(`[data-testid="open-${SLUG}"]`);
      const url = new URL((await nav).url());
      assert(url.hostname.startsWith(`${SLUG}.`) && url.searchParams.get("handoff"), `bad open URL ${url}`);
      assert(url.searchParams.get("handoff") !== new URL(handoffNav).searchParams.get("handoff"), "handoff code reused");
    });

    const real = errors.filter((e) => !/net::ERR|Failed to fetch|NetworkError/i.test(e));
    if (real.length) throw new Error(`page errors: ${real.join(" | ")}`);
    console.log(`\nPASSED ${passed}/${total} (screenshots in ${OUT})`);
    await browser.close();
    process.exit(0);
  } catch (err) {
    await shot("failure").catch(() => undefined);
    console.error(`\nFAILED after ${passed}/${total + 0} steps: ${err.message}`);
    await browser.close();
    process.exit(1);
  }
})();
