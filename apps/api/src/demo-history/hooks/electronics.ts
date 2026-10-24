import { addDays } from "../calendar";
import type { HistoryCtx, IndustryHook, LowStock, SimItem } from "../context";
import { createRng, type Rng } from "../rng";

/**
 * Electronics: serial / IMEI tracked goods.
 * - once per run, the items marked `serial` in the profile get their tracking settings (warranty months, dual IMEI) and
 *   a unit in stock for every piece the shop holds (IMEIs with a correct check digit; other goods get a prefixed serial);
 * - a restock receives the new units before the supplier's bill takes the goods into stock;
 * - a sale puts the unit's IMEI / serial on the bill line (the kit marks it sold and starts its warranty from the bill
 *   date), one unit per phone or appliance; a line with no unit left is dropped;
 * - now and then a customer comes back with a sold unit and a warranty claim is noted on it. (The serials service has no
 *   simulated clock, so a claim's own time stamp is the real time of the run; the sale and warranty dates are the bill's.)
 */
interface State {
  /** In-stock units per item id: [IMEI 1 or serial, IMEI 2]. */
  pool: Map<string, [string, string | null][]>;
  counter: number;
  claimed: Set<string>;
  rng: Rng;
}
const STATE = new WeakMap<HistoryCtx, State>();

const luhnCheckDigit = (digits14: string): string => {
  let sum = 0;
  for (let i = 0; i < digits14.length; i++) {
    let d = Number(digits14[digits14.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
};

/** A 15-digit IMEI: a type-allocation code per model (8 digits), a 6-digit serial and the Luhn check digit. */
function imei(model: number, n: number, lead: string): string {
  const body = `${lead}${String(100_000 + (model * 137) % 800_000).padStart(6, "0")}${String((n * 7919) % 1_000_000).padStart(6, "0")}`;
  return body + luhnCheckDigit(body);
}

const CLAIM_NOTES = [
  "Screen flickers after an update, sent to the service centre for a display check",
  "Battery drains in a few hours, battery test booked at the service centre",
  "Charging port loose, replaced under warranty",
  "Speaker crackles at high volume, collected for repair",
  "Touch not responding at the top edge, panel replaced under warranty",
  "Dead pixels noticed in week 3, brand technician visited and approved a replacement",
  "Remote control and Wi-Fi not pairing, technician visit completed",
  "Cooling is weak after 4 months, gas top-up and service done on site",
  "Drum makes a grinding noise on spin, bearing replaced by the brand technician",
  "Fridge door seal worn, gasket replaced on site",
  "Keyboard keys not registering, keyboard replaced at the service centre",
  "Phone restarts on its own, motherboard check done at the service centre",
];

async function enabled(ctx: HistoryCtx): Promise<boolean> {
  return ctx.kit.features.service.isEnabled(ctx.tenant.id, "serials").catch(() => false);
}

function serialsFor(ctx: HistoryCtx, st: State, item: SimItem, n: number): [string, string | null][] {
  const sp = item.entry.serial!;
  const model = ctx.items.indexOf(item) + 1;
  const out: [string, string | null][] = [];
  for (let i = 0; i < n; i++) {
    st.counter++;
    if (sp.prefix === "IMEI") out.push([imei(model, st.counter, "35"), sp.dual ? imei(model, st.counter + 500_000, "86") : null]);
    else out.push([`${sp.prefix}${String(26)}${String(model).padStart(3, "0")}${String(st.counter).padStart(6, "0")}`, null]);
  }
  return out;
}

async function receive(ctx: HistoryCtx, st: State, item: SimItem, n: number, supplier?: string) {
  if (n <= 0) return;
  const units = serialsFor(ctx, st, item, n);
  const cost = Math.round(item.rate * item.entry.cost);
  for (let i = 0; i < units.length; i += 200) {
    const batch = units.slice(i, i + 200);
    await ctx.kit.serials.service.receive(ctx.tenant.id, {
      itemId: item.id,
      itemName: item.name,
      units: batch.map(([serial, serial2]) => ({ serial, serial2 })),
      supplier: supplier ?? item.entry.supplier ?? null,
      costPaise: cost,
      note: "Demo history",
    });
  }
  const pool = st.pool.get(item.id) ?? [];
  pool.push(...units);
  st.pool.set(item.id, pool);
}

export const electronicsHook: IndustryHook = {
  id: "electronics",

  async prepare(ctx) {
    if (!(await enabled(ctx))) return;
    const svc = ctx.kit.serials.service;
    const tenantId = ctx.tenant.id;
    // Units already in the shop: the pool for sales, and a counter above every serial made so far.
    const st: State = { pool: new Map(), counter: 0, claimed: new Set(), rng: ctx.rng("serials") };
    const all = await svc.listUnits(tenantId, { limit: 1, offset: 0 } as never);
    st.counter = all.total + 1000;
    for (let offset = 0; ; offset += 200) {
      const page = await svc.listUnits(tenantId, { status: "in_stock", limit: 200, offset } as never);
      for (const u of page.items) {
        const list = st.pool.get(u.itemId) ?? [];
        list.push([u.serial, u.serial2 ?? null]);
        st.pool.set(u.itemId, list);
      }
      if (offset + 200 >= page.total || page.items.length === 0) break;
    }
    STATE.set(ctx, st);
    let received = 0;
    let tracked = 0;
    for (const item of ctx.items) {
      const sp = item.entry.serial;
      if (!sp) continue;
      await svc.saveItem(tenantId, item.id, { name: item.name, tracked: true, warrantyMonths: sp.months, dualImei: sp.dual });
      tracked++;
      const have = st.pool.get(item.id)?.length ?? 0;
      const need = Math.max(0, Math.round(item.stock) - have);
      await receive(ctx, st, item, need);
      received += need;
    }
    ctx.say(`electronics: ${tracked} serial-tracked items, ${received} unit(s) received into stock`);
  },

  async beginDay(ctx, day) {
    const st = STATE.get(ctx);
    if (!st) return;
    // A warranty claim on a unit sold at least a week ago, on about one day in five.
    const r = createRng(`${ctx.slug}:claims:${day.date}`);
    if (!r.chance(0.2)) return;
    const sold = await ctx.kit.serials.service.listUnits(ctx.tenant.id, { status: "sold", limit: 60, offset: 0 } as never);
    const pick = sold.items.filter((u) => !st.claimed.has(u.id) && u.soldOn && u.soldOn <= addDays(day.date, -7));
    if (!pick.length) return;
    const unit = r.pick(pick);
    st.claimed.add(unit.id);
    await ctx.kit.serials.service.claim(ctx.tenant.id, unit.id, { note: r.pick(CLAIM_NOTES) }).catch(() => undefined);
  },

  shapeBill(ctx, draft) {
    const st = STATE.get(ctx);
    if (!st) return;
    const kept: typeof draft.lines = [];
    for (const l of draft.lines) {
      if (!l.item.entry.serial) {
        kept.push(l);
        continue;
      }
      const pool = st.pool.get(l.item.id) ?? [];
      // One unit per phone or appliance line; two only for the cheaper goods (watches, earbuds are not tracked).
      const want = Math.max(1, Math.min(l.qty, 2, pool.length));
      if (!pool.length) continue;
      const taken = pool.splice(0, want);
      l.qty = taken.length;
      l.serials = taken.map((t) => t[0]);
      kept.push(l);
    }
    draft.lines = kept;
  },

  async restock(ctx, _plan, low: LowStock[]) {
    const st = STATE.get(ctx);
    if (!st) return false;
    for (const l of low) {
      if (!l.item.entry.serial) continue;
      await receive(ctx, st, l.item, Math.round(l.qty));
    }
    // The supplier's bill (the engine's own purchase) takes the goods into stock.
    return false;
  },
};
