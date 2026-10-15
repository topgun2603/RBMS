// Storefront browser test: a full purchase on the e2e shop in headless Chrome, with screenshots.
//
//   pnpm --filter @srirealtime/store test:e2e
//
// Needs the dev servers running (api :4000 with the test OTP on — apps/api/.env TEST_OTP_CODE / TEST_OTP_TARGETS —
// and this app on :3003) and the e2e shops seeded (pnpm --filter @srirealtime/api seed:e2e). It shops on e2e-store
// only (never the demo shops), signs in with a +91 99990 xxxxx test phone and the fixed test OTP, and its analytics
// anonymous id ends in "-e2e", so everything it leaves is recognisable as test data (apps/api cleanup:e2e-data).
//
// Env: STORE_URL (default http://e2e-store.localhost:3003), API_URL (default http://localhost:4000),
// TEST_OTP_CODE (default 123456), PRODUCT (default anarkali-kurti), CHROME_PATH, SHOTS_DIR (default <tmp>/srikit-store-e2e).
// Exit codes: 0 passed, 1 failed, 2 servers not running (skipped).
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = (process.env.STORE_URL || "http://e2e-store.localhost:3003").replace(/\/$/, "");
const API = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");
const OTP = process.env.TEST_OTP_CODE || "123456";
const PRODUCT = process.env.PRODUCT || "anarkali-kurti";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "srikit-store-e2e");
const HOST = new URL(BASE).hostname;
// +91 99990 xxxxx: a test identity (TEST_OTP_TARGETS "+9199990*"), fresh per run.
const phone = `99990${String(Date.now()).slice(-5)}`;
const stamp = Date.now().toString(36).slice(-6).toUpperCase();
const SHOPPER = `E2E Shopper ${stamp}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let total = 0;
let PG;

function loadPuppeteer() {
  const candidates = [
    path.join(__dirname, "../../../packages/documents/node_modules/puppeteer-core"),
    "puppeteer-core",
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* next */
    }
  }
  throw new Error("puppeteer-core not found (it is installed with @srirealtime/documents: run pnpm install)");
}

// Generous timeout: the first request to a dev server compiles the page.
async function up(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: "manual" });
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

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `store-${name}.png`), fullPage: false });

(async () => {
  const [apiUp, storeUp] = await Promise.all([up(`${API}/health`), up(`${BASE}/`)]);
  if (!apiUp || !storeUp) {
    console.log(
      `SKIPPED: storefront browser test needs the dev servers (${apiUp ? "" : `api ${API} down; `}${storeUp ? "" : `store ${BASE} down; `}start them with pnpm dev).`,
    );
    process.exit(2);
  }
  if (!fs.existsSync(CHROME)) {
    console.log(`SKIPPED: Chrome not found at ${CHROME} (set CHROME_PATH).`);
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--host-resolver-rules=MAP *.localhost 127.0.0.1"],
  });
  const page = await browser.newPage();
  PG = page;
  const pageErrors = [];
  const httpErrors = [];
  page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 500 && httpErrors.push(`http ${r.status()} ${r.url()}`));
  // Analytics from this run are marked as test data (cleanup:e2e-data removes "-e2e" anonymous ids).
  await page.evaluateOnNewDocument(() => {
    try {
      if (!(localStorage.getItem("sr_aid") || "").endsWith("-e2e")) localStorage.setItem("sr_aid", `${Math.random().toString(36).slice(2)}-e2e`);
    } catch {
      /* storage off */
    }
  });
  await page.setViewport({ width: 1366, height: 900 });
  console.log(`storefront e2e on ${BASE} as +91${phone} (${SHOPPER}); screenshots in ${OUT}`);

  await step("home renders", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 120000 });
    await sleep(800);
    await shot(page, "home-desktop");
  });

  await step("product: pick size, add to cart", async () => {
    await page.goto(`${BASE}/p/${PRODUCT}`, { waitUntil: "networkidle2", timeout: 120000 });
    await page.evaluate(() => [...document.querySelectorAll("fieldset button")].find((b) => b.textContent.trim() === "M")?.click());
    await sleep(300);
    await shot(page, "product-desktop");
    await page.click('[data-testid="add-to-cart"]');
    await page.waitForSelector('[data-testid="mini-cart"]', { timeout: 20000 });
    await sleep(500);
  });

  await step("cart: coupon WELCOME10 and PIN code", async () => {
    await page.goto(`${BASE}/cart`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="cart-line"]', { timeout: 20000 });
    await page.type('[data-testid="coupon-input"]', "WELCOME10");
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-testid="coupon-status"]', { timeout: 20000 });
    const pin = await page.$('input[placeholder="PIN code"]');
    if (!pin) throw new Error("PIN code field missing");
    await pin.type("620001");
    await pin.press("Enter");
    await sleep(1500);
    await shot(page, "cart-desktop");
    console.log("      coupon:", (await page.$eval('[data-testid="coupon-status"]', (e) => e.textContent)).trim());
  });

  await step("checkout: OTP sign-in with a test phone", async () => {
    await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="otp-target"]', { timeout: 20000 });
    await page.type('[data-testid="otp-target"]', phone);
    await page.click('[data-testid="otp-send"]');
    await page.waitForSelector('input[autocomplete="one-time-code"]', { timeout: 20000 });
    await page.focus('input[autocomplete="one-time-code"]');
    await page.keyboard.type(OTP, { delay: 40 });
    await page.waitForSelector('[data-testid="address-form"]', { timeout: 30000 });
  });

  await step("checkout: address and delivery", async () => {
    const f = (sel) => `[data-testid="address-form"] ${sel}`;
    await page.type(f('input[autocomplete="name"]'), SHOPPER);
    if (!(await page.$eval(f('input[autocomplete="tel-national"]'), (e) => e.value))) await page.type(f('input[autocomplete="tel-national"]'), phone);
    await page.type(f('input[autocomplete="postal-code"]'), "620001");
    await sleep(2000); // PIN code autofill
    await page.type(f('input[autocomplete="address-line1"]'), "12, Big Bazaar Street");
    await page.click('[data-testid="address-save"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="address-form"]'), { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('input[name="delivery"]').length > 0, { timeout: 20000 });
    await sleep(500);
    await shot(page, "checkout-desktop");
  });

  let orderUrl = "";
  await step("pay online (mock provider) → order confirmation", async () => {
    await page.click('[data-testid="place-order"]');
    await page.waitForSelector('[data-testid="mock-payment"]', { timeout: 30000 });
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="mock-payment"] button')].find((b) => /test UPI/i.test(b.textContent))?.click());
    await page.waitForSelector('[data-testid="order-confirmation"]', { timeout: 60000 });
    await sleep(1200);
    await shot(page, "order-desktop");
    orderUrl = page.url();
    console.log("      order:", orderUrl);
  });

  await step("order lines add up to the charged prices (no paisa drift)", async () => {
    const r = await page.evaluate(() => {
      const paise = (t) => Math.round(Number(String(t).replace(/[^\d.]/g, "")) * 100);
      const dl = [...document.querySelectorAll("dl")].find((d) => d.querySelector("dd"));
      const rows = Object.fromEntries([...(dl?.querySelectorAll("div") ?? [])].map((d) => [d.querySelector("dt")?.textContent?.trim(), d.querySelector("dd")?.textContent ?? ""]));
      const items = [...(dl?.previousElementSibling?.querySelectorAll("li") ?? [])].map((li) => {
        const spans = li.querySelectorAll(":scope > span");
        const unit = /([\d.]+)\s*×\s*(.+)$/.exec(li.querySelector(".text-xs")?.textContent ?? "");
        return { qty: unit ? Number(unit[1]) : 0, price: unit ? paise(unit[2]) : 0, total: paise(spans[spans.length - 1]?.textContent ?? "") };
      });
      return { items, subtotal: paise(rows.Subtotal ?? ""), discount: paise(rows.Discount ?? "0") };
    });
    if (!r.items.length) throw new Error("no order lines found on the order page");
    const lines = r.items.reduce((s, l) => s + l.total, 0);
    const gross = r.items.reduce((s, l) => s + Math.round(l.qty * l.price), 0);
    if (gross !== r.subtotal) throw new Error(`qty × price ${gross} ≠ subtotal ${r.subtotal}`);
    if (lines !== r.subtotal - r.discount) throw new Error(`line totals ${lines} ≠ subtotal − discount ${r.subtotal - r.discount} (${JSON.stringify(r.items)})`);
    console.log(`      lines ${(lines / 100).toFixed(2)} = subtotal ${(r.subtotal / 100).toFixed(2)} − discount ${(r.discount / 100).toFixed(2)}`);
  });

  await step("track page and account orders", async () => {
    await page.goto(orderUrl.replace("/order/", "/track/"), { waitUntil: "networkidle2" });
    await shot(page, "track-desktop");
    await page.goto(`${BASE}/account`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="orders-list"]', { timeout: 20000 });
    await shot(page, "account-desktop");
  });

  await step("phone width: home, product, cart, checkout", async () => {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await shot(page, "home-phone");
    await page.goto(`${BASE}/p/${PRODUCT}`, { waitUntil: "networkidle2" });
    await page.evaluate(() => [...document.querySelectorAll("fieldset button")].find((b) => b.textContent.trim() === "M")?.click());
    await sleep(300);
    await shot(page, "product-phone");
    await page.click('[data-testid="add-to-cart"]');
    await page.waitForSelector('[data-testid="mini-cart"]', { timeout: 20000 });
    await page.goto(`${BASE}/cart`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="cart-line"]', { timeout: 20000 });
    await shot(page, "cart-phone");
    await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.querySelectorAll('input[name="delivery"]').length > 0, { timeout: 20000 });
    await shot(page, "checkout-phone");
  });

  await step("cash on delivery order (when offered)", async () => {
    const cod = await page.$('[data-testid="pay-cod"]');
    if (!cod || (await page.$eval('[data-testid="pay-cod"]', (e) => e.disabled))) return console.log("      COD not offered here; skipped");
    await cod.click();
    await page.click('[data-testid="place-order"]');
    await page.waitForSelector('[data-testid="order-confirmation"]', { timeout: 60000 });
    await shot(page, "order-phone");
  });

  await step("search and Tamil product page", async () => {
    await page.goto(`${BASE}/search?q=kurti`, { waitUntil: "networkidle2" });
    await shot(page, "search-phone");
    await page.setViewport({ width: 1366, height: 900 });
    await page.setCookie({ name: "sr_locale", value: "ta", domain: HOST, path: "/" });
    await page.goto(`${BASE}/p/${PRODUCT}`, { waitUntil: "networkidle2" });
    await shot(page, "product-tamil-desktop");
  });

  await step("no page errors or server errors", async () => {
    const all = [...pageErrors, ...httpErrors];
    if (all.length) throw new Error(all.slice(0, 10).join("\n"));
  });

  await browser.close();
  console.log(`${passed}/${total} passed`);
})().catch(async (e) => {
  console.error(`FAILED: ${e.message}`);
  try {
    await PG.screenshot({ path: path.join(OUT, "store-fail.png"), fullPage: true });
    console.error(`(screenshot ${path.join(OUT, "store-fail.png")})`);
  } catch {
    /* no page */
  }
  console.log(`${passed}/${total} passed`);
  process.exit(1);
});
