import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  curlSample,
  eventsForApi,
  expiryInFuture,
  expiryToIso,
  groupByModule,
  groupEvents,
  groupScopes,
  groupState,
  matchesQuery,
  maskedKey,
  NODE_VERIFY_SAMPLE,
  prettyMaybeJson,
  relativeTime,
  samplePayload,
  shortUrl,
  toggleGroup,
  toggleKey,
  tomorrowIST,
  truncateBytes,
  urlProblem,
} from "./developer";
import { en, ta } from "./messages/developer";
import type { ScopeDef, WebhookEventDef } from "./types";

describe("developer messages", () => {
  it("has the same keys in English and Tamil, all under growth.developer.", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(k.startsWith("growth.developer.")).toBe(true);
  });

  it("keeps the same placeholders in both languages and writes Tamil in Tamil script", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en)) {
      expect(vars(ta[k]!), k).toEqual(vars(en[k]!));
      if (/[a-z]{4,}/i.test(en[k]!.replace(/\{[^}]*\}/g, "")) && !/^(WhatsApp|\{ms\} ms)$/.test(ta[k]!)) expect(ta[k], k).toMatch(/[஀-௿]/);
    }
  });
});

const scopes: ScopeDef[] = [
  { key: "audit.view", module: "audit", label: "View activity log", description: "Read the audit log." },
  { key: "invoices.create", module: "invoices", label: "Create bills", description: "Make new bills." },
  { key: "invoices.cancel", module: "invoices", label: "Cancel bills", description: "Cancel issued bills." },
];
const events: WebhookEventDef[] = [
  { type: "order.created", module: "orders", label: "Order placed", description: "A new order.", sample: { id: "o1" } },
  { type: "invoice.paid", module: "invoices", label: "Bill fully paid", description: "Balance reached zero.", sample: { id: "i1" } },
];

describe("grouping and search", () => {
  it("groups by module in first-seen order", () => {
    expect(groupByModule(scopes).map((g) => [g.module, g.items.length])).toEqual([
      ["audit", 1],
      ["invoices", 2],
    ]);
  });

  it("matches every word, case-insensitively, across fields", () => {
    expect(matchesQuery("", "x")).toBe(true);
    expect(matchesQuery("CANCEL bills", "invoices.cancel", "Cancel bills")).toBe(true);
    expect(matchesQuery("cancel audit", "invoices.cancel", "Cancel bills")).toBe(false);
  });

  it("filters scopes and drops empty groups", () => {
    const g = groupScopes(scopes, "cancel");
    expect(g).toHaveLength(1);
    expect(g[0]!.items.map((s) => s.key)).toEqual(["invoices.cancel"]);
    expect(groupScopes(scopes, "invoices.").flatMap((x) => x.items)).toHaveLength(2);
  });

  it("filters events by type or label", () => {
    expect(groupEvents(events, "order.created")[0]!.items[0]!.type).toBe("order.created");
    expect(groupEvents(events, "paid")[0]!.module).toBe("invoices");
    expect(groupEvents(events, "nothing")).toEqual([]);
  });
});

describe("selection", () => {
  it("reports the tri-state of a group", () => {
    expect(groupState([], new Set())).toBe(false);
    expect(groupState(["a", "b"], new Set())).toBe(false);
    expect(groupState(["a", "b"], new Set(["a"]))).toBe("indeterminate");
    expect(groupState(["a", "b"], new Set(["a", "b", "c"]))).toBe(true);
  });

  it("selects all of a group, then clears it, leaving others alone", () => {
    const one = toggleGroup(new Set(["x", "a"]), ["a", "b"]);
    expect([...one].sort()).toEqual(["a", "b", "x"]);
    const two = toggleGroup(one, ["a", "b"]);
    expect([...two]).toEqual(["x"]);
  });

  it("toggles one key without mutating the input", () => {
    const s = new Set(["a"]);
    expect([...toggleKey(s, "b")].sort()).toEqual(["a", "b"]);
    expect([...toggleKey(s, "a")]).toEqual([]);
    expect([...toggleKey(s, "a", true)]).toEqual(["a"]);
    expect([...s]).toEqual(["a"]);
  });

  it("sends ['*'] for all events and strips '*' otherwise", () => {
    expect(eventsForApi(["a", "b"], true)).toEqual(["*"]);
    expect(eventsForApi(new Set(["a", "*", "a"]), false)).toEqual(["a"]);
  });
});

describe("expiry", () => {
  const now = new Date("2026-10-16T06:00:00.000Z");

  it("maps presets to ISO timestamps", () => {
    expect(expiryToIso("never", "", now)).toBeNull();
    expect(expiryToIso("30d", "", now)).toBe("2026-11-15T06:00:00.000Z");
    expect(expiryToIso("90d", "", now)).toBe("2027-01-14T06:00:00.000Z");
    expect(expiryToIso("1y", "", now)).toBe("2027-10-16T06:00:00.000Z");
  });

  it("uses the end of the chosen day in IST for a custom date", () => {
    expect(expiryToIso("custom", "2026-12-31", now)).toBe("2026-12-31T18:29:59.000Z");
    expect(expiryToIso("custom", "", now)).toBeUndefined();
    expect(expiryToIso("custom", "31/12/2026", now)).toBeUndefined();
  });

  it("knows whether an expiry is in the future", () => {
    expect(expiryInFuture(null, now)).toBe(true);
    expect(expiryInFuture(undefined, now)).toBe(false);
    expect(expiryInFuture("2026-10-15T00:00:00.000Z", now)).toBe(false);
    expect(expiryInFuture("2026-10-17T00:00:00.000Z", now)).toBe(true);
  });

  it("gives tomorrow in IST", () => {
    // 2026-10-16 20:00 UTC is already the 17th in IST, so tomorrow is the 18th.
    expect(tomorrowIST(new Date("2026-10-16T20:00:00.000Z"))).toBe("2026-10-18");
    expect(tomorrowIST(now)).toBe("2026-10-17");
  });
});

describe("display helpers", () => {
  it("masks a key prefix", () => {
    expect(maskedKey("sk_live_Ab3x")).toBe("sk_live_Ab3x…");
  });

  it("formats relative times", () => {
    const now = new Date("2026-10-16T06:00:00.000Z");
    expect(relativeTime("2026-10-16T05:57:00.000Z", "en", now)).toBe("3 minutes ago");
    expect(relativeTime("2026-10-16T08:00:00.000Z", "en", now)).toBe("in 2 hours");
    expect(relativeTime("2026-10-15T06:00:00.000Z", "en", now)).toBe("yesterday");
    expect(relativeTime(now, "ta", now)).toBeTypeOf("string");
  });

  it("shortens URLs and tolerates junk", () => {
    expect(shortUrl("https://example.com/hooks/srikit?x=1")).toBe("example.com/hooks/srikit");
    expect(shortUrl("https://example.com/")).toBe("example.com");
    expect(shortUrl("not a url")).toBe("not a url");
  });

  it("checks webhook URLs", () => {
    expect(urlProblem("  ")).toBe("empty");
    expect(urlProblem("example.com")).toBe("invalid");
    expect(urlProblem("ftp://example.com")).toBe("scheme");
    expect(urlProblem("http://localhost:3000/hook")).toBe("http");
    expect(urlProblem("https://example.com/hook")).toBeNull();
  });

  it("truncates by UTF-8 bytes without splitting characters", () => {
    expect(truncateBytes("hello", 10)).toEqual({ text: "hello", truncated: false });
    const r = truncateBytes("தமிழ்தமிழ்", 7); // 3 bytes per character
    expect(r.truncated).toBe(true);
    expect(new TextEncoder().encode(r.text).length).toBeLessThanOrEqual(7);
    expect(r.text).toBe("தம");
  });

  it("pretty-prints JSON bodies only", () => {
    expect(prettyMaybeJson('{"ok":true}')).toBe('{\n  "ok": true\n}');
    expect(prettyMaybeJson("OK")).toBe("OK");
    expect(prettyMaybeJson("{broken")).toBe("{broken");
  });
});

describe("samples and docs", () => {
  it("wraps an event sample as the real payload", () => {
    const p = samplePayload(events[1]!, "my-shop");
    expect(p).toMatchObject({ type: "invoice.paid", tenant: { slug: "my-shop" }, data: { id: "i1" } });
    expect(typeof p.id).toBe("string");
    expect(Number.isNaN(Date.parse(p.createdAt))).toBe(false);
  });

  it("builds a curl call with the shop slug", () => {
    const s = curlSample("http://localhost:4000/v1/", "e2e-bill");
    expect(s).toContain("http://localhost:4000/v1/invoices");
    expect(s).toContain('x-tenant: e2e-bill"');
    expect(s).toContain("Bearer sk_live_");
    expect(curlSample("http://x/v1", "")).toContain("<shop slug>");
  });

  it("the Node sample verifies like the server does", () => {
    expect(NODE_VERIFY_SAMPLE).toContain('express.raw({ type: "application/json" })');
    expect(NODE_VERIFY_SAMPLE).toContain("timingSafeEqual");
    expect(NODE_VERIFY_SAMPLE).toContain("x-srikit-signature");
    // Same formula as packages/developer/src/signature.ts: hex HMAC-SHA256(secret, `${t}.${body}`).
    const body = '{"id":"e1"}';
    const v1 = createHmac("sha256", "whsec_test").update(`1760524200.${body}`, "utf8").digest("hex");
    expect(v1).toMatch(/^[0-9a-f]{64}$/);
    expect(NODE_VERIFY_SAMPLE).toContain("`${t}.${rawBody}`");
  });
});
