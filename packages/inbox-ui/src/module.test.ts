import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchRoute, normalizeBase, type MountedModule } from "@srirealtime/web";
import { inboxLinks } from "./lib/config";
import { inboxMessages } from "./lib/messages";
import {
  AUDIENCE_KINDS,
  CAMPAIGN_STATUSES,
  CONVERSATION_TYPES,
  RECIPIENT_STATUSES,
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "./lib/types";
import { inboxModule } from "./module";

const mount = (basePath = "/inbox"): MountedModule => {
  const m = inboxModule({ basePath });
  return { ...m, basePath: normalizeBase(m.basePath) };
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });
}

const UUID = "0b6f5f36-0000-4000-8000-000000000000";
const asArray = (v: string | readonly string[] | undefined) => (v === undefined ? [] : typeof v === "string" ? [v] : [...v]);

describe("inboxModule", () => {
  const m = inboxModule();

  it("has one Inbox section with the five items, each gated by feature (and permission where the API needs one)", () => {
    expect(m.id).toBe("inbox");
    expect(m.basePath).toBe("/inbox");
    expect(m.nav).toHaveLength(1);
    expect(m.nav[0]!.title).toBe("inbox.nav.section");
    expect(m.nav[0]!.items.map((i) => [i.href, asArray(i.feature), i.permission ?? null])).toEqual([
      ["chat", ["chat"], null],
      ["whatsapp", ["whatsapp"], "whatsapp.manage"],
      ["campaigns", ["whatsapp", "whatsapp.campaigns"], "whatsapp.manage"],
      ["support", ["support"], "support.manage"],
      ["faq", ["support", "support.faq"], "support.manage"],
    ]);
  });

  it("gates every route except the overview (which only shows what the member may open)", () => {
    for (const r of m.routes) {
      if (r.path === "") continue;
      expect(asArray(r.feature).length, r.path).toBeGreaterThan(0);
      const section = r.path.split("/")[0]!;
      const item = m.nav[0]!.items.find((i) => i.href === section)!;
      expect(asArray(r.feature), r.path).toEqual(asArray(item.feature));
      expect(r.permission ?? null, r.path).toEqual(item.permission ?? null);
    }
    expect(m.routes.find((r) => r.path === "")?.feature).toBeUndefined();
  });

  it("gates widgets and actions", () => {
    expect(m.widgets?.map((w) => [w.id, asArray(w.feature), w.permission ?? null])).toEqual([
      ["inbox-unread", [], null], // checks chat / WhatsApp itself (any-of)
      ["inbox-tickets", ["support"], "support.manage"],
    ]);
    // Inbox contributes needs-attention rows only (unread chats / WhatsApp, tickets), no whole cards.
    expect(m.widgets?.every((w) => w.zone === "attention")).toBe(true);
    for (const a of m.actions ?? []) expect(asArray(a.feature).length, a.id).toBeGreaterThan(0);
    expect(m.actions?.every((a) => !a.primary)).toBe(true);
  });

  it("matches static segments before ids, at any base path", () => {
    for (const base of ["/inbox", "/"]) {
      const app = { modules: [mount(base)] } as Parameters<typeof matchRoute>[0];
      const p = (s: string) => (base === "/" ? s : `${base}${s}`);
      const at = (s: string) => matchRoute(app, p(s), (x) => x.routes);
      expect(at("/campaigns/new")?.route.path).toBe("campaigns/new");
      expect(at(`/campaigns/${UUID}`)?.params).toEqual({ id: UUID });
      expect(at("/support/new")?.route.path).toBe("support/new");
      expect(at(`/support/${UUID}`)?.route.path).toBe("support/:id");
      expect(at("/faq/new")?.route.path).toBe("faq/new");
      expect(at(`/chat/${UUID}`)?.route.path).toBe("chat/:id");
      expect(at(`/whatsapp/${UUID}`)?.route.immersive).toBe(true);
    }
  });

  it("passes the features restriction and host links through", () => {
    expect(inboxModule({ features: ["chat"] }).features).toEqual(["chat"]);
    inboxModule({ links: { invoice: (id) => `/billing/invoices/${id}` } });
    expect(inboxLinks().invoice("x")).toBe("/billing/invoices/x");
    expect(inboxLinks().order("y")).toBe("/orders/y");
    inboxModule();
    expect(inboxLinks().invoice("x")).toBe("/invoices/x");
  });
});

describe("messages", () => {
  const { en, ta } = inboxMessages;

  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });

  it("defines every literal inbox.* key used in the source", () => {
    // Feature / permission keys and query keys that look like message keys.
    const notMessages = new Set<string>();
    const used = new Set<string>();
    for (const file of sources(join(__dirname))) {
      for (const match of readFileSync(file, "utf8").matchAll(/["'`](inbox\.[a-zA-Z0-9_.-]+)["'`]/g)) used.add(match[1]!);
    }
    const missing = [...used].filter((k) => !(k in en) && !notMessages.has(k));
    expect(missing).toEqual([]);
  });

  it("defines every dynamic key family", () => {
    const families: [string, readonly string[]][] = [
      ["inbox.tick.", ["sending", "queued", "failed", "sent", "delivered", "read"]],
      ["inbox.age.", ["now", "m", "h", "d"]],
      ["inbox.chat.type.", CONVERSATION_TYPES],
      ["inbox.ticket.status.", TICKET_STATUSES],
      ["inbox.ticket.priority.", TICKET_PRIORITIES],
      ["inbox.ticket.channel.", TICKET_CHANNELS],
      ["inbox.ticket.related.", ["order", "invoice"]],
      ["inbox.sla.", ["overdue", "due_soon", "on_track", "met", "missed"]],
      ["inbox.campaign.status.", CAMPAIGN_STATUSES],
      ["inbox.campaign.count.", ["total", "sent", "delivered", "read", "failed"]],
      ["inbox.campaign.step.", ["name", "audience", "template", "schedule", "review"]],
      ["inbox.campaign.when.", ["now", "later"]],
      ["inbox.campaign.whenHint.", ["now", "later"]],
      ["inbox.recipient.", RECIPIENT_STATUSES],
      ["inbox.audience.", AUDIENCE_KINDS],
      ["inbox.audienceHint.", AUDIENCE_KINDS],
      ["inbox.map.from.", ["name", "phone", "var", "text"]],
      ["inbox.tpl.part.", ["header", "body", "button"]],
      ["inbox.tpl.media.", ["image", "document", "video"]],
      ["inbox.overview.", ["chat", "whatsapp", "campaigns", "support", "faq"]],
      ["inbox.live.", ["live", "connecting", "reconnecting", "polling", "offline"]],
      ["inbox.errors.", ["window_closed", "opted_out", "whatsapp_send_failed", "whatsapp_not_connected"]],
    ];
    const missing = families.flatMap(([prefix, values]) => values.map((v) => prefix + v)).filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it("keeps the same placeholders in both languages and never uses literal braces otherwise", () => {
    const names = (s: string) => [...s.matchAll(/\{\s*([A-Za-z]\w*)\s*[,}]/g)].map((x) => x[1]).sort();
    const mismatched = Object.keys(en).filter((k) => JSON.stringify(names(en[k]!)) !== JSON.stringify(names(ta[k]!)));
    expect(mismatched).toEqual([]);
    expect(Object.values({ ...en, ...ta }).filter((v) => v.includes("{{"))).toEqual([]);
  });

  it("uses Tamil script for Tamil strings", () => {
    const latinOnly = Object.entries(ta).filter(([, v]) => !/[஀-௿]/.test(v) && !/^[A-Z0-9 ()%/.{}+·#–−-]+$/i.test(v));
    // Brand names stay Latin.
    expect(latinOnly.map(([k]) => k).filter((k) => !/(nav\.whatsapp|wa\.title|channel\.whatsapp)$/.test(k))).toEqual([]);
  });

  it("never uses Hindi words in Tamil or English", () => {
    const hindi = /khata|udhaar|udhar|bahi|hisaab|dukaan|grahak|kharid|samaan/i;
    expect([...Object.values(en), ...Object.values(ta)].filter((v) => hindi.test(v))).toEqual([]);
  });
});
