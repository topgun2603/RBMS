import { describe, expect, it } from "vitest";
import type { ChatConversation, ChatMessage, ChatParticipant, FaqGroup } from "../types";
import { applyRead, backoffMs, compareMessages, dayKey, isSeen, latestCursor, mergeMessages, orderNumberOf, parseCursor, pickConversation, senderName, unreadCount } from "./chat";
import { featureOn, helpCentreOn } from "./features";
import { canReply, countArticles, faqPageJsonLd, filterFaq, queryWords, ticketTone } from "./help";
import { clampPoints, pointsValue, redeemBase, signedPoints, tierProgress, totalAfterPoints } from "./loyalty";
import { b4En, b4Ta } from "./messages-b4";
import { isProxyAllowed } from "../server/proxy";

const ME = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";

const msg = (id: string, at: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  conversationId: CONV,
  senderId: STAFF,
  body: `m${id}`,
  attachments: [],
  replyTo: null,
  editedAt: null,
  deletedAt: null,
  createdAt: at,
  cursor: `${Date.parse(at)}_${id}`,
  ...over,
});

describe("chat helpers", () => {
  it("parses cursors and orders by time then id; optimistic messages go last on ties", () => {
    expect(parseCursor("1700000000000_abc")).toEqual({ at: 1700000000000, id: "abc" });
    expect(parseCursor("nope")).toBeNull();
    const a = msg("a", "2026-10-16T05:00:00.000Z");
    const b = msg("b", "2026-10-16T05:00:00.000Z");
    const c = msg("c", "2026-10-16T04:00:00.000Z");
    const local = msg("tmp-1", "2026-10-16T05:00:00.000Z", { cursor: "", pending: "sending" });
    expect([a, local, b, c].sort(compareMessages).map((m) => m.id)).toEqual(["c", "a", "b", "tmp-1"]);
  });

  it("merges by id (edits replace), keeps server order, and retires my matching optimistic message", () => {
    const a = msg("a", "2026-10-16T05:00:00.000Z");
    const pending = msg("tmp-1", "2026-10-16T05:01:00.000Z", { senderId: ME, body: "hello", cursor: "", pending: "sending" });
    const edited = { ...a, body: "edited", editedAt: "2026-10-16T05:02:00.000Z" };
    const mine = msg("b", "2026-10-16T05:01:01.000Z", { senderId: ME, body: "hello" });
    const out = mergeMessages([a, pending], [edited, mine], ME);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
    expect(out[0]!.body).toBe("edited");
    // someone else's identical text doesn't retire my pending message
    const other = msg("c", "2026-10-16T05:01:02.000Z", { body: "hello" });
    expect(mergeMessages([pending], [other], ME).map((m) => m.id)).toEqual(["tmp-1", "c"]);
    // failed sends are kept for retry
    const failed = { ...pending, pending: "failed" as const };
    expect(mergeMessages([failed], [mine], ME).map((m) => m.id)).toEqual(["tmp-1", "b"]);
  });

  it("finds the newest confirmed cursor", () => {
    const a = msg("a", "2026-10-16T05:00:00.000Z");
    const b = msg("b", "2026-10-16T06:00:00.000Z");
    const local = msg("tmp", "2026-10-16T07:00:00.000Z", { pending: "sending", cursor: "" });
    expect(latestCursor([b, a, local])).toBe(b.cursor);
    expect(latestCursor([a], b.cursor)).toBe(b.cursor);
    expect(latestCursor([])).toBeNull();
  });

  it("read ticks, unread counts and read events", () => {
    const parts: ChatParticipant[] = [
      { userId: ME, kind: "shopper", name: "Priya", lastReadAt: null, joinedAt: "2026-10-16T04:00:00.000Z" },
      { userId: STAFF, kind: "staff", name: "Anbu", lastReadAt: "2026-10-16T05:00:00.000Z", joinedAt: "2026-10-16T04:00:00.000Z" },
    ];
    expect(isSeen({ createdAt: "2026-10-16T04:59:00.000Z", senderId: ME }, parts, ME)).toBe(true);
    expect(isSeen({ createdAt: "2026-10-16T05:01:00.000Z", senderId: ME }, parts, ME)).toBe(false);
    const later = applyRead(parts, STAFF, "2026-10-16T06:00:00.000Z");
    expect(isSeen({ createdAt: "2026-10-16T05:01:00.000Z", senderId: ME }, later, ME)).toBe(true);
    // markers never move back
    expect(applyRead(later, STAFF, "2026-10-16T01:00:00.000Z")[1]!.lastReadAt).toBe("2026-10-16T06:00:00.000Z");
    // a staff member who joins by reading is added
    const joined = applyRead([parts[0]!], STAFF, "2026-10-16T06:00:00.000Z");
    expect(joined).toHaveLength(2);
    expect(isSeen({ createdAt: "2026-10-16T05:01:00.000Z", senderId: ME }, joined, ME)).toBe(true);
    const ms = [msg("a", "2026-10-16T05:00:00.000Z"), msg("b", "2026-10-16T06:00:00.000Z"), msg("c", "2026-10-16T06:30:00.000Z", { senderId: ME }), msg("d", "2026-10-16T07:00:00.000Z", { deletedAt: "x" })];
    expect(unreadCount(ms, ME, null)).toBe(2);
    expect(unreadCount(ms, ME, "2026-10-16T05:30:00.000Z")).toBe(1);
    expect(senderName(parts, STAFF, "Shop")).toBe("Anbu");
    expect(senderName(parts, "x", "Shop")).toBe("Shop");
  });

  it("picks the order conversation for an order, else the latest shop-facing one", () => {
    const c = (id: string, type: ChatConversation["type"], last: string, subjectId: string | null = null): ChatConversation => ({
      id, type, subjectType: subjectId ? "order" : null, subjectId, title: null, lastMessageAt: last, lastMessagePreview: null,
      createdBy: ME, createdAt: last, joined: true, muted: false, lastReadAt: null, unread: 0, participants: [],
    });
    const list = [c("s1", "support", "2026-10-16T05:00:00Z"), c("o1", "order", "2026-10-16T04:00:00Z", "ord-1"), c("s2", "support", "2026-10-16T06:00:00Z")];
    expect(pickConversation(list, "ord-1")?.id).toBe("o1");
    expect(pickConversation(list, "ord-2")?.id).toBe("s2");
    expect(pickConversation([])).toBeNull();
  });

  it("strips the orders label prefix from order conversation titles", () => {
    expect(orderNumberOf("Order ORD/26-27/0171")).toBe("ORD/26-27/0171");
    expect(orderNumberOf("ORD/26-27/0171")).toBe("ORD/26-27/0171");
    expect(orderNumberOf(null)).toBe("");
  });

  it("backs off exponentially with a cap and jitter", () => {
    expect(backoffMs(0, () => 0)).toBe(1000);
    expect(backoffMs(3, () => 0)).toBe(8000);
    expect(backoffMs(20, () => 0)).toBe(30_000);
    expect(backoffMs(20, () => 1)).toBe(39_000);
  });

  it("buckets days in IST", () => {
    const now = new Date("2026-10-16T10:00:00Z");
    expect(dayKey("2026-10-16T00:30:00Z", now)).toBe("today");
    // 18:45 UTC on the 15th is 00:15 IST on the 16th
    expect(dayKey("2026-10-15T18:45:00Z", now)).toBe("today");
    expect(dayKey("2026-10-15T10:00:00Z", now)).toBe("yesterday");
    expect(dayKey("2026-10-01T10:00:00Z", now)).toBe("2026-10-01");
  });
});

describe("help helpers", () => {
  const groups: FaqGroup[] = [
    {
      category: { id: "c1", name: "Delivery", slug: "delivery", description: null, sort: 0 },
      articles: [
        { id: "a1", categoryId: "c1", slug: "how-long", title: "How long does delivery take?", excerpt: "2 to 4 days in Tamil Nadu" },
        { id: "a2", categoryId: "c1", slug: "address", title: "Change my address", excerpt: "Until packed" },
      ],
    },
    { category: null, articles: [{ id: "a3", categoryId: null, slug: "returns", title: "Returns", excerpt: "Within 7 days" }] },
  ];

  it("builds FAQPage JSON-LD with plain-text answers and skips empty entries", () => {
    const ld = faqPageJsonLd([
      { question: "How long?", answer: "**2–4 days**. See [tracking](/track).", url: "https://s.in/help/how-long" },
      { question: "  ", answer: "x" },
      { question: "Empty", answer: "" },
    ]);
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "How long?", acceptedAnswer: { "@type": "Answer", text: "2–4 days. See tracking.", url: "https://s.in/help/how-long" } }],
    });
    expect(faqPageJsonLd([])).toBeNull();
  });

  it("filters articles by every query word (prefixes), across title, excerpt, body and category", () => {
    expect(countArticles(filterFaq(groups, ""))).toBe(3);
    expect(filterFaq(groups, "deliv").flatMap((g) => g.articles.map((a) => a.slug))).toEqual(["how-long", "address"]);
    expect(filterFaq(groups, "tamil days").flatMap((g) => g.articles.map((a) => a.slug))).toEqual(["how-long"]);
    expect(filterFaq(groups, "refund", { returns: "Refunds reach your UPI" }).flatMap((g) => g.articles.map((a) => a.slug))).toEqual(["returns"]);
    expect(filterFaq(groups, "zzz")).toEqual([]);
    expect(queryWords("டெலிவரி எப்போது?")).toEqual(["டெலிவரி", "எப்போது"]);
  });

  it("ticket tones and reply rules", () => {
    expect(ticketTone("open")).toBe("placed");
    expect(ticketTone("closed")).toBe("returned");
    expect(canReply({ status: "resolved", mergedInto: null })).toBe(true);
    expect(canReply({ status: "closed", mergedInto: null })).toBe(false);
    expect(canReply({ status: "open", mergedInto: "TKT-0002" })).toBe(false);
  });
});

describe("loyalty helpers", () => {
  it("quotes on goods after the coupon and clamps points to the quote", () => {
    expect(redeemBase({ subtotal: 129_900, discount: 12_990 })).toBe(116_910);
    expect(redeemBase({ subtotal: 100, discount: 500 })).toBe(0);
    const q = { canRedeem: true, maxPoints: 584 };
    expect(clampPoints(1000, q)).toBe(584);
    expect(clampPoints(12.7, q)).toBe(12);
    expect(clampPoints(-3, q)).toBe(0);
    expect(clampPoints(100, { canRedeem: false, maxPoints: 584 })).toBe(0);
    expect(clampPoints(100, null)).toBe(0);
    expect(pointsValue(584, 100)).toBe(58_400);
    expect(totalAfterPoints(120_000, 58_400)).toBe(61_600);
    expect(totalAfterPoints(100, 500)).toBe(0);
  });

  it("tier progress and signed labels", () => {
    const tier = { name: "Gold", minSpend: 2_500_000, multiplier: 1.5 };
    expect(tierProgress({ member: null, nextTier: { tier, spendNeeded: 2_500_000 } })).toBe(0);
    expect(tierProgress({ member: { lifetimeSpend: 1_250_000 } as never, nextTier: { tier, spendNeeded: 1_250_000 } })).toBe(50);
    expect(tierProgress({ member: null, nextTier: null })).toBe(100);
    expect(signedPoints(120)).toBe("+120");
    expect(signedPoints(-50)).toBe("−50");
  });
});

describe("feature gates", () => {
  it("unknown or missing lists are off", () => {
    expect(featureOn(["chat"], "chat")).toBe(true);
    expect(featureOn([], "chat")).toBe(false);
    expect(featureOn(null, "chat")).toBe(false);
    expect(helpCentreOn(["support"])).toBe(true);
    expect(helpCentreOn(["loyalty"])).toBe(false);
  });
});

describe("store proxy allow-list", () => {
  it("lets shopper surfaces through", () => {
    for (const p of [
      "/v1/chat/stream-token",
      "/v1/chat/stream",
      "/v1/chat/conversations/abc/messages",
      "/v1/support/public/tickets",
      "/v1/support/public/faq/search",
      "/v1/loyalty/me",
      "/v1/loyalty/quote",
      "/v1/marketplace/public/sellers",
      "/v1/marketplace/public/vendors/murugan-silks",
      "/v1/auth/guest/verify",
      "/v1/features",
      "/v1/store/cart",
    ]) {
      expect(isProxyAllowed(p, p.includes("quote") || p.includes("verify") || p.includes("token") ? "POST" : "GET"), p).toBe(true);
    }
  });

  it("keeps staff and admin surfaces out", () => {
    for (const p of [
      "/v1/support/tickets",
      "/v1/support/faq/articles",
      "/v1/loyalty/members",
      "/v1/loyalty/settings",
      "/v1/marketplace/vendors",
      "/v1/marketplace/vendor/me",
      "/v1/marketplace/public/vendors/apply",
      "/v1/features/toggles/chat",
      "/v1/features/registry",
      "/v1/invoices",
      "/v1/chatter",
    ]) {
      expect(isProxyAllowed(p, "GET"), p).toBe(false);
    }
    expect(isProxyAllowed("/v1/features", "PUT")).toBe(false);
    expect(isProxyAllowed("/v1/marketplace/public/sellers", "POST")).toBe(false);
  });
});

describe("batch 4 strings", () => {
  it("Tamil covers every English key and never uses Hindi terms", () => {
    expect(Object.keys(b4Ta).sort()).toEqual(Object.keys(b4En).sort());
    const all = JSON.stringify([b4En, b4Ta]).toLowerCase();
    for (const w of ["khata", "udhaar", "udhar", "dukaan", "kirana", "bahi"]) expect(all).not.toContain(w);
  });
});
