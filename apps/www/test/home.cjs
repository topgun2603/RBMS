// Home page browser test: the try-it counter works, its GST figures are right, and the "six jobs" panels follow the bill.
// Needs the site on BASE_URL (default http://localhost:3005). CHROME_PATH as in e2e.cjs. Expected figures are worked by hand.
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3005";
const CHROME =
  process.env.CHROME_PATH ||
  { win32: "C:/Program Files/Google/Chrome/Application/chrome.exe", darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }[process.platform] ||
  "/usr/bin/google-chrome";

function loadPuppeteer() {
  const candidates = [path.join(__dirname, "../../../packages/documents/node_modules/puppeteer-core"), "puppeteer-core"];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* next */
    }
  }
  throw new Error("puppeteer-core not found");
}

let failed = 0;
const check = (name, got, want) => {
  const pass = got === want;
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${got}${pass ? "" : ` (wanted ${want})`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page, id) => page.$eval(`[data-testid="${id}"]`, (e) => e.textContent.trim().replace(/\s+/g, " "));
/** A real click, on a button brought to mid-screen first: at the edge, the sticky header can sit on top of it. */
const tap = async (page, id) => {
  const sel = `[data-testid="${id}"]`;
  await page.$eval(sel, (e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(120);
  await page.click(sel);
};
const has = async (page, id) => (await page.$(`[data-testid="${id}"]`)) !== null;

(async () => {
  const browser = await loadPuppeteer().launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const errors = [];
  const open = async (width, height, url) => {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
    await page.goto(`${BASE}${url}`, { waitUntil: "networkidle2", timeout: 180000 });
    // Smooth scrolling would move a button between the robot aiming and clicking.
    await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
    return page;
  };

  const page = await open(1440, 900, "/?lang=en");
  // Touching the counter stops the opening demo.
  await tap(page, "new-bill");
  await sleep(5000);
  check("new bill stays empty", await has(page, "receipt-total"), false);
  check("no stamp on an empty bill", await has(page, "receipt-stamp"), false);

  // Charger ₹299 at 18%: taxable 25339, tax 4561, so CGST 2281 and SGST 2280.
  await tap(page, "item-charger");
  // Cola ₹45 at 40% twice: taxable 6429, tax 2571, so CGST 1286 and SGST 1285.
  await tap(page, "item-cola");
  await tap(page, "item-cola");
  await sleep(500);
  const row = (r) => page.$eval(`[data-testid="receipt"] tr[data-rate="${r}"]`, (e) => [...e.children].map((c) => c.textContent).join(" | "));
  check("total", await text(page, "receipt-total"), "₹389.00");
  check("18% row", await row(18), "18% | 253.39 | 22.81 | 22.80");
  check("40% row", await row(40), "40% | 64.29 | 12.86 | 12.85");
  check("charger stock", await text(page, "stock-charger"), "6 → 5");
  check("cola stock", await text(page, "stock-cola"), "7 → 5");

  await tap(page, "pay-credit");
  await sleep(900);
  check("credit stamp", await text(page, "receipt-stamp"), "ON CREDIT");
  check("credit book grows", await text(page, "credit-balance"), "₹1,629.00");
  check("drawer unmoved by credit", await text(page, "till-drawer"), "₹10,340.00");
  check("WhatsApp says credit", (await text(page, "whatsapp-receipt")).includes("added to your credit book"), true);

  await tap(page, "pay-cash");
  await sleep(700);
  check("cash stamp", await text(page, "receipt-stamp"), "PAID · CASH");
  check("credit book back", await text(page, "credit-balance"), "₹1,240.00");
  check("drawer takes the cash", await text(page, "till-drawer"), "₹10,729.00");

  await tap(page, "slip-lang-ta");
  await sleep(300);
  check("slip in Tamil", (await text(page, "receipt")).includes("போன் சார்ஜர்"), true);

  await tap(page, "item-oil");
  await sleep(500);
  check("next bill starts clean", await text(page, "receipt-total"), "₹165.00");
  check("stamp cleared", await has(page, "receipt-stamp"), false);
  check("hero sign-up link", await page.$eval('[data-testid="hero-trial"]', (e) => e.getAttribute("href")), "/signup");

  // The store: a shopper orders, the shop gets it, against the same stock the counter sells from.
  const shop = await open(1440, 900, "/?lang=en");
  await tap(shop, "new-bill");
  await tap(shop, "item-cola");
  await tap(shop, "tab-store");
  check("empty cart can't pay", await shop.$eval('[data-testid="store-pay-upi"]', (e) => e.disabled), true);
  await tap(shop, "store-item-cola");
  await tap(shop, "store-item-oil");
  await sleep(300);
  check("store total 45 + 165", await text(shop, "store-total"), "₹210.00");
  await tap(shop, "store-pay-cod");
  await sleep(1200);
  check("order placed", (await text(shop, "store-order")).includes("Cash on delivery"), true);
  check("same stock: 7, less 1 on the counter, less 1 online", (await text(shop, "store-stock-cola")).endsWith("6 → 5"), true);
  check("both products priced", (await text(shop, "two-products")).includes("From ₹799 a month, billing included"), true);
  check("old slogan gone", /six jobs|one bill/i.test(await shop.evaluate(() => document.body.innerText)), false);
  await shop.close();

  // Every width and language: nothing scrolls sideways, and no Tamil poster word breaks across lines.
  for (const [w, h, url] of [[320, 640, "/?lang=ta"], [390, 844, "/?lang=ta"], [390, 844, "/?lang=en"], [640, 900, "/?lang=ta"], [768, 1024, "/?lang=ta"], [820, 1100, "/?lang=ta"], [1024, 768, "/?lang=ta"], [1440, 900, "/?lang=ta"], [1920, 1080, "/?lang=en"]]) {
    const p = await open(w, h, url);
    const r = await p.evaluate(() => ({
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // No single word wider than the column, so nothing can break inside a word.
      words: [...document.querySelectorAll("h1 span.block")].every((s) => { const o = s.style.whiteSpace; s.style.whiteSpace = "nowrap"; const widest = s.textContent.split(" ").every((w) => { const m = document.createElement("span"); m.textContent = w; s.append(m); const ok = m.getBoundingClientRect().width <= s.parentElement.getBoundingClientRect().width; m.remove(); return ok; }); s.style.whiteSpace = o; return widest; }),
      lines: [...document.querySelectorAll("h1 span.block")].map((s) => {
        const range = document.createRange();
        range.selectNodeContents(s);
        // Runs on one line can differ by a few pixels (Tamil glyphs beside a Latin full stop): group by half the type size.
        const size = parseFloat(getComputedStyle(s).fontSize);
        const tops = [...range.getClientRects()].map((c) => (c.top + c.bottom) / 2).sort((x, y) => x - y);
        return tops.filter((v, i) => i === 0 || v - tops[i - 1] > size / 2).length;
      }),
    }));
    check(`${w}px ${url} no sideways scroll`, r.over, 0);
    if (url.includes("ta")) check(`${w}px ${url} Tamil hero wraps only between words`, r.lines.every((n) => n <= 2) && r.words, true);
    else check(`${w}px ${url} hero is three lines`, r.lines.join(","), "1,1,1");
    await p.close();
  }

  // Reduced motion: no demo, everything on screen.
  const still = await browser.newPage();
  await still.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await still.goto(`${BASE}/?lang=en`, { waitUntil: "networkidle2", timeout: 180000 });
  await sleep(5500);
  check("reduced motion: demo does not run", await has(still, "receipt-stamp"), false);
  check("reduced motion: starting bill shown", await text(still, "receipt-total"), "₹354.00");
  check("reduced motion: tape not animated", await still.$eval(".tape-track", (e) => getComputedStyle(e).animationName), "none");

  // The old names never reach a visitor: visible text, title and description, on every page, in both languages.
  for (const route of ["/", "/pricing", "/billing", "/online-store", "/industries", "/demo", "/signup", "/login", "/terms", "/privacy", "/refunds"]) {
    for (const lang of ["en", "ta"]) {
      const p = await browser.newPage();
      await p.goto(`${BASE}${route}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180000 });
      const seen = await p.evaluate(() => [document.body.innerText, document.title, document.querySelector("meta[name=description]")?.content].join(" "));
      check(`${route} ${lang} has no old name`, /srikit|sri ?realtime/i.test(seen), false);
      await p.close();
    }
  }

  check("browser errors", errors.join(" | "), "");
  await browser.close();
  if (failed) {
    console.error(`${failed} failed`);
    process.exit(1);
  }
  console.log("all passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
