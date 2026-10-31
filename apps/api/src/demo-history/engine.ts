import type { Logger } from "pino";
import { APPAREL_FOOTWEAR_GST_RULE } from "@rbms/gst";
import type { Kit } from "../kit";
import { addDays, istMinutes, istToday, pendingDays, windowDates } from "./calendar";
import { SimClock, type PurchaseLineSpec, type BillDraft, type BillLine, type HistoryCtx, type IndustryHook, type IssuedBill, type LowStock, type Session, type SimCustomer, type SimItem } from "./context";
import { creditBalanceAfter, planCustomers, repayChance } from "./customers";
import { expenseDay, expectedDailyUnits, itemWeights, planDay, sampleBillTimes, type DayPlan } from "./planner";
import { personName, testPhone } from "./names";
import type { CatalogueEntry, Profile } from "./profiles";
import { createRng } from "./rng";
import { hookFor } from "./hooks";

export interface RunOptions {
  slug: string;
  profile: Profile;
  days: number;
  dryRun?: boolean;
  log: Logger;
  say?: (line: string) => void;
  /** Override "now" (tests, reproducible reports). */
  realNow?: Date;
}

export interface RunStats {
  days: number;
  skippedDays: number;
  bills: number;
  failedBills: number;
  sales: number;
  payments: number;
  receipts: number;
  receiptAmount: number;
  creditNotes: number;
  purchases: number;
  purchaseTotal: number;
  expenses: number;
  tillSessions: number;
}

const emptyStats = (): RunStats => ({ days: 0, skippedDays: 0, bills: 0, failedBills: 0, sales: 0, payments: 0, receipts: 0, receiptAmount: 0, creditNotes: 0, purchases: 0, purchaseTotal: 0, expenses: 0, tillSessions: 0 });

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const REGISTER_OK = (profile: Profile, register: string) => profile.registers.some((r) => r.toLowerCase() === register.toLowerCase());

interface Ev {
  minute: number;
  kind: "bill" | "receipt" | "return";
  i: number;
  // receipt
  customer?: SimCustomer;
  // return
  ret?: PendingReturn;
}
interface PendingReturn {
  invoiceId: string;
  customer: SimCustomer | null;
  line: number;
  itemId: string | null;
  qty: number;
  mode: "cash" | "upi" | "card" | "credit_book";
  dueDate: string;
}

export async function runHistory(kit: Kit, clock: SimClock, opts: RunOptions): Promise<RunStats> {
  const { slug, profile, log } = opts;
  const say = opts.say ?? ((l: string) => console.log(l));
  const realNow = opts.realNow ?? new Date();
  const today = istToday(realNow);
  const window = windowDates(today, opts.days);
  const stats = emptyStats();

  const tenant = await kit.tenancy.service.getBySlug(slug);
  if (!tenant) throw new Error(`No shop "${slug}" (create it first: pnpm seed)`);
  const tenantId = tenant.id;
  const ref = { id: tenant.id, slug: tenant.slug, planId: tenant.planId, appId: tenant.appId };

  // Days already generated: a day with a till session of one of the profile's registers is done (top-up skips it).
  const sessions = (await kit.invoices.service.till.list(tenantId, { from: window[0]!, to: today, limit: 200 })).items.filter((s) => REGISTER_OK(profile, s.register));
  const done = new Set(sessions.map((s) => s.date));
  const pending = pendingDays(window, done);
  stats.skippedDays = window.length - pending.length;
  say(`${slug} (${profile.label}): window ${window[0]} to ${today}, ${done.size} day(s) already generated, ${pending.length} to do`);

  if (opts.dryRun) {
    const rows = pending.map((d) => planDay(profile, slug, d));
    reportPlan(say, rows);
    return { ...stats, days: rows.length, bills: rows.reduce((a, r) => a + r.bills, 0) };
  }

  const features: Record<string, boolean> = {};
  for (const key of ["inventory", "inventory.purchases", "expenses", "invoices.credit-book", "scales", "medicines", "medicines.prescriptions", "dining", "jewellery", "jewellery.exchange"]) {
    features[key] = await kit.features.service.isEnabled(tenantId, key).catch(() => false);
  }

  const hook = hookFor(profile.hook);
  const billing = (await kit.settings.service.handle("billing").get({ tenantId }).catch(() => ({}))) as { city?: string };
  const ctx: HistoryCtx = {
    kit,
    slug,
    tenant: { ...ref, name: tenant.name },
    profile,
    city: billing.city,
    log,
    say,
    clock,
    items: [],
    customers: [],
    staff: [],
    features,
    rng: (label) => createRng(`${slug}:${label}`),
    day: null,
    repayBoost: 1,
    recordPurchase: async () => false,
    today,
    nowMinutes: istMinutes(realNow),
    windowStart: window[0]!,
  };

  await prepare(ctx, hook, pending.length === window.length);
  const engine = new Engine(ctx, hook, stats, pending.length === window.length);
  ctx.recordPurchase = (date, supplier, lines) => engine.recordPurchase(date, supplier, lines, createRng(`${slug}:purchase:${date}:${supplier}`));
  await engine.closeStaleTills(sessions);
  await engine.loadUnpaidPurchases();

  const started = Date.now();
  for (const [n, date] of pending.entries()) {
    const plan = planDay(profile, slug, date);
    try {
      await engine.day(plan);
    } finally {
      clock.reset();
    }
    stats.days++;
    const elapsed = (Date.now() - started) / 1000;
    say(`${date} ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][plan.weekday]}  bills ${String(engine.dayBills).padStart(3)}  sales ${money(engine.daySales).padStart(9)}${plan.festival ? `  [${plan.festival}]` : ""}   (${n + 1}/${pending.length}, ${elapsed.toFixed(0)}s)`);
  }
  return stats;
}

function reportPlan(say: (l: string) => void, rows: DayPlan[]) {
  let bills = 0;
  for (const r of rows) {
    bills += r.bills;
    say(`  ${r.date} ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][r.weekday]}  bills ${String(r.bills).padStart(3)}  x${r.factor.toFixed(2)}${r.festival ? `  [${r.festival}]` : ""}`);
  }
  say(`dry run: ${rows.length} day(s), ${bills} bill(s) would be generated; nothing written`);
}

// ------------------------------------------------------------------ setup

async function prepare(ctx: HistoryCtx, hook: IndustryHook, firstRun: boolean) {
  const { kit, tenant, profile, slug } = ctx;
  const tenantId = tenant.id;
  const inv = kit.invoices.service;

  // Items: everything the shop already has, plus the profile's catalogue entries it lacks (matched by name).
  const existing = [];
  for (let offset = 0; ; offset += 200) {
    const page = await inv.listItems(tenantId, { limit: 200, offset } as never);
    existing.push(...page.items);
    if (existing.length >= page.total || page.items.length === 0) break;
  }
  const byName = new Map(existing.map((i) => [i.name.toLowerCase(), i]));
  const universe: { id: string; name: string; unit: string; hsn: string | null; rate: number; gstRate: number; gstRule?: SimItem["gstRule"]; entry: CatalogueEntry }[] = [];
  const used = new Set<string>();
  for (const entry of profile.catalogue) {
    let item = byName.get(entry.name.toLowerCase());
    if (!item) {
      if ((entry.band || entry.barcode) && kit.catalogue?.service) {
        // Catalogue product: carries the price-band rule and barcode (bare billing items cannot).
        const product = await kit.catalogue.service.createProduct(tenantId, {
          name: entry.name, hsn: entry.hsn, unit: entry.unit, gstRate: entry.gstRate, taxInclusive: false, channels: ["billing", "store"],
          ...(entry.band ? { gstRule: APPAREL_FOOTWEAR_GST_RULE } : {}),
          price: entry.rate, mrp: Math.round(entry.rate * (1 + entry.gstRate / 100) * 1.1 / 100) * 100,
          cost: Math.round(entry.rate * entry.cost), ...(entry.barcode ? { barcode: entry.barcode } : {}),
        } as never);
        item = await inv.getItem(tenantId, product.variants[0]!.id);
      } else {
        item = await inv.createItem(tenantId, { name: entry.name, hsn: entry.hsn, unit: entry.unit, rate: entry.rate, gstRate: entry.gstRate } as never);
      }
      ctx.log.info({ slug, item: entry.name }, "demo-history: item created");
    }
    used.add(item.id);
    universe.push({ id: item.id, name: item.name, unit: item.unit, hsn: item.hsn ?? null, rate: item.rate, gstRate: item.gstRate, gstRule: item.gstRule ?? null, entry });
  }
  // Other saved items of the shop sell too, rarely (the long tail).
  if (profile.catalogue.length > 0) {
    for (const item of existing) {
      if (used.has(item.id) || item.active === false) continue;
      const entry: CatalogueEntry = { name: item.name, hsn: item.hsn ?? "", unit: item.unit, rate: item.rate, gstRate: item.gstRate, cost: 0.85, reorder: 10, supplier: profile.suppliers[0]?.name, qty: [1, 2], pack: 6 };
      universe.push({ id: item.id, name: item.name, unit: item.unit, hsn: item.hsn ?? null, rate: item.rate, gstRate: item.gstRate, gstRule: item.gstRule ?? null, entry });
    }
  }

  const weights = itemWeights(profile, universe.length);
  const inventoryOn = Boolean(ctx.features.inventory);
  const stockRows = new Map<string, { qty: number; reorderLevel: number; track: boolean }>();
  if (inventoryOn) {
    for (let offset = 0; ; offset += 200) {
      const list = await kit.inventory.service.listStock(tenantId, { limit: 200, offset } as never);
      for (const r of list.items) stockRows.set(r.itemId, { qty: Number(r.qty), reorderLevel: Number(r.reorderLevel), track: Boolean(r.track) });
      if (list.items.length < 200) break;
    }
  }
  ctx.items = [];
  for (const [rank, u] of universe.entries()) {
    const wanted = u.entry.reorder !== undefined;
    const daily = expectedDailyUnits(profile, Math.min(rank, profile.catalogue.length - 1), profile.catalogue.length) * (rank < profile.catalogue.length ? 1 : 0.05);
    const reorder = wanted ? Math.max(u.entry.reorder!, Math.ceil(daily * Math.min(profile.stock.reorderCoverDays, u.entry.cover ?? Infinity))) : 0;
    const row = stockRows.get(u.id);
    if (inventoryOn && row) {
      if (wanted && (row.reorderLevel !== reorder || !row.track)) await kit.inventory.service.updateStock(tenantId, u.id, { reorderLevel: reorder, track: true } as never);
      if (!wanted && row.track) await kit.inventory.service.updateStock(tenantId, u.id, { track: false } as never);
    }
    ctx.items.push({ id: u.id, name: u.name, unit: u.unit, hsn: u.hsn, rate: u.rate, gstRate: u.gstRate, gstRule: u.gstRule ?? null, entry: u.entry, weight: weights[rank] ?? 0.01, tracked: inventoryOn && wanted, stock: row && wanted ? row.qty : 0, daily, reorder });
  }

  // Suppliers.
  if (profile.suppliers.length) {
    const have = await kit.inventory.service.listSuppliers(tenantId, { limit: 200 } as never);
    const names = new Set(have.items.map((s) => s.name.toLowerCase()));
    const r = createRng(`${slug}:suppliers`);
    for (const [i, s] of profile.suppliers.entries()) {
      if (names.has(s.name.toLowerCase())) continue;
      await kit.inventory.service.createSupplier(tenantId, { name: s.name, stateCode: "33", phone: testPhone(9000 + i * 11 + r.int(0, 9)) } as never);
    }
  }

  // Customers: planned deterministically, created when missing (matched by phone).
  const planned = planCustomers(profile, slug, ctx.city);
  const have = new Map<string, { id: string; outstanding: number }>();
  for (let offset = 0; ; offset += 200) {
    const page = await inv.listCustomers(tenantId, { limit: 200, offset } as never);
    for (const c of page.items) if (c.phone) have.set(c.phone.replace(/\s/g, ""), { id: c.id, outstanding: c.outstanding });
    if (offset + 200 >= page.total || page.items.length === 0) break;
  }
  ctx.customers = [];
  for (const p of planned) {
    let h = have.get(p.phone);
    if (!h) {
      const c = await inv.createCustomer(tenantId, { name: p.name, phone: p.phone, address: p.address, stateCode: "33", creditLimit: p.creditLimit, gstin: p.gstin } as never);
      h = { id: c.id, outstanding: 0 };
    }
    ctx.customers.push({ id: h.id, planned: p, balance: h.outstanding });
  }

  // Staff names (labels on tills and salary expenses; they are not sign-in users).
  const sr = createRng(`${slug}:staff`);
  for (const role of profile.staff) for (let i = 0; i < role.count; i++) ctx.staff.push({ role: role.role, name: personName(sr).name });

  await hook.prepare?.(ctx);
  ctx.say(`prepared: ${ctx.items.length} items (${ctx.items.filter((i) => i.tracked).length} stock-tracked), ${ctx.customers.length} customers (${ctx.customers.filter((c) => c.planned.creditLimit !== null).length} on credit), ${ctx.staff.length} staff${firstRun ? "" : " (top-up run)"}`);
}

// ------------------------------------------------------------------ the engine

class Engine {
  dayBills = 0;
  daySales = 0;
  private returns: PendingReturn[] = [];
  /** Unpaid supplier purchases: paid on their due date. */
  private unpaid: { id: string; dueOn: string }[] = [];
  private streak = 0;
  private categoryIds = new Map<string, string>();

  constructor(
    private readonly ctx: HistoryCtx,
    private readonly hook: IndustryHook,
    private readonly stats: RunStats,
    private readonly firstRun: boolean,
  ) {}

  private get kit() {
    return this.ctx.kit;
  }
  private get tenantId() {
    return this.ctx.tenant.id;
  }
  private get inv() {
    return this.kit.invoices.service;
  }
  private at(date: string, minute: number, second = 0) {
    this.ctx.clock.set(date, minute, second);
  }

  /**
   * Drawers an earlier run left open (today's current shift) are counted and closed first: a register can be open only
   * once, and a top-up may be generating older days on the same register.
   */
  async closeStaleTills(sessions: { id: string; status: string; date: string; register: string }[]) {
    for (const s of sessions) {
      if (s.status !== "open") continue;
      if (s.date < this.ctx.today) this.at(s.date, this.ctx.profile.hours.close);
      await this.closeSession({ id: s.id, register: s.register, cashier: this.pickCashier(createRng(`${this.ctx.slug}:stale:${s.id}`)) }, createRng(`${this.ctx.slug}:close:${s.id}`));
      this.ctx.clock.reset();
    }
  }

  async loadUnpaidPurchases() {
    if (!this.ctx.features.inventory) return;
    const page = await this.kit.inventory.service.listPurchases(this.tenantId, { status: "unpaid", limit: 200 } as never);
    for (const p of page.items) {
      const supplier = this.ctx.profile.suppliers.find((s) => s.name === p.supplierName);
      this.unpaid.push({ id: p.id, dueOn: addDays(p.date, (supplier?.creditDays ?? 14) + (hashJitter(p.id) % 9) - 2) });
    }
  }

  private pickCashier(rng: ReturnType<typeof createRng>) {
    const pool = this.ctx.staff.filter((s) => s.role === "Cashier" || s.role === "Manager" || s.role === "Salesman" || s.role === "Pharmacist");
    return (pool.length ? rng.pick(pool) : { name: "Counter staff" }).name;
  }

  // -------------------------------------------------------------- a day

  async day(plan: DayPlan) {
    const { ctx, kit } = this;
    const { profile, slug } = ctx;
    const date = plan.date;
    const rng = createRng(`${slug}:run:${date}`);
    this.dayBills = 0;
    this.daySales = 0;
    ctx.day = plan;
    ctx.repayBoost = 1;
    const isToday = date === ctx.today;
    const cap = isToday ? ctx.nowMinutes - 1 : 24 * 60;

    // Before opening: supplier payments due, hook set-up (metal rates), restock, expenses.
    this.at(date, plan.open - 45);
    await this.hook.beginDay?.(ctx, plan);
    await this.payDueSuppliers(date);
    this.at(date, plan.open - 30);
    await this.restock(plan, rng);
    await this.expenses(date, rng);
    if (plan.closed) return;

    // Events of the day in time order: bills, receipts from credit customers, returns.
    const events: Ev[] = [];
    for (const [i, minute] of sampleBillTimes(profile, rng.fork("times"), plan.bills).entries()) if (minute <= cap) events.push({ minute, kind: "bill", i });
    const rr = rng.fork("receipts");
    for (const c of ctx.customers) {
      if (c.balance <= 0 || c.planned.creditLimit === null) continue;
      if (rr.chance(Math.min(0.9, repayChance(profile.customers.repayChance, c.planned.payer) * ctx.repayBoost))) {
        const minute = Math.round(rr.normal(12 * 60 + 30, 150));
        events.push({ minute: Math.min(Math.max(minute, plan.open + 20), plan.close - 20), kind: "receipt", i: events.length, customer: c });
      }
    }
    const due = this.returns.filter((r) => r.dueDate <= date);
    this.returns = this.returns.filter((r) => r.dueDate > date);
    for (const r of due) events.push({ minute: Math.round(rr.float(plan.open + 60, plan.close - 60)), kind: "return", i: events.length, ret: r });
    const live = events.filter((e) => e.minute <= cap).sort((a, b) => a.minute - b.minute || a.i - b.i);

    // Registers share the opening hours in equal slots, each with its own cashier for the day.
    const slots = profile.registers.map((name, k) => {
      const span = (plan.close - plan.open) / profile.registers.length;
      return { name, from: Math.round(plan.open + k * span), to: Math.round(plan.open + (k + 1) * span), cashier: this.pickCashier(rng.fork(`cashier${k}`)), session: null as Session | null };
    });
    const slotFor = (minute: number) => slots.find((s) => minute >= s.from && minute < s.to) ?? slots[slots.length - 1]!;

    for (const ev of live) {
      const slot = slotFor(ev.minute);
      if (!slot.session) slot.session = await this.openSession(date, slot, rng.fork(`open${slot.name}`));
      this.at(date, ev.minute, rng.int(0, 59));
      if (ev.kind === "bill") await this.bill(date, ev, slot.session, rng);
      else if (ev.kind === "receipt") await this.receipt(date, ev.customer!, rr);
      else await this.creditNote(date, ev.ret!, slot.session);
    }
    // A day with no events still opens (and closes) the first register: the drawer was counted.
    if (slots.every((s) => !s.session) && plan.open <= cap) slots[0]!.session = await this.openSession(date, slots[0]!, rng.fork("open0"));

    // Close the drawers whose shift is over (today's current shift stays open, like a live shop).
    for (const slot of slots) {
      if (!slot.session) continue;
      if (isToday && slot.to > cap) continue;
      this.at(date, Math.min(slot.to + 5, 24 * 60 - 1));
      await this.closeSession(slot.session, rng.fork(`close${slot.name}`));
    }
  }

  // -------------------------------------------------------------- tills

  private async openSession(date: string, slot: { name: string; from: number; cashier: string }, rng: ReturnType<typeof createRng>): Promise<Session> {
    this.at(date, Math.max(slot.from - 8, 0));
    const [lo, hi] = this.ctx.profile.tillFloat;
    const s = await this.inv.till.open(this.tenantId, { register: slot.name, openingCash: roundTo(rng.int(lo, hi), 50_00) }, { actor: { id: null, name: slot.cashier } });
    this.stats.tillSessions++;
    return { id: s.id, register: slot.name, cashier: slot.cashier };
  }

  private async closeSession(session: Session, rng: ReturnType<typeof createRng>) {
    const { report } = await this.inv.till.report(this.tenantId, session.id);
    let expected = report.cash.expected;
    const float = report.cash.opening;
    // The owner takes the surplus cash to the bank before closing.
    const surplus = Math.floor((expected - float - 50_000) / 50_000) * 50_000;
    if (surplus >= 100_000 && rng.chance(0.85)) {
      const amount = Math.floor((surplus * rng.float(0.7, 1)) / 50_000) * 50_000;
      if (amount > 0) {
        await this.inv.till.cash(this.tenantId, session.id, { amount: -amount, reason: "Cash deposited to bank" }, { id: null, name: session.cashier });
        expected -= amount;
      }
    }
    const off = rng.chance(0.78) ? 0 : rng.pick([-1, 1, -1]) * rng.int(1, 12) * 1000;
    await this.inv.till.close(this.tenantId, session.id, { countedCash: Math.max(expected + off, 0), note: off === 0 ? null : off < 0 ? "Short; checked and noted" : "Excess; noted" }, { id: null, name: session.cashier });
  }

  // -------------------------------------------------------------- bills

  private draft(date: string, ev: Ev, rng: ReturnType<typeof createRng>): BillDraft {
    const { ctx } = this;
    const { profile } = ctx;
    const br = createRng(`${ctx.slug}:bill:${date}:${ev.i}`);
    void rng;
    let customer: SimCustomer | null = null;
    if (ctx.customers.length && br.chance(profile.customers.namedShare)) {
      customer = br.weighted(ctx.customers, (c) => c.planned.visits * (c.planned.creditLimit !== null ? 1.6 : 1));
    }
    const lines: BillLine[] = [];
    const sellable = ctx.items.filter((i) => !i.tracked || i.stock > 0);
    const count = Math.min(profile.basket.maxLines, 1 + br.poisson(profile.basket.items - 1), sellable.length);
    const taken = new Set<string>();
    for (let n = 0; n < count; n++) {
      const pool = sellable.filter((i) => !taken.has(i.id));
      if (!pool.length) break;
      const item = br.weighted(pool, (i) => i.weight);
      taken.add(item.id);
      const [lo, hi] = item.entry.qty ?? [1, 2];
      let qty = item.entry.loose ? roundTo(lo + (hi - lo) * br.next() ** 1.5, 0.25) : lo + Math.floor((hi - lo + 1) * br.next() ** 2);
      qty = Math.max(item.entry.loose ? 0.25 : 1, qty);
      if (item.tracked) qty = Math.min(qty, item.entry.loose ? Math.floor(item.stock * 4) / 4 : Math.floor(item.stock));
      if (qty <= 0) continue;
      lines.push({ item, qty });
    }
    return { date, minute: ev.minute, index: ev.i, rng: br, customer, lines };
  }

  private async bill(date: string, ev: Ev, session: Session, dayRng: ReturnType<typeof createRng>) {
    const { ctx, hook } = this;
    const draft = this.draft(date, ev, dayRng);
    hook.shapeBill?.(ctx, draft);
    if (draft.needsCustomer && !draft.customer && ctx.customers.length) draft.customer = draft.rng.pick(ctx.customers);
    if (!draft.lines.length && !hook.issueBill) return;
    try {
      let bills = (await hook.issueBill?.(ctx, draft, session)) ?? null;
      if (!bills) bills = [await this.issue(draft, session)];
      for (const b of bills) await this.settle(date, draft, b, session);
      // Stock moves on issue; keep the local count in step with what the services took.
      for (const l of draft.lines) if (l.item.tracked) l.item.stock = Math.max(0, +(l.item.stock - l.qty).toFixed(3));
      await hook.afterBill?.(ctx, draft, bills);
      this.maybeReturn(date, draft, bills);
      this.streak = 0;
      this.stats.bills += bills.length;
      this.dayBills += bills.length;
      for (const b of bills) {
        this.stats.sales += b.total;
        this.daySales += b.total;
      }
    } catch (err) {
      this.stats.failedBills++;
      this.ctx.log.warn({ err: err instanceof Error ? err.message : err, date, index: ev.i }, "demo-history: a bill failed");
      if (++this.streak >= 15) throw new Error(`Stopping: ${this.streak} bills in a row failed (last: ${err instanceof Error ? err.message : String(err)})`);
    }
  }

  private async issue(draft: BillDraft, session: Session): Promise<IssuedBill> {
    const c = draft.customer;
    const credit = c?.planned.creditLimit !== null && c?.planned.creditLimit !== undefined;
    const terms = c?.planned.payer === "regular" ? 15 : 30;
    const invoice = await this.inv.create(
      this.ctx.tenant,
      {
        date: draft.date,
        issue: true,
        ...(c ? { customerId: c.id } : draft.walkIn ? { customer: draft.walkIn } : {}),
        ...(credit ? { dueDate: addDays(draft.date, terms) } : {}),
        tillSessionId: session.id,
        lines: draft.lines.map((l) => ({
          description: l.description ?? l.item.name,
          itemId: l.item.id,
          qty: l.qty,
          unit: l.item.unit,
          rate: l.rate ?? l.item.rate,
          gstRate: l.item.gstRate,
          ...(l.item.gstRule ? { gstRule: l.item.gstRule } : {}),
          ...(l.item.hsn ? { hsn: l.item.hsn } : {}),
          ...(l.serials?.length ? { serials: l.serials } : {}),
        })),
      } as never,
      { branchId: null },
    );
    return { id: invoice.id, number: invoice.number, total: invoice.total, paid: invoice.paid, lines: invoice.lines.map((l) => ({ itemId: l.itemId ?? null, qty: l.qty, description: l.description })) };
  }

  /** Payment at the counter: one method, sometimes split in two; a credit customer puts part (or all) on the book. */
  private async settle(date: string, draft: BillDraft, bill: IssuedBill, session: Session) {
    const { profile } = this.ctx;
    const r = draft.rng;
    let toPay = bill.total - bill.paid;
    const c = draft.customer;
    if (c && c.planned.creditLimit !== null && toPay > 0 && r.chance(profile.customers.onCredit)) {
      const credit = creditBalanceAfter({ balance: c.balance, limit: c.planned.creditLimit }, toPay);
      if (credit.onCredit > 0) {
        c.balance = credit.balance;
        toPay -= credit.onCredit;
        // Some pay a part now.
        if (toPay === 0 && credit.onCredit > 5000 && r.chance(0.25)) {
          const part = roundTo(credit.onCredit * r.float(0.2, 0.5), 1000);
          if (part > 0 && part < credit.onCredit) {
            toPay = part;
            c.balance -= part;
          }
        }
      }
    }
    if (toPay <= 0) return;
    const m = profile.payments;
    const method = r.weighted(["cash", "upi", "card"] as const, (k) => m[k]);
    const split = method !== "cash" && toPay > 20_000 && r.chance(0.08);
    const parts: { method: "cash" | "upi" | "card"; amount: number }[] = split ? (() => {
      const first = roundTo(toPay * r.float(0.3, 0.6), 1000);
      return [{ method: "cash" as const, amount: first }, { method, amount: toPay - first }];
    })() : [{ method, amount: toPay }];
    for (const p of parts) {
      if (p.amount <= 0) continue;
      await this.inv.addPayment(this.tenantId, bill.id, { amount: p.amount, method: p.method, date, tillSessionId: session.id } as never, null);
      this.stats.payments++;
    }
    void draft;
  }

  private maybeReturn(date: string, draft: BillDraft, bills: IssuedBill[]) {
    const { profile } = this.ctx;
    if (!draft.rng.chance(profile.returnRate)) return;
    const bill = bills[0];
    if (!bill || bill.lines.length === 0) return;
    const idx = draft.rng.int(0, bill.lines.length - 1);
    const line = bill.lines[idx]!;
    const c = draft.customer;
    const paidAtOnce = bill.total - bill.paid <= 0 || !c || c.planned.creditLimit === null;
    const mode = paidAtOnce && !c ? draft.rng.weighted(["cash", "upi", "card"] as const, (k) => profile.payments[k]) : c ? "credit_book" : "cash";
    this.returns.push({
      invoiceId: bill.id,
      customer: c,
      line: idx,
      itemId: line.itemId ?? null,
      qty: Math.min(line.qty, line.qty > 3 ? 1 : line.qty),
      mode,
      dueDate: addDays(date, draft.rng.int(0, 3)),
    });
  }

  private async creditNote(date: string, ret: PendingReturn, session: Session) {
    try {
      const res = await this.inv.creditNotes.create(
        this.tenantId,
        ret.invoiceId,
        {
          date,
          reason: "return",
          refundMode: ret.mode,
          note: "Customer return",
          lines: [{ line: ret.line, qty: ret.qty, restock: true }],
          ...(ret.mode === "cash" ? { tillSessionId: session.id } : {}),
        } as never,
        null,
      );
      this.stats.creditNotes++;
      void res;
      const item = ret.itemId ? this.ctx.items.find((i) => i.id === ret.itemId) : undefined;
      if (item?.tracked) item.stock += ret.qty;
      if (ret.customer) ret.customer.balance = (await this.inv.getCustomer(this.tenantId, ret.customer.id)).outstanding;
    } catch (err) {
      this.ctx.log.warn({ err: err instanceof Error ? err.message : err, date }, "demo-history: a credit note failed");
    }
  }

  // -------------------------------------------------------------- credit book

  private async receipt(date: string, c: SimCustomer, r: ReturnType<typeof createRng>) {
    if (c.balance <= 0) return;
    const full = r.chance(c.planned.payer === "regular" ? 0.6 : 0.3);
    const amount = full ? c.balance : Math.min(c.balance, Math.max(10_000, roundTo(c.balance * r.float(0.25, 0.8), 10_000)));
    if (amount <= 0) return;
    const method = r.chance(0.55) ? "cash" : "upi";
    await this.inv.addReceipt(this.tenantId, c.id, { amount, method, date, note: full ? "Settled the account" : "Part payment" } as never, null);
    c.balance -= amount;
    this.stats.receipts++;
    this.stats.receiptAmount += amount;
  }

  // -------------------------------------------------------------- stock

  private async restock(plan: DayPlan, rng: ReturnType<typeof createRng>) {
    const { ctx } = this;
    if (!ctx.features.inventory) return;
    const opening = this.firstRun && this.stats.days === 0;
    const low: LowStock[] = [];
    for (const item of ctx.items) {
      if (!item.tracked) continue;
      if (item.stock > item.reorder && !(opening && item.stock <= 0)) continue;
      const cover = Math.min(opening ? ctx.profile.stock.openingCoverDays : ctx.profile.stock.orderCoverDays, item.entry.cover ?? Infinity);
      const pack = item.entry.pack ?? 1;
      const need = Math.max(item.daily * cover - item.stock, item.reorder * 1.5 - item.stock, pack);
      low.push({ item, qty: Math.ceil(need / pack) * pack });
    }
    if (!low.length) return;
    if (await this.hook.restock?.(ctx, plan, low)) {
      for (const l of low) l.item.stock += l.qty;
      return;
    }
    await this.recordPurchases(plan.date, low, rng, true);
  }

  /** One purchase per supplier; with `addStock` the lines carry item ids (inventory takes the goods in). */
  async recordPurchases(date: string, low: LowStock[], rng: ReturnType<typeof createRng>, addStock: boolean) {
    const bySupplier = new Map<string, LowStock[]>();
    for (const l of low) {
      const key = l.item.entry.supplier ?? this.ctx.profile.suppliers[0]?.name ?? "";
      bySupplier.set(key, [...(bySupplier.get(key) ?? []), l]);
    }
    for (const [name, lines] of bySupplier) {
      const ok = await this.recordPurchase(
        date,
        name,
        lines.map((l) => ({
          ...(addStock ? { itemId: l.item.id } : {}),
          description: l.item.name,
          hsn: l.item.hsn ?? undefined,
          qty: l.qty,
          unit: l.item.unit,
          rate: Math.max(1, Math.round(l.item.rate * l.item.entry.cost)),
          gstRate: l.item.gstRate,
        })),
        rng,
      );
      if (ok && addStock) for (const l of lines) l.item.stock += l.qty;
    }
  }

  /** A supplier's bill: paid at once when the supplier gives no credit (or sometimes), else paid on its due date. */
  async recordPurchase(date: string, supplierName: string, lines: PurchaseLineSpec[], rng: ReturnType<typeof createRng>): Promise<boolean> {
    const terms = this.ctx.profile.suppliers.find((s) => s.name === supplierName)?.creditDays ?? 0;
    const paid = terms <= 1 || rng.chance(0.3);
    try {
      const suppliers = await this.kit.inventory.service.listSuppliers(this.tenantId, { limit: 200 } as never);
      const supplier = suppliers.items.find((s) => s.name === supplierName);
      const p = await this.kit.inventory.service.createPurchase(
        this.tenantId,
        {
          ...(supplier ? { supplierId: supplier.id } : { supplier: { name: supplierName || "Cash purchase" } }),
          billNumber: `${supplierName.replace(/[^A-Z]/g, "").slice(0, 3) || "INV"}/${date.slice(2).replaceAll("-", "")}/${rng.int(100, 999)}`,
          date,
          paid,
          lines,
        } as never,
        null,
      );
      if (!paid) this.unpaid.push({ id: p.id, dueOn: addDays(date, terms + rng.int(-2, 8)) });
      this.stats.purchases++;
      this.stats.purchaseTotal += p.total;
      return true;
    } catch (err) {
      this.ctx.log.warn({ err: err instanceof Error ? err.message : err, date, supplier: supplierName }, "demo-history: a purchase failed");
      return false;
    }
  }

  private async payDueSuppliers(date: string) {
    const due = this.unpaid.filter((u) => u.dueOn <= date);
    if (!due.length) return;
    this.unpaid = this.unpaid.filter((u) => u.dueOn > date);
    for (const u of due) await this.kit.inventory.service.setPurchasePaid(this.tenantId, u.id, { paid: true }).catch(() => undefined);
  }

  // -------------------------------------------------------------- expenses

  private async category(name: string): Promise<string | undefined> {
    if (!this.categoryIds.size) for (const c of await this.kit.expenses.service.categories(this.tenantId)) this.categoryIds.set(c.name, c.id);
    return this.categoryIds.get(name);
  }

  private async expense(date: string, e: { category: string; amount: number; note: string; vendor?: string; method: string }) {
    const categoryId = await this.category(e.category);
    await this.kit.expenses.service.create(
      this.tenantId,
      { date, ...(categoryId ? { categoryId } : {}), amount: Math.max(100, roundTo(e.amount, 100)), gstRate: 0, vendorName: e.vendor ?? null, paymentMethod: e.method, note: e.note } as never,
      null,
    );
    this.stats.expenses++;
  }

  private async expenses(date: string, rng: ReturnType<typeof createRng>) {
    const { ctx } = this;
    if (!ctx.features.expenses) return;
    const p = ctx.profile;
    const er = rng.fork("expenses");
    try {
      for (const rule of p.monthlyExpenses) {
        if (!expenseDay(date, rule.day)) continue;
        await this.expense(date, { ...rule, amount: rule.amount * (1 + er.float(-rule.jitter, rule.jitter)), vendor: rule.vendor });
      }
      if (expenseDay(date, 1)) {
        for (const s of ctx.staff) await this.expense(date, { category: "Salaries", amount: p.staff.find((r) => r.role === s.role)!.salary, note: `Salary: ${s.role}`, vendor: s.name, method: "bank" });
      }
      for (const w of p.weeklyExpenses) {
        if (w.weekday !== "daily" && new Date(`${date}T00:00:00Z`).getUTCDay() !== w.weekday) continue;
        await this.expense(date, { ...w, amount: er.int(w.amount[0], w.amount[1]) });
      }
    } catch (err) {
      ctx.log.warn({ err: err instanceof Error ? err.message : err, date }, "demo-history: an expense failed");
    }
  }
}

function hashJitter(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

