import { describe, expect, it } from "vitest";
import {
  bareHost,
  DailySalt,
  eventTime,
  ingestSchema,
  istDate,
  parseUtm,
  RateLimiter,
  referrerHost,
  toEventRows,
} from "./ingest";
import { assembleOverview, conversionRate, withProductNames, type DatedMetricRow } from "./overview";
import { aggregateDay, METRICS, sourceOf, type RollupEvent } from "./rollup";
import { deviceOf, isBot } from "./ua";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const UA = {
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  cubot: "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
};

describe("ingest validation", () => {
  const ok = { anonymousId: "anon_12345678", sessionId: "sess-12345678", events: [{ type: "page_view", path: "/" }] };

  it("accepts a valid batch", () => {
    expect(ingestSchema.parse(ok).events).toHaveLength(1);
  });

  it("rejects bad ids, types, too many events and bad values", () => {
    expect(ingestSchema.safeParse({ ...ok, anonymousId: "x" }).success).toBe(false);
    expect(ingestSchema.safeParse({ ...ok, sessionId: "has space 1234" }).success).toBe(false);
    expect(ingestSchema.safeParse({ ...ok, events: [] }).success).toBe(false);
    expect(ingestSchema.safeParse({ ...ok, events: [{ type: "click" }] }).success).toBe(false);
    expect(ingestSchema.safeParse({ ...ok, events: Array(51).fill({ type: "page_view" }) }).success).toBe(false);
    expect(ingestSchema.safeParse({ ...ok, events: Array(50).fill({ type: "page_view" }) }).success).toBe(true);
    expect(ingestSchema.safeParse({ ...ok, events: [{ type: "purchase", value: -1 }] }).success).toBe(false);
    expect(ingestSchema.safeParse({ ...ok, events: [{ type: "purchase", value: 1.5 }] }).success).toBe(false);
    expect(ingestSchema.safeParse({ ...ok, events: [{ type: "product_view", productId: "nope" }] }).success).toBe(false);
    expect(ingestSchema.safeParse({ ...ok, events: [{ type: "page_view", at: "yesterday" }] }).success).toBe(false);
  });

  it("only trusts recent client timestamps", () => {
    const now = new Date("2026-10-15T10:00:00Z");
    expect(eventTime("2026-10-15T09:00:00Z", now).toISOString()).toBe("2026-10-15T09:00:00.000Z");
    expect(eventTime("2026-10-13T09:00:00Z", now)).toBe(now);
    expect(eventTime("2026-10-15T11:00:00Z", now)).toBe(now);
    expect(eventTime(null, now)).toBe(now);
  });
});

describe("bots", () => {
  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "WhatsApp/2.23.20.0 A",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (Linux; Android 11) Chrome-Lighthouse",
    "curl/8.4.0",
    "python-requests/2.31.0",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "",
    "Mozilla/5.0",
  ])("detects %s", (ua) => expect(isBot(ua)).toBe(true));

  it("passes real browsers", () => {
    for (const ua of Object.values(UA)) expect(isBot(ua)).toBe(false);
    expect(isBot(null)).toBe(true);
  });
});

describe("devices", () => {
  it("classifies user agents", () => {
    expect(deviceOf(UA.chromeDesktop)).toBe("desktop");
    expect(deviceOf(UA.chromeAndroid)).toBe("mobile");
    expect(deviceOf(UA.iphone)).toBe("mobile");
    expect(deviceOf(UA.ipad)).toBe("tablet");
    expect(deviceOf(UA.androidTablet)).toBe("tablet");
    expect(deviceOf(UA.cubot)).toBe("mobile");
    expect(deviceOf(null)).toBe("desktop");
  });
});

describe("referrers and UTM", () => {
  it("extracts bare referrer hosts and ignores self-referrals", () => {
    const self = ["raja.srikit.in", "www.rajastores.in:443"];
    expect(referrerHost("https://www.google.com/search?q=saree", self)).toBe("google.com");
    expect(referrerHost("https://l.instagram.com/?u=x", self)).toBe("l.instagram.com");
    expect(referrerHost("android-app://com.google.android.gm/", self)).toBe("com.google.android.gm");
    expect(referrerHost("https://raja.srikit.in/products/x", self)).toBeNull();
    expect(referrerHost("https://rajastores.in/cart", self)).toBeNull();
    expect(referrerHost("http://WWW.RajaStores.in/", self)).toBeNull();
    expect(referrerHost("not a url", self)).toBeNull();
    expect(referrerHost("javascript:alert(1)", self)).toBeNull();
    expect(referrerHost(null, self)).toBeNull();
    expect(bareHost("Shop.Example.com.:8080")).toBe("shop.example.com");
  });

  it("parses UTM from the object or the path", () => {
    expect(parseUtm({ source: " Instagram ", medium: "Social", campaign: "Diwali" })).toEqual({
      source: "instagram",
      medium: "social",
      campaign: "diwali",
    });
    expect(parseUtm(null, "/p/saree?utm_source=whatsapp&utm_campaign=sale#top")).toEqual({
      source: "whatsapp",
      medium: null,
      campaign: "sale",
    });
    expect(parseUtm({}, "/")).toEqual({ source: null, medium: null, campaign: null });
  });

  it("builds rows: device, hashed ip, clean path, normalised query", () => {
    const now = new Date("2026-10-15T10:00:00Z");
    const input = ingestSchema.parse({
      anonymousId: "anon_12345678",
      sessionId: "sess_12345678",
      events: [
        { type: "page_view", path: "/?utm_source=Google", referrer: "https://www.google.com/" },
        { type: "search", query: "  Silk   SAREE " },
      ],
    });
    const rows = toEventRows("t1", input, { userAgent: UA.iphone, ipHash: "h", selfHosts: ["shop.in"], now });
    expect(rows[0]).toMatchObject({ path: "/", utmSource: "google", referrerHost: "google.com", device: "mobile", ipHash: "h" });
    expect(rows[1]).toMatchObject({ type: "search", query: "silk saree", at: now });
  });
});

describe("ip hashing and rate limiting", () => {
  it("hashes with a salt that rotates per IST day", () => {
    const s = new DailySalt("secret");
    const a = s.hashIp("1.2.3.4", new Date("2026-10-15T10:00:00Z"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("1.2.3.4");
    expect(s.hashIp("1.2.3.4", new Date("2026-10-15T18:00:00Z"))).toBe(a); // 23:30 IST, same day
    expect(s.hashIp("1.2.3.4", new Date("2026-10-15T18:31:00Z"))).not.toBe(a); // next IST day
    expect(new DailySalt("other").hashIp("1.2.3.4", new Date("2026-10-15T10:00:00Z"))).not.toBe(a);
    expect(s.hashIp(null)).toBeNull();
    expect(() => new DailySalt("")).toThrow();
  });

  it("limits per key per window", () => {
    const rl = new RateLimiter(3, 60_000);
    expect([1, 2, 3, 4].map(() => rl.hit("ip", 0))).toEqual([true, true, true, false]);
    expect(rl.hit("other", 0)).toBe(true);
    expect(rl.hit("ip", 60_001)).toBe(true);
  });
});

const ev = (e: Partial<RollupEvent> & Pick<RollupEvent, "type" | "sessionId" | "anonymousId">, minute = 0): RollupEvent => ({
  at: new Date(Date.UTC(2026, 9, 15, 4, minute)),
  productId: null,
  value: null,
  query: null,
  referrerHost: null,
  utmSource: null,
  device: "mobile",
  ...e,
});

const metric = (rows: { metric: string; dimension: string; value: number }[], m: string, d = "") =>
  rows.find((r) => r.metric === m && r.dimension === d)?.value;

describe("rollup aggregation", () => {
  const events: RollupEvent[] = [
    // visitor A, session 1 from instagram on mobile: views P1, adds to cart, checks out, buys
    ev({ type: "page_view", sessionId: "s1", anonymousId: "A", utmSource: "instagram", referrerHost: "l.instagram.com" }, 0),
    ev({ type: "product_view", sessionId: "s1", anonymousId: "A", productId: P1 }, 1),
    ev({ type: "add_to_cart", sessionId: "s1", anonymousId: "A", productId: P1, value: 50000 }, 2),
    ev({ type: "begin_checkout", sessionId: "s1", anonymousId: "A" }, 3),
    ev({ type: "purchase", sessionId: "s1", anonymousId: "A", productId: P1, value: 59000 }, 4),
    // visitor A again, session 2 direct on desktop (first event decides)
    ev({ type: "page_view", sessionId: "s2", anonymousId: "A", device: "desktop" }, 30),
    ev({ type: "search", sessionId: "s2", anonymousId: "A", query: "silk saree", device: "desktop" }, 31),
    // visitor B from google
    ev({ type: "page_view", sessionId: "s3", anonymousId: "B", referrerHost: "google.com" }, 10),
    ev({ type: "product_view", sessionId: "s3", anonymousId: "B", productId: P2 }, 11),
    ev({ type: "product_view", sessionId: "s3", anonymousId: "B", productId: P1 }, 12),
    ev({ type: "search", sessionId: "s3", anonymousId: "B", query: "silk saree" }, 13),
    ev({ type: "remove_from_cart", sessionId: "s3", anonymousId: "B", productId: P2 }, 14),
  ];

  it("counts totals, distinct visitors and sessions", () => {
    const rows = aggregateDay(events);
    expect(metric(rows, METRICS.visitors)).toBe(2);
    expect(metric(rows, METRICS.sessions)).toBe(3);
    expect(metric(rows, METRICS.pageViews)).toBe(3);
    expect(metric(rows, METRICS.productViews)).toBe(3);
    expect(metric(rows, METRICS.addToCart)).toBe(1);
    expect(metric(rows, METRICS.removeFromCart)).toBe(1);
    expect(metric(rows, METRICS.checkouts)).toBe(1);
    expect(metric(rows, METRICS.purchases)).toBe(1);
    expect(metric(rows, METRICS.revenue)).toBe(59000);
  });

  it("splits sessions by source, device and funnel step", () => {
    const rows = aggregateDay([...events].reverse()); // order of input doesn't matter
    expect(metric(rows, METRICS.sourceSessions, "instagram")).toBe(1);
    expect(metric(rows, METRICS.sourceSessions, "google.com")).toBe(1);
    expect(metric(rows, METRICS.sourceSessions, "direct")).toBe(1);
    expect(metric(rows, METRICS.deviceSessions, "mobile")).toBe(2);
    expect(metric(rows, METRICS.deviceSessions, "desktop")).toBe(1);
    expect(metric(rows, METRICS.funnelSessions, "visit")).toBe(3);
    expect(metric(rows, METRICS.funnelSessions, "product_view")).toBe(2);
    expect(metric(rows, METRICS.funnelSessions, "add_to_cart")).toBe(1);
    expect(metric(rows, METRICS.funnelSessions, "purchase")).toBe(1);
  });

  it("tracks products and searches", () => {
    const rows = aggregateDay(events);
    expect(metric(rows, METRICS.productViewsBy, P1)).toBe(2);
    expect(metric(rows, METRICS.productViewsBy, P2)).toBe(1);
    expect(metric(rows, METRICS.productAddToCartBy, P1)).toBe(1);
    expect(metric(rows, METRICS.productPurchasesBy, P1)).toBe(1);
    expect(metric(rows, METRICS.productAddToCartBy, P2)).toBeUndefined();
    expect(metric(rows, METRICS.searches, "silk saree")).toBe(2);
  });

  it("is empty for no events; source precedence", () => {
    expect(aggregateDay([])).toEqual([]);
    expect(sourceOf({ utmSource: "wa", referrerHost: "google.com" })).toBe("wa");
    expect(sourceOf({ utmSource: null, referrerHost: null })).toBe("direct");
  });
});

describe("overview", () => {
  it("conversion rate math", () => {
    expect(conversionRate(0, 0)).toBe(0);
    expect(conversionRate(1, 3)).toBe(33.33);
    expect(conversionRate(5, 200)).toBe(2.5);
    expect(conversionRate(2, 2)).toBe(100);
  });

  it("sums days, zero-fills the trend and sorts lists", () => {
    const day1 = aggregateDay([
      ev({ type: "page_view", sessionId: "s1", anonymousId: "A", referrerHost: "google.com" }),
      ev({ type: "product_view", sessionId: "s1", anonymousId: "A", productId: P1 }),
      ev({ type: "purchase", sessionId: "s1", anonymousId: "A", productId: P1, value: 10000 }),
    ]).map((r): DatedMetricRow => ({ date: "2026-10-13", ...r }));
    const day3 = aggregateDay([
      ev({ type: "page_view", sessionId: "s2", anonymousId: "A", device: "desktop" }),
      ev({ type: "product_view", sessionId: "s2", anonymousId: "A", productId: P2, device: "desktop" }),
      ev({ type: "product_view", sessionId: "s3", anonymousId: "B", productId: P2 }),
      ev({ type: "search", sessionId: "s3", anonymousId: "B", query: "kurti" }),
    ]).map((r): DatedMetricRow => ({ date: "2026-10-15", ...r }));
    const outside: DatedMetricRow = { date: "2026-10-01", metric: METRICS.sessions, dimension: "", value: 99 };

    const o = assembleOverview("2026-10-13", "2026-10-15", [...day1, ...day3, outside]);
    expect(o).toMatchObject({ visitors: 3, sessions: 3, productViews: 3, purchases: 1, revenue: 10000, conversionRate: 33.33 });
    expect(o.trend).toEqual([
      { date: "2026-10-13", visitors: 1, purchases: 1, revenue: 10000 },
      { date: "2026-10-14", visitors: 0, purchases: 0, revenue: 0 },
      { date: "2026-10-15", visitors: 2, purchases: 0, revenue: 0 },
    ]);
    expect(o.funnel).toEqual([
      { step: "visit", count: 3 },
      { step: "product_view", count: 3 },
      { step: "add_to_cart", count: 0 },
      { step: "begin_checkout", count: 0 },
      { step: "purchase", count: 1 },
    ]);
    expect(o.topProducts.map((p) => [p.productId, p.views, p.purchases])).toEqual([
      [P2, 2, 0],
      [P1, 1, 1],
    ]);
    expect(o.sources).toEqual([
      { source: "direct", sessions: 2 },
      { source: "google.com", sessions: 1 },
    ]);
    expect(o.devices).toEqual([
      { device: "mobile", sessions: 2 },
      { device: "desktop", sessions: 1 },
    ]);
    expect(o.topSearches).toEqual([{ query: "kurti", count: 1 }]);

    const named = withProductNames(o, { [P1]: "Silk saree" });
    expect(named.topProducts.map((p) => p.name)).toEqual(["Deleted product", "Silk saree"]);
  });

  it("istDate uses India time", () => {
    expect(istDate(new Date("2026-10-15T18:29:00Z"))).toBe("2026-10-15");
    expect(istDate(new Date("2026-10-15T18:30:00Z"))).toBe("2026-10-16");
  });
});
