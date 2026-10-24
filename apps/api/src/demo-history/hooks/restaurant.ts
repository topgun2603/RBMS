import { seedRestaurantSetup } from "../../seed-fixtures";
import type { HistoryCtx, IndustryHook, IssuedBill } from "../context";
import { addDays } from "../calendar";
import { personName, testPhone } from "../names";

/**
 * Restaurant: every bill comes out of a dining order, the way the shop runs it.
 * - dine-in (about 62%): an order on a table, items added in one or two rounds with a KOT each, the kitchen moves the
 *   tickets to served, then the bill; 12% of tables with two or more lines split the bill in two;
 * - takeaway at the counter (25%) and delivery (13%, as phone / app orders with a customer name and number): KOT sent
 *   with the order, billed straight away.
 * Tables, areas and kitchen stations are seeded when the shop has none (the same set `pnpm seed` uses). If the dining
 * flow is off or fails for a bill, that bill falls back to the standard counter bill.
 */
interface TableRef {
  id: string;
  seats: number;
}
const tablesByShop = new WeakMap<HistoryCtx, TableRef[]>();
/** Delivery-only kitchen (profile `cloud_kitchen`): delivery and pickup orders only, corporate accounts order in bulk. */
const isCloud = (ctx: HistoryCtx) => ctx.profile.id === "cloud_kitchen";

export const restaurantHook: IndustryHook = {
  id: "restaurant",

  async prepare(ctx) {
    if (!ctx.features.dining) return;
    // A cloud kitchen has no dining room: no tables, only kitchen stations (the demo store sets them).
    if (!isCloud(ctx)) await seedRestaurantSetup(ctx.kit, ctx.tenant.id, ctx.log, ctx.slug);
    const svc = ctx.kit.dining.service;
    tablesByShop.set(ctx, (await svc.tables(ctx.tenant.id)).map((t) => ({ id: t.id, seats: t.seats })));
    // Kitchen station and veg / non-veg for the menu.
    const have = new Set((await svc.menuItems(ctx.tenant.id)).map((m) => m.itemId));
    for (const item of ctx.items) {
      if (have.has(item.id) || !item.entry.station) continue;
      await svc.saveMenuItem(ctx.tenant.id, item.id, { station: item.entry.station, veg: item.entry.veg ?? true });
    }
  },

  /** Offices on monthly credit order lunch boxes and party trays in bulk. */
  shapeBill(ctx, draft) {
    const c = draft.customer;
    if (!isCloud(ctx) || !c || c.planned.creditLimit === null) return;
    const r = draft.rng;
    const pool = ctx.items.filter((i) => /Party Tray|– Combo|Meals Box|Biryani & Chicken 65 Box/.test(i.name));
    if (!pool.length) return;
    const lines: typeof draft.lines = [];
    for (let k = 0, n = r.int(1, 3); k < n; k++) {
      const item = r.pick(pool.filter((p) => !lines.some((l) => l.item.id === p.id)));
      lines.push({ item, qty: /Party Tray|Feast|Platter/.test(item.name) ? r.int(1, 3) : r.int(8, 30) });
    }
    draft.lines = lines;
  },

  async issueBill(ctx, draft, session) {
    const tables = tablesByShop.get(ctx);
    if (!ctx.features.dining || (!isCloud(ctx) && !tables?.length) || !session) return null;
    const svc = ctx.kit.dining.service;
    const t = ctx.tenant.id;
    const r = draft.rng;
    // Credit accounts of a dine-in restaurant order in bulk for pickup or delivery (a table cannot hold thirty meals).
    const bulk = !isCloud(ctx) && draft.customer?.planned.creditLimit != null;
    const kind = r.weighted(["dine_in", "takeaway", "delivery"] as const, (k) => (isCloud(ctx) ? (k === "dine_in" ? 0 : k === "takeaway" ? 0.14 : 0.86) : bulk ? (k === "dine_in" ? 0 : k === "takeaway" ? 0.6 : 0.4) : k === "dine_in" ? 0.62 : k === "takeaway" ? 0.25 : 0.13));
    let orderId: string | null = null;
    try {
      const items = draft.lines.map((l) => ({ itemId: l.item.id, qty: l.qty }));
      const guests = kind === "dine_in" ? r.int(1, 6) : undefined;
      const customer = kind === "dine_in" ? null : { name: draft.customer?.planned.name ?? personName(r).name, phone: draft.customer?.planned.phone ?? testPhone(r.int(9000, 9999)) };
      if (kind === "dine_in") {
        const table = (tables ?? []).find((x) => x.seats >= (guests ?? 1)) && r.pick((tables ?? []).filter((x) => x.seats >= (guests ?? 1)));
        const open = await svc.open(t, { type: "dine_in", tableId: table!.id, guests, items: items.slice(0, Math.max(1, Math.ceil(items.length / 2))) }, null);
        orderId = open.id;
        await svc.sendKot(t, orderId);
        // Now and then a guest changes their mind after the KOT went out: the line is cancelled with a reason.
        if (items.length >= 2 && r.chance(0.07)) {
          const sent = await svc.get(t, orderId);
          const line = sent.items.find((i) => i.status !== "cancelled");
          if (line) await svc.removeLine(t, orderId, line.id, { reason: r.pick(["Guest changed their mind", "Taking too long", "Wrong item taken", "Sold out in the kitchen"]) }, { allowSent: true }).catch(() => undefined);
        }
        const rest = items.slice(Math.max(1, Math.ceil(items.length / 2)));
        if (rest.length) {
          ctx.clock.set(draft.date, draft.minute + 18);
          await svc.addItems(t, orderId, rest, { sendKot: true });
        }
      } else {
        const open = await svc.open(t, { type: kind, customerName: customer!.name, customerPhone: customer!.phone, items, sendKot: true }, null);
        orderId = open.id;
      }
      // The kitchen works through the tickets.
      ctx.clock.set(draft.date, draft.minute + (kind === "dine_in" ? 30 : 15));
      const order = await svc.get(t, orderId);
      for (const kot of order.kots) {
        for (const status of ["preparing", "ready", "served"] as const) await svc.moveKot(t, kot.id, { status }).catch(() => undefined);
      }
      const lineIds = order.items.filter((i) => i.status !== "cancelled").map((i) => i.id);
      const split = kind === "dine_in" && lineIds.length >= 2 && r.chance(0.12);
      const billed = await svc.bill(
        ctx.tenant,
        orderId,
        {
          tillSessionId: session.id,
          // A saved customer (corporate / caterer on credit) is linked to the bill, with its due date.
          ...(draft.customer ? { customer: { name: draft.customer.planned.name, phone: draft.customer.planned.phone, customerId: draft.customer.id, ...(draft.customer.planned.creditLimit !== null ? { dueDate: addDays(draft.date, draft.customer.planned.payer === "regular" ? 15 : 30) } : {}) } } : {}),
          ...(split ? { splits: [lineIds.slice(0, Math.ceil(lineIds.length / 2))] } : {}),
        },
        { branchId: null },
      );
      const out: IssuedBill[] = [];
      for (const b of billed.bills) {
        const inv = await ctx.kit.invoices.service.get(t, b.id);
        out.push({ id: b.id, number: b.number, total: b.total, paid: inv.paid, lines: [] });
      }
      return out;
    } catch (err) {
      ctx.log.warn({ err: err instanceof Error ? err.message : err, date: draft.date }, "restaurant: dining order failed, billing at the counter");
      if (orderId) await svc.cancel(t, orderId, { reason: "Entered again at the counter" }).catch(() => undefined);
      return null;
    }
  },
};
