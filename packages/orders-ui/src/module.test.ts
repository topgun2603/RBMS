import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchRoute, normalizeBase, type MountedModule } from "@srirealtime/web";
import { allows, permissionMatches } from "./lib/access";
import { couponState, couponValueText, couponWindow, daysLeft, randomCode } from "./lib/coupons";
import { parseSlabs, rateSummary, slabAmount } from "./lib/delivery";
import {
  addDays,
  addressLines,
  formatGrams,
  formatPhone,
  initials,
  istDate,
  money,
  moneyCompact,
  normalizeCode,
  paiseToInput,
  parseQty,
  phoneDigits,
  presetRange,
  rupeesToPaise,
  todayIST,
  whatsappHref,
} from "./lib/format";
import { ordersMessages } from "./lib/messages";
import {
  allowedTransitions,
  canDrop,
  canMarkPacked,
  dialogFor,
  moveCount,
  nextStep,
  paymentPillKind,
  skipAheadSteps,
  totalCount,
  transitionPermissions,
} from "./lib/status";
import {
  COUPON_APPLIES_TO,
  COUPON_CHANNELS,
  COUPON_REASONS,
  COUPON_TYPES,
  MANUAL_PAYMENT_METHODS,
  ORDER_CHANNELS,
  ORDER_PAYMENT_METHODS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  RATE_TYPES,
  REFUND_METHODS,
  SHIPMENT_STATUSES,
} from "./lib/types";
import { ordersModule } from "./module";
import { sampleNumber, withDefaults } from "./lib/order-settings";

const mount = (basePath = "/"): MountedModule => {
  const m = ordersModule({ basePath });
  return { ...m, basePath: normalizeBase(m.basePath) };
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });
}

const UUID = "0b6f5f36-0000-4000-8000-000000000000";

describe("ordersModule", () => {
  it("declares a feature on every nav item, route, widget, action and settings page", () => {
    const m = ordersModule();
    expect(m.id).toBe("orders");
    for (const s of m.nav) for (const i of s.items) expect(i.feature, i.href).toBeTruthy();
    for (const r of m.routes) expect(r.feature, r.path).toBeTruthy();
    for (const w of m.widgets ?? []) expect(w.feature, w.id).toBe("orders");
    for (const a of m.actions ?? []) expect(a.feature, a.id).toBe("orders");
    for (const p of m.settings ?? []) expect(p.feature, p.path).toBeTruthy();
    expect(m.settings?.map((p) => [p.path, p.feature])).toEqual([
      ["delivery", "delivery"],
      ["orders", "orders"],
    ]);
    expect(m.nav[0]!.items.map((i) => [i.href, i.feature])).toEqual([
      ["orders", "orders"],
      ["coupons", "coupons"],
    ]);
  });

  it("matches static segments before ids, at any base path", () => {
    for (const base of ["/", "/sales"]) {
      const app = { modules: [mount(base)] } as Parameters<typeof matchRoute>[0];
      const p = (s: string) => (base === "/" ? s : `${base}${s}`);
      expect(matchRoute(app, p("/orders/new"), (m) => m.routes)?.route.path).toBe("orders/new");
      expect(matchRoute(app, p(`/orders/${UUID}`), (m) => m.routes)?.params).toEqual({ id: UUID });
      expect(matchRoute(app, p("/coupons/new"), (m) => m.routes)?.route.path).toBe("coupons/new");
      expect(matchRoute(app, p(`/coupons/${UUID}`), (m) => m.routes)?.route.path).toBe("coupons/:id");
    }
  });

  it("passes the features restriction through", () => {
    expect(ordersModule({ features: ["orders"] }).features).toEqual(["orders"]);
  });
});

describe("messages", () => {
  const { en, ta } = ordersMessages;

  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });

  it("defines every literal orders.* key used in the source", () => {
    // Permission / feature keys that look like message keys.
    const notMessages = new Set(["orders.cancel", "orders.manage", "orders.refund", "orders.ship", "orders.deliver", "orders.returns", "orders.csv"]);
    const used = new Set<string>();
    for (const file of sources(join(__dirname))) {
      for (const m of readFileSync(file, "utf8").matchAll(/["'`](orders\.[a-zA-Z0-9_.-]+)["'`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in en) && !notMessages.has(k));
    expect(missing).toEqual([]);
  });

  it("defines every dynamic key family", () => {
    const families: [string, readonly string[]][] = [
      ["orders.status.", ORDER_STATUSES],
      ["orders.action.", ORDER_STATUSES],
      ["orders.channel.", ORDER_CHANNELS],
      ["orders.paymentStatus.", PAYMENT_STATUSES],
      ["orders.payment.", ["paid", "cod", "pending", "refunded", "partial_refund", "unpaid"]],
      ["orders.method.", [...ORDER_PAYMENT_METHODS, ...MANUAL_PAYMENT_METHODS, ...REFUND_METHODS, "wallet"]],
      ["orders.range.", ["all", "today", "yesterday", "7d", "30d", "month", "custom"]],
      ["orders.list.view.", ["list", "board"]],
      ["orders.cancel.reason.", ["customer", "stock", "payment", "duplicate", "address"]],
      ["orders.coupons.type.", COUPON_TYPES],
      ["orders.coupons.applies.", COUPON_APPLIES_TO],
      ["orders.coupons.channel.", COUPON_CHANNELS],
      ["orders.coupons.reason.", COUPON_REASONS],
      ["orders.coupons.state.", ["active", "scheduled", "expired", "used_up", "off"]],
      ["orders.coupons.redemption.", ["active", "released"]],
      ["orders.delivery.type.", RATE_TYPES],
      ["orders.shipment.status.", SHIPMENT_STATUSES],
      ["orders.ship.provider.", ["manual", "shiprocket", "mock"]],
      ["orders.ship.providerHint.", ["manual", "shiprocket", "mock"]],
      ["orders.ship.done.", ["refresh", "mock-advance", "cancel"]],
      ["orders.ship.dims.", ["lengthCm", "breadthCm", "heightCm", "weightGrams"]],
      ["orders.new.methodHint.", ["cod", "online"]],
      ["orders.settings.", ["autoConfirm", "autoConfirmHint", "allowBackorder", "allowBackorderHint", "notifyOwner", "notifyOwnerHint"]],
      ["orders.settings.invoiceOnHint.", ["confirmed", "delivered"]],
      [
        "orders.timeline.effect.",
        ["stock.reserve", "stock.release", "stock.commit", "stock.restock", "coupon.redeem", "coupon.release", "payment.collectCod", "invoice.create", "invoice.cancel"],
      ],
    ];
    const missing = families.flatMap(([prefix, values]) => values.map((v) => prefix + v)).filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it("uses Tamil script for Tamil strings", () => {
    const latinOnly = Object.entries(ta).filter(([, v]) => !/[஀-௿]/.test(v) && !/^[A-Z0-9 ()%/.{}+·#–−-]+$/i.test(v));
    // Brand and technical names stay Latin (WhatsApp, Shiprocket, a sample code).
    expect(latinOnly.map(([k]) => k).filter((k) => !/(whatsapp|carrier\.title|provider\.shiprocket|couponPlaceholder)$/i.test(k))).toEqual([]);
  });

  it("never uses Hindi words in Tamil or English", () => {
    const hindi = /khata|udhaar|udhar|bahi|hisaab|dukaan/i;
    expect([...Object.values(en), ...Object.values(ta)].filter((v) => hindi.test(v))).toEqual([]);
  });
});

describe("status transitions", () => {
  const off = { returnsEnabled: false };
  const on = { returnsEnabled: true };

  it("mirrors the server machine", () => {
    expect(allowedTransitions("placed", off)).toEqual(["confirmed", "packed", "shipped", "delivered", "cancelled"]);
    expect(allowedTransitions("packed", off)).toEqual(["shipped", "delivered", "cancelled"]);
    expect(allowedTransitions("shipped", off)).toEqual(["delivered"]);
    expect(allowedTransitions("delivered", off)).toEqual([]);
    expect(allowedTransitions("delivered", on)).toEqual(["returned"]);
    expect(allowedTransitions("cancelled", on)).toEqual([]);
    expect(allowedTransitions("returned", on)).toEqual([]);
  });

  it("picks the one-step-forward primary action", () => {
    expect(nextStep("placed")).toBe("confirmed");
    expect(nextStep("confirmed")).toBe("packed");
    expect(nextStep("shipped")).toBe("delivered");
    expect(nextStep("delivered")).toBeNull();
    expect(nextStep("cancelled")).toBeNull();
    // The server's nextStatuses wins: nothing allowed → no button.
    expect(nextStep("placed", [])).toBeNull();
    expect(skipAheadSteps("placed", allowedTransitions("placed", off))).toEqual(["packed", "shipped", "delivered"]);
    expect(skipAheadSteps("shipped", allowedTransitions("shipped", off))).toEqual([]);
  });

  it("asks for input only where the API takes it", () => {
    expect(dialogFor("cancelled")).toBe("cancel");
    expect(dialogFor("returned")).toBe("return");
    expect(dialogFor("shipped")).toBe("ship");
    expect(dialogFor("packed")).toBeNull();
    expect(dialogFor("delivered")).toBeNull();
  });

  it("needs the same permissions as the API", () => {
    expect(transitionPermissions("cancelled")).toEqual(["orders.cancel"]);
    expect(transitionPermissions("shipped")).toEqual(["orders.manage", "orders.ship"]);
    expect(transitionPermissions("delivered")).toEqual(["orders.manage", "orders.deliver"]);
    expect(transitionPermissions("confirmed")).toEqual(["orders.manage"]);
  });

  it("only accepts forward kanban drops", () => {
    expect(canDrop("placed", "packed", off)).toBe(true);
    expect(canDrop("packed", "confirmed", off)).toBe(false);
    expect(canDrop("packed", "packed", off)).toBe(false);
    expect(canDrop("delivered", "returned", on)).toBe(false); // returned isn't a column
    expect(canDrop("shipped", "delivered", off)).toBe(true);
    expect(canMarkPacked("confirmed")).toBe(true);
    expect(canMarkPacked("shipped")).toBe(false);
  });

  it("moves counts optimistically", () => {
    const c = moveCount({ placed: 2, confirmed: 1 }, "placed", "confirmed");
    expect(c.placed).toBe(1);
    expect(c.confirmed).toBe(2);
    expect(c.packed).toBe(0);
    expect(moveCount({ placed: 0 }, "placed", "packed").placed).toBe(0);
    expect(totalCount({ placed: 2, delivered: 3 })).toBe(5);
    expect(totalCount(undefined)).toBe(0);
  });

  it("maps payment statuses to pills", () => {
    expect(paymentPillKind("paid")).toBe("paid");
    expect(paymentPillKind("cod")).toBe("cod");
    expect(paymentPillKind("partially_refunded")).toBe("partial_refund");
    expect(paymentPillKind("unpaid")).toBe("unpaid");
  });
});

describe("permissions", () => {
  it("matches patterns like the API", () => {
    expect(permissionMatches("*", "orders.cancel")).toBe(true);
    expect(permissionMatches("orders.*", "orders.cancel")).toBe(true);
    expect(permissionMatches("orders.*", "orders")).toBe(true);
    expect(permissionMatches("orders.manage", "orders.cancel")).toBe(false);
    expect(permissionMatches("*.view", "orders.view")).toBe(true);
  });

  it("lets owners through and falls back to the server without a list", () => {
    expect(allows({ canManage: true, permissions: [] }, ["orders.cancel"])).toBe(true);
    expect(allows({ canManage: false, permissions: undefined }, ["orders.cancel"])).toBe(true);
    expect(allows({ canManage: false, permissions: ["orders.manage"] }, ["orders.cancel"])).toBe(false);
    expect(allows({ canManage: false, permissions: ["orders.ship"] }, ["orders.manage", "orders.ship"])).toBe(true);
  });
});

describe("money and dates", () => {
  it("formats rupees the Indian way", () => {
    expect(money(12345678)).toBe("₹1,23,456.78");
    expect(money(null)).toBe("₹0.00");
    expect(moneyCompact(25_00_000_00)).toBe("₹25L");
    expect(moneyCompact(1_500_00)).toBe("₹1.5K");
  });

  it("parses and prints rupee inputs", () => {
    expect(rupeesToPaise("1,249.50")).toBe(124950);
    expect(rupeesToPaise("₹ 99")).toBe(9900);
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("12a")).toBeNull();
    expect(paiseToInput(123450)).toBe("1234.5");
    expect(paiseToInput(10000)).toBe("100");
    expect(paiseToInput(null)).toBe("");
    expect(parseQty("1.250")).toBe(1.25);
    expect(parseQty("1.2345")).toBeNull();
  });

  it("works in IST calendar days", () => {
    // 20:00 UTC on 14 Oct is 01:30 on 15 Oct in India.
    expect(istDate("2026-10-14T20:00:00Z")).toBe("2026-10-15");
    expect(todayIST(new Date("2026-03-31T19:00:00Z"))).toBe("2026-04-01");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(presetRange("today", "2026-10-15")).toEqual({ from: "2026-10-15", to: "2026-10-15" });
    expect(presetRange("7d", "2026-10-15")).toEqual({ from: "2026-10-09", to: "2026-10-15" });
    expect(presetRange("month", "2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(presetRange("yesterday", "2026-10-01")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(presetRange("all")).toEqual({});
  });

  it("formats people and places", () => {
    expect(phoneDigits("98765 43210")).toBe("919876543210");
    expect(phoneDigits("+91 98765 43210")).toBe("919876543210");
    expect(phoneDigits("123")).toBeNull();
    expect(whatsappHref("9876543210", "Hi")).toBe("https://wa.me/919876543210?text=Hi");
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(initials("Anbu Selvan Kumar")).toBe("AK");
    expect(initials("")).toBe("?");
    expect(addressLines({ line1: "12 Gandhi St", city: "Madurai", district: "Madurai", stateCode: "33", pincode: "625001" })).toEqual([
      "12 Gandhi St",
      "Madurai",
      "Tamil Nadu – 625001",
    ]);
    expect(formatGrams(1500)).toBe("1.5 kg");
    expect(formatGrams(250)).toBe("250 g");
    expect(normalizeCode(" diwali 10 ")).toBe("DIWALI10");
  });

  it("previews the order number for a prefix (FY from April)", () => {
    expect(sampleNumber("ORD", "2026-10-15")).toBe("ORD/26-27/0001");
    expect(sampleNumber("WEB", "2027-02-01")).toBe("WEB/26-27/0001");
    expect(withDefaults({ prefix: "AB" })).toEqual({ prefix: "AB", invoiceOn: "delivered", allowBackorder: false, autoConfirm: false, notifyOwner: true });
  });
});

describe("coupon helpers", () => {
  const base = { active: true, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0 };
  const now = new Date("2026-10-15T06:00:00Z");

  it("works out where a coupon stands", () => {
    expect(couponState(base, now)).toBe("active");
    expect(couponState({ ...base, active: false }, now)).toBe("off");
    expect(couponState({ ...base, endsAt: "2026-10-14T18:29:59Z" }, now)).toBe("expired");
    expect(couponState({ ...base, startsAt: "2026-10-20T00:00:00+05:30" }, now)).toBe("scheduled");
    expect(couponState({ ...base, usageLimit: 5, usedCount: 5 }, now)).toBe("used_up");
  });

  it("labels values and windows", () => {
    expect(couponValueText({ type: "percent", value: 10, maxDiscount: 20000 })).toEqual({ main: "10%", cap: "₹200.00" });
    expect(couponValueText({ type: "flat", value: 5000, maxDiscount: null })).toEqual({ main: "₹50.00", cap: null });
    expect(couponValueText({ type: "free_shipping", value: 0, maxDiscount: null }).main).toBeNull();
    // The server stores IST day edges; the form shows the IST calendar days.
    expect(couponWindow({ startsAt: "2026-09-30T18:30:00Z", endsAt: "2026-10-31T18:29:59.999Z" })).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(daysLeft({ endsAt: "2026-10-31T18:29:59.999Z" }, "2026-10-15")).toBe(16);
    expect(daysLeft({ endsAt: null })).toBeNull();
  });

  it("makes readable random codes", () => {
    const c = randomCode("", 8);
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });
});

describe("delivery helpers", () => {
  it("parses weight slabs", () => {
    expect(parseSlabs([{ upToGrams: "1000", amount: "60" }, { upToGrams: "500", amount: "40" }])).toEqual({
      ok: true,
      slabs: [
        { upToGrams: 500, amount: 4000 },
        { upToGrams: 1000, amount: 6000 },
      ],
    });
    expect(parseSlabs([{ upToGrams: "0", amount: "40" }])).toEqual({ ok: false, row: 0 });
    expect(parseSlabs([{ upToGrams: "500", amount: "x" }])).toEqual({ ok: false, row: 0 });
    expect(parseSlabs([{ upToGrams: "500", amount: "1" }, { upToGrams: "500", amount: "2" }]).ok).toBe(false);
  });

  it("charges like the server", () => {
    const slabs = [
      { upToGrams: 500, amount: 4000 },
      { upToGrams: 2000, amount: 8000 },
    ];
    expect(slabAmount(slabs, 400)).toBe(4000);
    expect(slabAmount(slabs, 500)).toBe(4000);
    expect(slabAmount(slabs, 501)).toBe(8000);
    expect(slabAmount(slabs, 2500)).toBeNull();
    expect(rateSummary({ type: "weight", amount: 0, freeAbove: 99900, weightSlabs: slabs })).toEqual({
      amount: "₹0.00",
      slabs: [
        { upTo: "500 g", amount: "₹40.00" },
        { upTo: "2 kg", amount: "₹80.00" },
      ],
      freeAbove: "₹999.00",
    });
  });
});

describe("permission gating (Gated.permission)", () => {
  it("gates coupon creation and delivery settings; the coupon list and order screens stay in-page", () => {
    const m = ordersModule();
    expect(m.routes.find((r) => r.path === "coupons/new")?.permission).toBe("coupons.manage");
    expect(m.routes.find((r) => r.path === "coupons")?.permission).toBeUndefined();
    expect(m.routes.find((r) => r.path === "coupons/:id")?.permission).toBeUndefined();
    expect(m.settings?.find((s) => s.path === "delivery")?.permission).toBe("settings.manage");
    expect(m.routes.filter((r) => r.path.startsWith("orders")).every((r) => r.permission === undefined)).toBe(true);
  });
});
