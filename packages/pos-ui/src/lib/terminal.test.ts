import { describe, expect, it, vi } from "vitest";
import { lineAmount } from "@rbms/gst";
import { addProduct, setPrice, setQty, stepQty, type CartLine, type CartProduct } from "./cart";
import { applyCatalogChange, buildCatalogIndex, emptySnapshot, fetchCatalogChange, findByCode, findByPlu, searchCatalog, syncCatalog, type CatalogStore } from "./catalog-sync";
import { CODE128_PATTERNS, code128Bars, code128Values } from "./code128";
import {
  displayPairingCode,
  formatPairingInput,
  initialPairing,
  initialTerminal,
  normalizePairingCode,
  pairErrorOf,
  pairingReducer,
  parsePairingQr,
  sessionExpired,
  terminalReducer,
  terminalView,
} from "./pairing";
import { formatCountdown, idleExpired, isWeakPin, keyToPinAction, lockSecondsLeft, padDisabled, pinPadReducer, pinProblem, unlockProblemOf } from "./pin";
import { needsWeight, resolveScan } from "./scan";
import { createLineSplitter, netWeight, parseManualWeight, parseScaleLine } from "./scale-serial";
import type { CatalogPage, DeviceInfo, PinSession, PosItem, Terminal, WeighTicket } from "./terminal-types";
import { addTicket, isTicketCode, removeLineOrTicket, ticketErrorOf, ticketIdsOf, ticketMatches, ticketPrintModel, ticketUseKey, markTicketsUsed } from "./weigh-ticket";

const terminal = (over: Partial<Terminal> = {}): Terminal => ({
  id: "t1",
  name: "Counter 1",
  role: "pos",
  branchId: null,
  locationId: null,
  settings: { printerWidth: 80, autoPrint: false, lockAfterMinutes: 5 },
  paired: true,
  device: { platform: "web", model: "Chrome on Windows", appVersion: null, name: null },
  pairedAt: "2026-10-22T04:00:00Z",
  lastSeenAt: "2026-10-22T04:00:00Z",
  pairingPending: false,
  createdAt: "2026-10-22T03:00:00Z",
  ...over,
});
const shop = { id: "s1", slug: "kumar", name: "Kumar Stores", appId: "BL" };
const device = (over: Partial<Terminal> = {}, features = ["invoices", "pos.terminals", "pos.weighing"]): DeviceInfo => ({ terminal: terminal(over), shop, features });
const session: PinSession = { token: "pin-tok", expiresAt: "2026-10-22T16:00:00Z", user: { id: "u1", name: "Meena" }, permissions: ["invoices.create"], tenantRoles: ["staff"] };
const err = (status: number, code: string, details?: unknown) => Object.assign(new Error(code), { status, code, details });

const item = (id: string, over: Partial<PosItem> = {}): PosItem => ({
  itemId: id,
  productId: `p-${id}`,
  name: `Item ${id}`,
  variantTitle: "",
  sku: `SKU-${id}`,
  barcodes: [`890${id}`],
  categoryId: null,
  price: 1000,
  mrp: null,
  taxInclusive: true,
  gstRate: 5,
  hsn: null,
  unit: "pcs",
  soldBy: "unit",
  plu: null,
  image: null,
  stock: null,
  active: true,
  updatedAt: "2026-10-22T00:00:00Z",
  ...over,
});
const page = (over: Partial<CatalogPage>): CatalogPage => ({ items: [], removed: [], cursor: "c1", next: null, full: false, ...over });

const ticket = (over: Partial<WeighTicket> = {}): WeighTicket => ({
  id: "wt1",
  code: "W26102200017",
  terminalId: "t9",
  status: "open",
  lines: [
    { itemId: "tomato", name: "Tomato", unit: "kg", qty: 1.234, unitPrice: 4000, amount: lineAmount(1.234, 4000), taxInclusive: true, gstRate: 0, hsn: "0702", tareKg: 0.02 },
    { itemId: "onion", name: "Onion", unit: "kg", qty: 0.5, unitPrice: 3000, amount: 1500, taxInclusive: true, gstRate: 0, hsn: null },
  ],
  total: lineAmount(1.234, 4000) + 1500,
  note: null,
  createdAt: "2026-10-22T05:00:00Z",
  expiresAt: "2099-10-22T18:29:59Z",
  usedInvoiceId: null,
  ...over,
});

// ---------------------------------------------------------------- pairing

describe("pairing codes and QR", () => {
  it("normalises codes: case, dash and spaces optional; only the code alphabet", () => {
    expect(normalizePairingCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizePairingCode(" ABCD 2345 ")).toBe("ABCD2345");
    expect(normalizePairingCode("ABCD234")).toBeNull();
    expect(normalizePairingCode("ABCD-0345")).toBeNull(); // 0 is not in the alphabet
    expect(normalizePairingCode("ABCI-2345")).toBeNull();
    expect(formatPairingInput("abcd23")).toBe("ABCD-23");
    expect(formatPairingInput("ab-cd-2345-99")).toBe("ABCD-2345");
    expect(displayPairingCode("ABCD2345")).toBe("ABCD-2345");
  });

  it("parses the QR payload (origin may contain colons) and bare codes", () => {
    expect(parsePairingQr("srikit-pair:1:http://localhost:4000:ABCD-2345")).toEqual({ origin: "http://localhost:4000", code: "ABCD2345" });
    expect(parsePairingQr("srikit-pair:1:https://api.srikit.in:wxyz9876")).toEqual({ origin: "https://api.srikit.in", code: "WXYZ9876" });
    expect(parsePairingQr("ABCD-2345")).toEqual({ origin: "", code: "ABCD2345" });
    expect(parsePairingQr("srikit-pair:2:x:ABCD-2345")).toBeNull();
    expect(parsePairingQr("https://example.com")).toBeNull();
  });

  it("maps pairing errors", () => {
    expect(pairErrorOf(err(400, "pairing_code_invalid"))).toBe("invalid");
    expect(pairErrorOf(err(429, "too_many_attempts"))).toBe("tooMany");
    expect(pairErrorOf(err(0, "network_error"))).toBe("network");
    expect(pairErrorOf(err(403, "device_shop_mismatch"))).toBe("wrongShop");
    expect(pairErrorOf(err(500, "boom"))).toBe("other");
  });
});

describe("pairing state machine", () => {
  it("enter → pairing → paired", () => {
    let s = pairingReducer(initialPairing, { type: "input", value: "abcd2345" });
    expect(s).toEqual({ step: "enter", code: "ABCD-2345", error: null });
    s = pairingReducer(s, { type: "submit" });
    expect(s).toEqual({ step: "pairing", code: "ABCD2345" });
    // Typing while a request runs is ignored.
    expect(pairingReducer(s, { type: "input", value: "x" })).toBe(s);
    s = pairingReducer(s, { type: "paired", terminal: terminal(), shop });
    expect(s.step).toBe("paired");
  });

  it("a malformed code stays in enter with a format error; a failure goes back with the code kept", () => {
    expect(pairingReducer({ step: "enter", code: "ABC", error: null }, { type: "submit" })).toEqual({ step: "enter", code: "ABC", error: "format" });
    const back = pairingReducer({ step: "pairing", code: "ABCD2345" }, { type: "failed", error: "invalid" });
    expect(back).toEqual({ step: "enter", code: "ABCD-2345", error: "invalid" });
    // Editing clears the error.
    expect(pairingReducer(back, { type: "input", value: "ABCD-2346" })).toEqual({ step: "enter", code: "ABCD-2346", error: null });
  });

  it("a scanned QR submits at once; an unknown QR is a format error", () => {
    expect(pairingReducer(initialPairing, { type: "scanned", text: "srikit-pair:1:http://localhost:4000:ABCD-2345" })).toEqual({ step: "pairing", code: "ABCD2345" });
    expect(pairingReducer(initialPairing, { type: "scanned", text: "hello" })).toEqual({ step: "enter", code: "", error: "format" });
  });
});

describe("terminal phases", () => {
  const keys = { terminals: "pos.terminals", weighing: "pos.weighing" };

  it("no token → pair; device → lock; PIN → pos; lock → lock again", () => {
    expect(terminalView(terminalReducer(initialTerminal, { type: "noToken" }), keys)).toBe("pair");
    let s = terminalReducer(initialTerminal, { type: "device", device: device() });
    expect(terminalView(s, keys)).toBe("lock");
    s = terminalReducer(s, { type: "unlock", session });
    expect(s.phase).toBe("unlocked");
    expect(terminalView(s, keys)).toBe("pos");
    s = terminalReducer(s, { type: "lock", reason: "idle" });
    expect(s).toMatchObject({ phase: "locked", notice: "idle" });
  });

  it("weighing terminals open the weighing station; features off → off", () => {
    const w = terminalReducer(terminalReducer(initialTerminal, { type: "device", device: device({ role: "weighing" }) }), { type: "unlock", session });
    expect(terminalView(w, keys)).toBe("weighing");
    const noWeigh = terminalReducer(initialTerminal, { type: "device", device: device({ role: "weighing" }, ["pos.terminals"]) });
    expect(terminalView(noWeigh, keys)).toBe("off");
    const noTerminals = terminalReducer(initialTerminal, { type: "device", device: device({}, ["invoices"]) });
    expect(terminalView(noTerminals, keys)).toBe("off");
  });

  it("a revoked device token unpairs; other 401s lock; network failures show offline", () => {
    expect(terminalReducer(initialTerminal, { type: "deviceFailed", error: err(401, "device_not_paired") })).toEqual({ phase: "unpaired", notice: "revoked" });
    expect(terminalReducer(initialTerminal, { type: "deviceFailed", error: err(0, "network_error"), cached: device() })).toMatchObject({ phase: "offline" });
    const unlocked = terminalReducer(terminalReducer(initialTerminal, { type: "device", device: device() }), { type: "unlock", session });
    expect(terminalReducer(unlocked, { type: "unauthorized", code: "device_required" })).toMatchObject({ phase: "locked", notice: "expired" });
    expect(terminalReducer(unlocked, { type: "unauthorized", code: "device_not_paired" })).toEqual({ phase: "unpaired", notice: "revoked" });
    // Pairing again starts from loading (GET /device).
    expect(terminalReducer({ phase: "unpaired" }, { type: "paired" })).toEqual({ phase: "loading" });
  });

  it("a device refresh keeps an unlocked session", () => {
    const unlocked = terminalReducer(terminalReducer(initialTerminal, { type: "device", device: device() }), { type: "unlock", session });
    const next = terminalReducer(unlocked, { type: "device", device: device({ name: "Counter 2" }) });
    expect(next).toMatchObject({ phase: "unlocked", session });
    expect(next.phase === "unlocked" && next.device.terminal.name).toBe("Counter 2");
  });

  it("PIN sessions expire after expiresAt", () => {
    expect(sessionExpired(session, Date.parse("2026-10-22T15:59:59Z"))).toBe(false);
    expect(sessionExpired(session, Date.parse("2026-10-22T16:00:00Z"))).toBe(true);
  });
});

// ---------------------------------------------------------------- PIN

describe("PIN rules and pad", () => {
  it("4–6 digits, not weak", () => {
    expect(pinProblem("123")).toBe("format");
    expect(pinProblem("1234567")).toBe("format");
    expect(pinProblem("12a4")).toBe("format");
    for (const weak of ["0000", "777777", "1234", "123456", "4321", "0123", "987654"]) expect(isWeakPin(weak), weak).toBe(true);
    for (const ok of ["1357", "2580", "120934", "1123"]) expect(isWeakPin(ok), ok).toBe(false);
    expect(pinProblem("2580", "2581")).toBe("mismatch");
    expect(pinProblem("2580", "2580")).toBeNull();
  });

  it("pad takes digits up to 6, back and clear; keyboard maps", () => {
    let s = { digits: "" };
    for (const d of "12345678") s = pinPadReducer(s, { type: "digit", digit: d });
    expect(s.digits).toBe("123456");
    s = pinPadReducer(s, { type: "back" });
    expect(s.digits).toBe("12345");
    expect(pinPadReducer(s, { type: "digit", digit: "x" })).toBe(s);
    expect(pinPadReducer(s, { type: "clear" }).digits).toBe("");
    expect(keyToPinAction("7")).toEqual({ type: "digit", digit: "7" });
    expect(keyToPinAction("Backspace")).toEqual({ type: "back" });
    expect(keyToPinAction("Escape")).toEqual({ type: "clear" });
    expect(keyToPinAction("a")).toBeNull();
  });

  it("unlock errors: invalid with remaining, locked with countdown, not allowed", () => {
    const now = 1_000_000;
    expect(unlockProblemOf(err(401, "pin_invalid", { remaining: 3 }), now)).toEqual({ kind: "invalid", remaining: 3 });
    const locked = unlockProblemOf(err(429, "pin_locked", { retryAfterSeconds: 300 }), now);
    expect(locked).toEqual({ kind: "locked", until: now + 300_000 });
    expect(unlockProblemOf(err(403, "pin_not_allowed"), now)).toEqual({ kind: "notAllowed" });
    expect(unlockProblemOf(err(401, "device_not_paired"), now)).toEqual({ kind: "unpaired" });
    expect(unlockProblemOf(err(0, "network_error"), now)).toEqual({ kind: "network" });
    // Lockout countdown and pad state.
    expect(lockSecondsLeft(now + 300_000, now)).toBe(300);
    expect(lockSecondsLeft(now + 300_000, now + 299_500)).toBe(1);
    expect(lockSecondsLeft(now, now + 5)).toBe(0);
    expect(formatCountdown(299)).toBe("4:59");
    expect(formatCountdown(5)).toBe("0:05");
    expect(padDisabled(locked, false, now + 1000)).toBe(true);
    expect(padDisabled(locked, false, now + 300_000)).toBe(false);
    expect(padDisabled(null, true)).toBe(true);
  });

  it("idle auto-lock after lockAfterMinutes (clamped 1..60)", () => {
    expect(idleExpired(0, 5, 4 * 60_000)).toBe(false);
    expect(idleExpired(0, 5, 5 * 60_000)).toBe(true);
    expect(idleExpired(0, 0, 60_000)).toBe(true);
  });
});

// ---------------------------------------------------------------- catalogue cache

describe("catalogue cache sync", () => {
  it("full sync pages with next until null and replaces the cache", async () => {
    const calls: unknown[] = [];
    const pages: Record<string, CatalogPage> = {
      "": page({ items: [item("1"), item("2")], cursor: "c1", next: "p2", full: true }),
      p2: page({ items: [item("3")], cursor: "c2", next: null, full: true }),
    };
    const fetchPage = vi.fn(async (q: { since?: string; after?: string; limit: number }) => {
      calls.push(q);
      return pages[q.after ?? ""]!;
    });
    const writes: unknown[] = [];
    const store: CatalogStore = { read: async () => null, write: async (c) => void writes.push(c) };
    const before = { ...emptySnapshot(), items: new Map([["old", item("old")]]) };
    const r = await syncCatalog(before, fetchPage, store, 42);
    expect(calls).toEqual([{ limit: 1000 }, { after: "p2", limit: 1000 }]);
    expect([...r.snapshot.items.keys()].sort()).toEqual(["1", "2", "3"]);
    expect(r.snapshot.cursor).toBe("c2");
    expect(r.snapshot.syncedAt).toBe(42);
    expect(r.full).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ replace: true, cursor: "c2" });
  });

  it("delta sync sends since, upserts changed items and drops removed / inactive ones", async () => {
    const snap = { items: new Map([["1", item("1")], ["2", item("2")], ["3", item("3")]]), cursor: "c2", syncedAt: 1 };
    const fetchPage = vi.fn(async () => page({ items: [item("1", { price: 1500 }), item("3", { active: false }), item("4")], removed: ["2"], cursor: "c3" }));
    const r = await syncCatalog(snap, fetchPage, null, 99);
    expect(fetchPage).toHaveBeenCalledWith({ since: "c2", limit: 1000 });
    expect([...r.snapshot.items.keys()].sort()).toEqual(["1", "4"]);
    expect(r.snapshot.items.get("1")!.price).toBe(1500);
    expect(r.snapshot.cursor).toBe("c3");
    expect(r.full).toBe(false);
    expect(r.changed).toBe(true);
    // The old snapshot is untouched.
    expect(snap.items.size).toBe(3);
  });

  it("a delta answered with full: true (cursor too old) replaces the cache", async () => {
    const snap = { items: new Map([["9", item("9")]]), cursor: "ancient", syncedAt: 1 };
    const r = await syncCatalog(snap, async () => page({ items: [item("1")], full: true, cursor: "c9" }), null);
    expect([...r.snapshot.items.keys()]).toEqual(["1"]);
  });

  it("an empty delta changes nothing; a failing page leaves the cache as it was", async () => {
    const snap = { items: new Map([["1", item("1")]]), cursor: "c1", syncedAt: 1 };
    const r = await syncCatalog(snap, async () => page({ cursor: "c1b" }), null);
    expect(r.changed).toBe(false);
    expect(r.snapshot.cursor).toBe("c1b");
    let n = 0;
    const failing = async () => {
      if (n++ === 0) return page({ items: [item("2")], next: "p2" });
      throw err(0, "network_error");
    };
    await expect(fetchCatalogChange(failing, "c1")).rejects.toThrow();
    expect([...snap.items.keys()]).toEqual(["1"]);
  });

  it("an item removed on one page and re-added later stays", async () => {
    const pages = [page({ removed: ["1"], next: "p2" }), page({ items: [item("1", { price: 5 })], cursor: "c5" })];
    let i = 0;
    const change = await fetchCatalogChange(async () => pages[i++]!, "c0");
    expect(change.removes).toEqual([]);
    const snap = applyCatalogChange({ items: new Map([["1", item("1")]]), cursor: "c0", syncedAt: 0 }, change);
    expect(snap.items.get("1")!.price).toBe(5);
  });

  it("finds by barcode then SKU (any case), by PLU, and searches by name words", () => {
    const idx = buildCatalogIndex([
      item("1", { name: "Basmati Rice", variantTitle: "5 kg", barcodes: ["8901234567890"], sku: "RICE-5" }),
      item("2", { name: "Toor Dal", sku: "DAL-1", soldBy: "weight", unit: "kg", plu: "00042" }),
      item("3", { name: "Rice Flour", sku: "RF-1", barcodes: [] }),
      item("4", { name: "Hidden", active: false }),
    ]);
    expect(findByCode(idx, "8901234567890")?.itemId).toBe("1");
    expect(findByCode(idx, "rice-5")?.itemId).toBe("1");
    expect(findByCode(idx, "nope")).toBeNull();
    expect(findByPlu(idx, "42")?.itemId).toBe("2");
    expect(searchCatalog(idx, "rice").map((i) => i.itemId)).toEqual(["3", "1"]);
    expect(searchCatalog(idx, "rice 5").map((i) => i.itemId)).toEqual(["1"]);
    expect(searchCatalog(idx, "hidden")).toEqual([]);
    expect(searchCatalog(idx, "", { weightFirst: true })[0]!.itemId).toBe("2");
  });
});

// ---------------------------------------------------------------- scan order

describe("barcode lookup order", () => {
  const idx = buildCatalogIndex([item("1", { barcodes: ["8901"], sku: "A-1" }), item("2", { soldBy: "weight", unit: "kg", barcodes: ["8902"] })]);
  const product: CartProduct = { itemId: "s1", name: "Server item", unit: "pcs", price: 100, taxInclusive: false, gstRate: 0 };

  it("ticket codes go to the ticket lookup first (when weigh tickets are on)", async () => {
    const getTicket = vi.fn(async () => ticket());
    const server = vi.fn(async () => null);
    expect(await resolveScan("w26102200017", { cache: idx, tickets: true, getTicket, server })).toEqual({ kind: "ticket", ticket: ticket() });
    expect(getTicket).toHaveBeenCalledWith("W26102200017");
    expect(server).not.toHaveBeenCalled();
    // Off: the code falls through to the normal path.
    await resolveScan("W26102200017", { cache: idx, tickets: false, getTicket, server });
    expect(server).toHaveBeenCalledWith("W26102200017");
  });

  it("used / expired tickets are reported; network errors are thrown", async () => {
    const server = vi.fn(async () => null);
    for (const [e, kind] of [
      [err(409, "ticket_used"), "used"],
      [err(410, "ticket_expired"), "expired"],
      [err(404, "ticket_not_found"), "notFound"],
    ] as const) {
      expect(await resolveScan("W26102200017", { cache: idx, tickets: true, getTicket: async () => Promise.reject(e), server })).toEqual({ kind: "ticketError", code: "W26102200017", error: kind });
    }
    await expect(resolveScan("W26102200017", { cache: idx, tickets: true, getTicket: async () => Promise.reject(err(0, "network_error")), server })).rejects.toThrow();
  });

  it("the cache answers before the server; misses fall back to lookup / resolve", async () => {
    const server = vi.fn(async (c: string) => (c === "2100042012509" ? { product, qty: 1.25 } : null));
    const deps = { cache: idx, tickets: true, getTicket: vi.fn(), server };
    expect(await resolveScan("8901", deps)).toMatchObject({ kind: "item", source: "cache", product: { itemId: "1" } });
    expect(await resolveScan("a-1", deps)).toMatchObject({ kind: "item", source: "cache", product: { itemId: "1" } });
    expect(server).not.toHaveBeenCalled();
    expect(await resolveScan("2100042012509", deps)).toMatchObject({ kind: "item", source: "server", qty: 1.25 });
    expect(await resolveScan("0000", deps)).toEqual({ kind: "miss" });
    // Without a cache everything goes to the server.
    await resolveScan("8901", { ...deps, cache: null });
    expect(server).toHaveBeenCalledWith("8901");
  });

  it("a ticket found by the counter resolver is a ticket; weight items without a weight ask for one", async () => {
    const t = ticket();
    expect(await resolveScan("ZZZ1", { cache: null, tickets: true, getTicket: vi.fn(), server: async () => ({ product, weighTicket: t }) })).toEqual({ kind: "ticket", ticket: t });
    const w = await resolveScan("8902", { cache: idx, tickets: true, getTicket: vi.fn(), server: vi.fn() });
    expect(w.kind === "item" && needsWeight(w)).toBe(true);
    const label = { kind: "item" as const, product: { ...product, unit: "kg" }, soldBy: null, qty: 1.25, source: "server" as const };
    expect(needsWeight(label)).toBe(false);
    expect(needsWeight({ ...label, qty: undefined })).toBe(true);
  });
});

// ---------------------------------------------------------------- weigh tickets in the cart

describe("weigh tickets at the POS", () => {
  it("recognises ticket codes", () => {
    expect(isTicketCode("W26102200017")).toBe(true);
    expect(isTicketCode("w26102200017")).toBe(true);
    expect(isTicketCode("W2610220001")).toBe(false);
    expect(isTicketCode("X26102200017")).toBe(false);
  });

  it("adds a ticket as fixed lines once; edits are ignored; removing a line removes the whole ticket", () => {
    const base = addProduct([], { itemId: "tomato", name: "Tomato", unit: "kg", price: 4000, taxInclusive: true, gstRate: 0 }, 1).lines;
    const r = addTicket(base, ticket());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toHaveLength(3);
    const tl = r.lines.filter((l) => l.ticket)!;
    expect(tl.map((l) => [l.itemId, l.qty, l.price])).toEqual([
      ["tomato", 1.234, 4000],
      ["onion", 0.5, 3000],
    ]);
    // Same ticket again: refused.
    expect(addTicket(r.lines, ticket())).toEqual({ ok: false, reason: "duplicate" });
    expect(addTicket([], ticket({ status: "used" }))).toEqual({ ok: false, reason: "notOpen" });
    // A plain tomato scan never merges into the ticket line.
    const plus = addProduct(r.lines, { itemId: "tomato", name: "Tomato", unit: "kg", price: 4000, taxInclusive: true, gstRate: 0 }, 1);
    expect(plus.lines.find((l) => l.ticket && l.itemId === "tomato")!.qty).toBe(1.234);
    // Fixed: qty / price edits don't apply.
    const k = tl[0]!.key;
    expect(setQty(r.lines, k, 5).find((l) => l.key === k)!.qty).toBe(1.234);
    expect(stepQty(r.lines, k, 1).find((l) => l.key === k)!.qty).toBe(1.234);
    expect(setPrice(r.lines, k, 1).find((l) => l.key === k)!.price).toBe(4000);
    const removed = removeLineOrTicket(r.lines, k);
    expect(removed.map((l) => l.itemId)).toEqual(["tomato"]);
    expect(removed[0]!.ticket).toBeUndefined();
    expect(ticketIdsOf(r.lines)).toEqual(["wt1"]);
    expect(ticketMatches(ticket())).toBe(true);
  });

  it("marks each ticket used after the bill with a stable idempotency key; failures are reported", async () => {
    const use = vi.fn(async (id: string) => {
      if (id === "wt2") throw err(409, "ticket_used");
      return {};
    });
    const r = await markTicketsUsed("inv1", ["wt1", "wt2"], use);
    expect(use).toHaveBeenNthCalledWith(1, "wt1", { invoiceId: "inv1" }, "pos-ticket-use:inv1:wt1");
    expect(use).toHaveBeenNthCalledWith(2, "wt2", { invoiceId: "inv1" }, ticketUseKey("inv1", "wt2"));
    expect(r).toEqual({ used: ["wt1"], failed: [{ id: "wt2", code: "ticket_used" }] });
    expect(ticketErrorOf(err(410, "ticket_expired"))).toBe("expired");
    expect(ticketErrorOf(err(404, "x"))).toBe("notFound");
  });
});

// ---------------------------------------------------------------- scale

describe("Web Serial line parser", () => {
  it("reads kg, grams, signs and stable flags", () => {
    expect(parseScaleLine("  1.234kg")).toEqual({ kg: 1.234, stable: null, raw: "1.234kg" });
    expect(parseScaleLine("ST,GS,+  1.234kg")).toMatchObject({ kg: 1.234, stable: true });
    expect(parseScaleLine("US,GS,+  0.998kg")).toMatchObject({ kg: 0.998, stable: false });
    expect(parseScaleLine("ST,NT,-  0.020kg")).toMatchObject({ kg: -0.02, stable: true });
    expect(parseScaleLine("1234 g")).toMatchObject({ kg: 1.234 });
    expect(parseScaleLine("+001.500 KG")).toMatchObject({ kg: 1.5 });
    expect(parseScaleLine("W:  0.500 KG")).toMatchObject({ kg: 0.5 });
    expect(parseScaleLine("\u0002  2.000kg\u0003")).toMatchObject({ kg: 2 });
    expect(parseScaleLine("   0.750")).toMatchObject({ kg: 0.75 });
    expect(parseScaleLine("2.205 lb")!.kg).toBeCloseTo(1.0, 3);
  });

  it("ignores lines without a weight and overloads", () => {
    expect(parseScaleLine("")).toBeNull();
    expect(parseScaleLine("SCALE READY")).toBeNull();
    expect(parseScaleLine("ST,GS,OL")).toBeNull();
    expect(parseScaleLine("1234")).toBeNull(); // no unit, no decimal point: not a weight
  });

  it("splits chunks into lines (CR, LF, CRLF) and keeps the tail", () => {
    const lines: string[] = [];
    const s = createLineSplitter((l) => lines.push(l));
    s.push("ST,GS,+  1.2");
    s.push("34kg\r\nST,GS,+  1.235kg\r");
    s.push("\n  0.5");
    expect(lines).toEqual(["ST,GS,+  1.234kg", "ST,GS,+  1.235kg"]);
    expect(s.pending).toBe("  0.5");
  });

  it("net weight after tare and manual entry", () => {
    expect(netWeight(1.254, 0.02)).toBe(1.234);
    expect(netWeight(0.02, 0.02)).toBeNull();
    expect(netWeight(1000, 0)).toBeNull();
    expect(parseManualWeight("1,5")).toBe(1.5);
    expect(parseManualWeight("750 g")).toBe(0.75);
    expect(parseManualWeight("abc")).toBeNull();
  });
});

// ---------------------------------------------------------------- printed ticket

describe("ticket print layout and Code 128", () => {
  it("Code 128 patterns are well formed", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((p, i) => {
      const sum = [...p].reduce((s, c) => s + Number(c), 0);
      expect(sum, String(i)).toBe(i === 106 ? 13 : 11);
    });
  });

  it("encodes a ticket code in set B with the modulo-103 check", () => {
    const code = "W26102200017";
    const v = code128Values(code);
    expect(v[0]).toBe(104);
    expect(v.at(-1)).toBe(106);
    const data = [...code].map((c) => c.charCodeAt(0) - 32);
    const check = (104 + data.reduce((s, d, i) => s + d * (i + 1), 0)) % 103;
    expect(v.slice(1, -2)).toEqual(data);
    expect(v.at(-2)).toBe(check);
    const { bars, modules } = code128Bars(code);
    expect(modules).toBe(11 * (code.length + 2) + 13);
    expect(bars[0]).toEqual({ x: 0, w: 2 });
    // Even digit strings use set C (two digits per symbol).
    expect(code128Values("123456").slice(0, 4)).toEqual([105, 12, 34, 56]);
  });

  it("lays out shop, lines with weight × rate, tare, total and the code", () => {
    const money = (p: number) => `₹${(p / 100).toFixed(2)}`;
    const qty = (q: number) => q.toFixed(3);
    const m = ticketPrintModel(ticket(), { shop: "Kumar Stores", terminal: "Weighing 1", paperMm: 58, time: "22 Oct, 10:30", money, qty, labels: { tare: "Tare", total: "Total" } });
    expect(m.widthMm).toBe(48);
    expect(m.code).toBe("W26102200017");
    expect(m.rows).toEqual([
      { kind: "line", left: "Tomato", right: money(lineAmount(1.234, 4000)) },
      { kind: "detail", left: "1.234 kg × ₹40.00/kg" },
      { kind: "detail", left: "Tare 0.020 kg" },
      { kind: "line", left: "Onion", right: "₹15.00" },
      { kind: "detail", left: "0.500 kg × ₹30.00/kg" },
      { kind: "rule", left: "" },
      { kind: "total", left: "Total", right: money(ticket().total) },
    ]);
    expect(ticketPrintModel(ticket(), { shop: "", terminal: "", paperMm: 80, time: "", money, qty, labels: { tare: "", total: "" } }).widthMm).toBe(72);
  });
});

export type { CartLine };

describe("as implemented by the back end", () => {
  it("delta paging sends since on the first page and after alone on the next", async () => {
    const calls: unknown[] = [];
    const pages = [page({ items: [item("1")], next: "p2", cursor: "c1" }), page({ items: [item("2")], cursor: "c2" })];
    let i = 0;
    await fetchCatalogChange(async (q) => {
      calls.push(q);
      return pages[i++]!;
    }, "c0");
    expect(calls).toEqual([{ since: "c0", limit: 1000 }, { after: "p2", limit: 1000 }]);
  });

  it("refuses expired tickets (the resolver answers any state)", () => {
    expect(addTicket([], ticket({ expiresAt: "2026-10-22T18:29:59Z" }), undefined, Date.parse("2026-10-23T00:00:00Z"))).toEqual({ ok: false, reason: "expired" });
  });
});
