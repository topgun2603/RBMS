import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { en, ta } from "./messages";
import { pwaEn, pwaTa } from "./messages-pwa";
import {
  brandColors,
  buildManifest,
  graphemes,
  INSTALL_DISMISS_DAYS,
  initials,
  installUi,
  isIosSafari,
  isPwaIconFile,
  manifestCategories,
  normalizeHex,
  readableOn,
  shortName,
  swCacheable,
  swStrategy,
  type InstallState,
  type SwRequestInfo,
} from "./pwa";
import { offlinePageHtml, serviceWorkerSource } from "../server/pwa";

describe("manifest names", () => {
  it("keeps short names whole and cuts long ones on words", () => {
    expect(shortName("IronFit Gym")).toBe("IronFit Gym");
    expect(shortName("Annapoorna Restaurant")).toBe("Annapoorna");
    expect(shortName("Raja & Sons Textiles")).toBe("Raja & Sons");
    expect(shortName("Raja and Co Textiles Madurai")).toBe("Raja and Co");
    expect(shortName("Sri Murugan Stores")).toBe("Sri Murugan");
    // A trailing connector is dropped.
    expect(shortName("Sri & Mega Mart", 6)).toBe("Sri");
    // One long word: cut at 12 characters.
    expect(shortName("Supercalifragilistic")).toBe("Supercalifra");
    expect(shortName("   ")).toBe("Store");
  });

  it("never exceeds 12 characters (graphemes, so Tamil isn't split mid-character)", () => {
    for (const n of ["Annapoorna Restaurant", "அன்னபூரணி உணவகம் மதுரை", "Big Bazaar Hypermarket", "ABCDEFGHIJKLMNOP"]) {
      expect(graphemes(shortName(n)).length).toBeLessThanOrEqual(12);
    }
    expect(shortName("அன்னபூரணி உணவகம் மதுரை")).toBe("அன்னபூரணி உணவகம்"); // 11 letters as read
    expect(graphemes("அன்னபூரணி")).toHaveLength(6);
  });

  it("initials for the lettermark", () => {
    expect(initials("IronFit Gym")).toBe("IG");
    expect(initials("Annapoorna Restaurant")).toBe("AR");
    expect(initials("raja")).toBe("R");
    expect(initials("The Raja & Sons Textiles")).toBe("RS");
    expect(initials("24 Seven Mart")).toBe("2S");
    // No Latin letters: empty (the icon draws a bag glyph instead of tofu).
    expect(initials("அன்னபூரணி")).toBe("");
  });
});

describe("brand colours", () => {
  it("normalises hex and picks readable ink", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#39ff14cc")).toBe("#39ff14");
    expect(normalizeHex("oklch(0.5 0.1 20)")).toBeNull();
    expect(readableOn("#39ff14")).toBe("#111111"); // neon green → black initials
    expect(readableOn("#c2410c")).toBe("#ffffff");
    expect(readableOn("#b91c1c")).toBe("#ffffff");
    expect(readableOn("#ffffff")).toBe("#111111");
  });

  it("reads primary / background from branding tokens with sensible defaults", () => {
    expect(brandColors({ colors: { primary: "#39ff14", background: "#070a08" }, mode: "dark" })).toEqual({ primary: "#39ff14", background: "#070a08" });
    expect(brandColors({ colors: { primary: "#b91c1c" } })).toEqual({ primary: "#b91c1c", background: "#ffffff" });
    expect(brandColors({ colors: {}, mode: "dark" })).toEqual({ primary: "#7c3aed", background: "#0a0a0a" });
    expect(brandColors(null)).toEqual({ primary: "#7c3aed", background: "#ffffff" });
  });
});

describe("buildManifest", () => {
  const base = {
    name: "Annapoorna Restaurant",
    businessType: "restaurant",
    locale: "en",
    colors: { primary: "#c2410c", background: "#fffaf5" },
    description: "Annapoorna Restaurant online",
    logoUrl: null,
  };

  it("names, start URL, display, colours, categories", () => {
    const m = buildManifest(base);
    expect(m).toMatchObject({
      id: "/",
      name: "Annapoorna Restaurant",
      short_name: "Annapoorna",
      description: "Annapoorna Restaurant online",
      lang: "en-IN",
      start_url: "/?source=pwa",
      scope: "/",
      display: "standalone",
      theme_color: "#c2410c",
      background_color: "#fffaf5",
      categories: ["food"],
    });
    expect(buildManifest({ ...base, locale: "ta" }).lang).toBe("ta-IN");
  });

  it("icons: 192, 512 and a maskable 512, versioned by name / colours / logo", () => {
    const m = buildManifest(base);
    expect(m.icons.map((i) => [i.sizes, i.purpose, i.type])).toEqual([
      ["192x192", "any", "image/png"],
      ["512x512", "any", "image/png"],
      ["512x512", "maskable", "image/png"],
    ]);
    for (const i of m.icons) {
      expect(i.src).toMatch(/^\/app-icon\/(192|512|maskable-512)\.png\?v=[0-9a-z]+$/);
      expect(isPwaIconFile(i.src.split("/")[2]!.split("?")[0]!)).toBe(true);
    }
    const v = (x: typeof m) => x.icons[0]!.src.split("?v=")[1];
    expect(v(buildManifest(base))).toBe(v(m)); // stable
    expect(v(buildManifest({ ...base, logoUrl: "https://cdn/x.png" }))).not.toBe(v(m)); // new logo → new icon URLs
    expect(v(buildManifest({ ...base, colors: { ...base.colors, primary: "#000000" } }))).not.toBe(v(m));
  });

  it("categories from the business pack", () => {
    expect(manifestCategories("gym")).toEqual(["fitness", "health", "sports"]);
    expect(manifestCategories("pharmacy")).toContain("health");
    expect(manifestCategories("fashion")).toEqual(["shopping", "lifestyle"]);
    expect(manifestCategories("")).toEqual(["shopping"]);
    expect(manifestCategories("unknown-pack")).toEqual(["shopping"]);
  });
});

describe("service worker routing", () => {
  const origin = "https://anbu.srikit.in";
  const uploads = ["https://api.srikit.in/v1/uploads/", "https://cdn.srikit.in/"];
  const s = (url: string, extra: Partial<SwRequestInfo> = {}) => swStrategy({ url, method: "GET", origin, uploads, ...extra });

  it("never touches cart, checkout, account, orders, the API, token pages or non-GET", () => {
    for (const p of ["/cart", "/checkout", "/checkout/pay", "/account", "/account/orders", "/order/abc?t=x", "/orders", "/api/v1/store/cart/x", "/track", "/booking/xyz", "/job/tok", "/sw.js"]) {
      expect(s(`${origin}${p}`, { mode: "navigate" }), p).toBe("bypass");
    }
    expect(s(`${origin}/`, { method: "POST", mode: "navigate" })).toBe("bypass");
    expect(s(`${origin}/p/kurti`, { method: "post" })).toBe("bypass");
    expect(s(`${origin}/?__preview=tok`, { mode: "navigate" })).toBe("bypass");
    // Client-side transitions (RSC payloads) and Next's dynamic endpoints.
    expect(s(`${origin}/p/kurti?_rsc=1x2`, { mode: "cors" })).toBe("bypass");
    expect(s(`${origin}/_next/image?url=x`)).toBe("bypass");
    // Paths that only start like a private one are pages.
    expect(s(`${origin}/cartoons`, { mode: "navigate" })).toBe("network-first");
    expect(s(`${origin}/accounting-books`, { mode: "navigate" })).toBe("network-first");
  });

  it("cache-first for hashed build files and fonts", () => {
    expect(s(`${origin}/_next/static/chunks/app-123.js`)).toBe("cache-first");
    expect(s(`${origin}/_next/static/media/jakarta.woff2`)).toBe("cache-first");
    expect(s("https://fonts.gstatic.com/s/inter/v1/x.woff2")).toBe("cache-first");
    expect(s("https://fonts.googleapis.com/css2?family=Inter")).toBe("stale-while-revalidate");
  });

  it("stale-while-revalidate for product images from the uploads URL", () => {
    expect(s("https://api.srikit.in/v1/uploads/files/t/1/kurti.jpg")).toBe("stale-while-revalidate");
    expect(s("https://api.srikit.in/v1/uploads/files/t/1/doc", { destination: "image" })).toBe("stale-while-revalidate");
    expect(s("https://cdn.srikit.in/t/1/a.webp")).toBe("stale-while-revalidate");
    expect(s("https://api.srikit.in/v1/uploads/files/t/1/invoice.pdf", { destination: "" })).toBe("bypass");
    expect(s("https://api.srikit.in/v1/store/config")).toBe("bypass");
    expect(s("https://images.pexels.com/x.jpg", { destination: "image" })).toBe("bypass");
    expect(s(`${origin}/app-icon/192.png`)).toBe("stale-while-revalidate");
  });

  it("network-first for page navigations only", () => {
    expect(s(`${origin}/`, { mode: "navigate" })).toBe("network-first");
    expect(s(`${origin}/p/kurti`, { mode: "navigate" })).toBe("network-first");
    expect(s(`${origin}/c/sarees?page=2`, { mode: "navigate" })).toBe("network-first");
    expect(s(`${origin}/p/kurti`, { mode: "cors" })).toBe("bypass");
    expect(s("not a url")).toBe("bypass");
    expect(s("chrome-extension://abc/x.js")).toBe("bypass");
  });

  const res = (status: number, headers: Record<string, string>, type = "basic") => ({ status, type, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } });

  it("never stores set-cookie, private / no-store, vary: *, opaque or non-200 responses", () => {
    expect(swCacheable(res(200, { "cache-control": "public, max-age=86400" }))).toBe(true);
    expect(swCacheable(res(200, {}, "cors"))).toBe(true);
    expect(swCacheable(res(200, { "set-cookie": "sr_cart=1" }))).toBe(false);
    expect(swCacheable(res(200, { "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate" }))).toBe(false);
    expect(swCacheable(res(200, { "cache-control": "no-store" }))).toBe(false);
    expect(swCacheable(res(200, { "cache-control": "Private" }))).toBe(false);
    expect(swCacheable(res(200, { vary: "*" }))).toBe(false);
    expect(swCacheable(res(0, {}, "opaque"))).toBe(false);
    expect(swCacheable(res(206, {}))).toBe(false);
    expect(swCacheable(res(404, {}))).toBe(false);
  });
});

describe("service worker script", () => {
  const src = serviceWorkerSource({ buildId: "build-42", uploads: ["http://localhost:4000/v1/uploads/"] });

  /** Evaluates the worker with a fake `self`; returns its listeners and the embedded rules. */
  function load() {
    const listeners: Record<string, (e: unknown) => void> = {};
    const self = { addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn), location: { origin: "http://anbu.localhost:3003" } };
    const ctx: Record<string, unknown> = { self, URL, Request: class {}, Response: class {}, caches: {}, fetch: () => Promise.reject(new Error("offline")), console };
    runInNewContext(`${src}\n;globalThis.__rules = { swStrategy, swCacheable, KEEP, PRECACHE, UPLOADS };`, ctx);
    return { listeners, rules: ctx.__rules as { swStrategy: typeof swStrategy; swCacheable: typeof swCacheable; KEEP: string[]; PRECACHE: string[]; UPLOADS: string[] } };
  }

  it("is valid JS, versioned by the build id, with install / activate / fetch handlers", () => {
    const { listeners, rules } = load();
    expect(Object.keys(listeners).sort()).toEqual(["activate", "fetch", "install", "message"]);
    expect(rules.KEEP).toEqual(["sr-store-static-build-42", "sr-store-images-build-42", "sr-store-pages-build-42"]);
    expect(rules.PRECACHE).toEqual(["/offline.html", "/app-icon/192.png"]);
    expect(src).toContain("build build-42");
  });

  it("embeds the same routing rules that are tested above", () => {
    const { rules } = load();
    const origin = "http://anbu.localhost:3003";
    const cases: [string, string?][] = [
      [`${origin}/checkout`, "navigate"],
      [`${origin}/`, "navigate"],
      [`${origin}/_next/static/chunks/a.js`],
      ["http://localhost:4000/v1/uploads/files/t/1/a.jpg"],
      [`${origin}/api/v1/store/config`],
    ];
    for (const [url, mode] of cases) {
      const info = { url, mode, method: "GET", origin, uploads: rules.UPLOADS };
      expect(rules.swStrategy(info)).toBe(swStrategy(info));
    }
  });

  it("leaves bypassed requests to the browser (no respondWith)", () => {
    const { listeners } = load();
    let responded = false;
    listeners.fetch!({ request: { url: "http://anbu.localhost:3003/checkout", method: "GET", mode: "navigate", destination: "document" }, respondWith: () => (responded = true) });
    expect(responded).toBe(false);
    listeners.fetch!({ request: { url: "http://anbu.localhost:3003/p/x", method: "POST", mode: "cors", destination: "" }, respondWith: () => (responded = true) });
    expect(responded).toBe(false);
  });
});

describe("offline page", () => {
  it("is self-contained, in the shop's name, colours and language, and escapes the name", () => {
    const html = offlinePageHtml({ name: "Raja <Textiles>", colors: { primary: "#b91c1c", background: "#ffffff" }, locale: "ta", businessType: "fashion" });
    expect(html).toContain("Raja &lt;Textiles&gt;");
    expect(html).not.toContain("<Textiles>");
    expect(html).toContain('<html lang="ta">');
    expect(html).toContain(pwaTa["pwa.offline.title"]);
    expect(html).toContain("background:#b91c1c");
    expect(html).not.toMatch(/<link[^>]+stylesheet|<script[^>]+src=/);
  });
});

describe("install banner eligibility", () => {
  const now = Date.UTC(2026, 9, 22);
  const base: InstallState = { enabled: true, pathname: "/", pagesViewed: 2, dismissedAt: null, now, standalone: false, canPrompt: true, ios: false };

  it("Chrome / Android: after 2 pages, with a captured prompt", () => {
    expect(installUi(base)).toBe("prompt");
    expect(installUi({ ...base, pagesViewed: 1 })).toBe("none");
    expect(installUi({ ...base, canPrompt: false })).toBe("none");
  });

  it("iOS Safari gets the Add to Home Screen sheet", () => {
    expect(installUi({ ...base, canPrompt: false, ios: true })).toBe("ios");
  });

  it("never on cart / checkout / account / order pages, when installed, or when the shop switched it off", () => {
    for (const p of ["/cart", "/checkout", "/account/orders", "/order/x", "/track", "/table/t1"]) expect(installUi({ ...base, pathname: p }), p).toBe("none");
    expect(installUi({ ...base, pathname: "/cartoons" })).toBe("prompt");
    expect(installUi({ ...base, standalone: true })).toBe("none");
    expect(installUi({ ...base, enabled: false })).toBe("none");
  });

  it("a dismissal is remembered for 30 days", () => {
    const day = 86_400_000;
    expect(installUi({ ...base, dismissedAt: now - 2 * day })).toBe("none");
    expect(installUi({ ...base, dismissedAt: now - (INSTALL_DISMISS_DAYS * day - 1) })).toBe("none");
    expect(installUi({ ...base, dismissedAt: now - INSTALL_DISMISS_DAYS * day })).toBe("prompt");
  });

  it("detects iOS Safari only", () => {
    const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const iphoneChrome = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
    const ipadDesktop = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
    const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
    const instagram = `${iphoneSafari} Instagram 300.0`;
    expect(isIosSafari(iphoneSafari)).toBe(true);
    expect(isIosSafari(iphoneChrome)).toBe(false);
    expect(isIosSafari(ipadDesktop, 5)).toBe(true);
    expect(isIosSafari(ipadDesktop, 0)).toBe(false); // a real Mac
    expect(isIosSafari(android)).toBe(false);
    expect(isIosSafari(instagram)).toBe(false);
  });
});

describe("pwa messages", () => {
  it("English and Tamil have the same keys and are merged into the store messages", () => {
    expect(Object.keys(pwaTa).sort()).toEqual(Object.keys(pwaEn).sort());
    for (const k of Object.keys(pwaEn)) {
      expect(en[k]).toBe(pwaEn[k]);
      expect(ta[k]).toBe(pwaTa[k]);
    }
  });
});
