import type { BillDraft, HistoryCtx, IndustryHook, IssuedBill, Session, SimItem } from "../context";
import { addDays, daysBetween, istInstant } from "../calendar";
import { personName, testPhone } from "../names";
import type { Rng } from "../rng";

/**
 * Appointment shops (spa, salon): every bill of the day is an appointment, through the bookings service.
 * - the bill's therapies become a booking on the day-calendar (the first free therapist who does them, the start worked
 *   back from the bill time), moved booked → confirmed → arrived → in service, then billed and completed at the bill
 *   time with the front desk's till; payment is taken by the engine as at any counter;
 * - at the start of each day a few appointments are booked and then cancelled (with a reason) or missed (no-show), and
 *   on the last day appointments for the coming week are booked (booked / confirmed) plus one guest arrived and one in
 *   service, so the calendar and the day board look live;
 * - memberships (needs the `memberships` plans of the shop): a few new members a day buy a plan, billed at the desk at
 *   one of the day's bill times (the engine takes the payment); members whose plan has ended renew in the days after
 *   (about 6 in 10); active members check in through the day, more often when sessions are running out.
 * Stateless between days (members, plans and calendar are read back), so a top-up run continues the same shop.
 * Without bookable services it falls back to counter bills.
 */

interface Service {
  id: string;
  itemId: string;
  name: string;
  durationMin: number;
  bufferMin: number;
}
interface Pending {
  index: number;
  kind: "sell" | "renew";
  planId?: string;
  planName?: string;
  subscriptionId?: string;
  memberId?: string;
  name?: string;
}
interface State {
  services: Map<string, Service>;
  plans: { id: string; name: string; weight: number }[];
  pending: Pending[];
  seq: number;
}
const states = new WeakMap<HistoryCtx, State>();

const REASONS = ["Customer asked to cancel", "Change of plans", "Unwell, will rebook", "Travelling that day", "Rescheduled by phone"];
const PLAN_WEIGHT: Record<string, number> = { "Monthly relax": 0.55, "Quarterly renew": 0.33, "Annual wellness": 0.12 };
const MIN_START = 9 * 60 + 30;
const LAST_END = 20 * 60 + 30;

const iso = (date: string, minute: number, seconds = 0) => istInstant(date, minute, seconds).toISOString();

interface Guest {
  name: string;
  phone: string;
  customerId: string | null;
}
function guestOf(r: Rng, draft: BillDraft | null): Guest {
  const c = draft?.customer;
  if (c) return { name: c.planned.name, phone: c.planned.phone, customerId: c.id };
  if (draft?.walkIn) return { name: draft.walkIn.name, phone: draft.walkIn.phone ?? testPhone(r.int(0, 9999)), customerId: null };
  return { name: personName(r).name, phone: testPhone(r.int(0, 9999)), customerId: null };
}

/** Books the services at `start` (a minute of `date`), trying nearby quarter-hours when the calendar is full. */
async function book(ctx: HistoryCtx, r: Rng, date: string, start: number, services: Service[], guest: Guest, opts: { notes?: string | null; earliest?: number; latest?: number } = {}) {
  const dur = services.reduce((n, s) => n + s.durationMin, 0);
  const earliest = opts.earliest ?? MIN_START;
  const latest = opts.latest ?? LAST_END;
  const base = Math.round(start / 15) * 15;
  const offsets = [0, -15, 15, -30, 30, -45, 45, -60, 60, -90, 90, -120, 120, -150, 150];
  for (const off of offsets) {
    const s = base + off;
    if (s < earliest || s + dur > latest) continue;
    try {
      const view = await ctx.kit.bookings.service.create(ctx.tenant.id, {
        serviceIds: services.map((x) => x.id),
        staffId: "any",
        start: iso(date, s),
        customerName: guest.name,
        customerPhone: guest.phone,
        ...(guest.customerId ? { customerId: guest.customerId } : {}),
        notes: opts.notes ?? null,
      });
      return { view, start: s, end: s + dur };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "slot_taken" && code !== "no_staff" && code !== "no_free_staff") {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/free|taken|available|hours|closed|staff|time/i.test(msg)) throw err;
      }
    }
  }
  void r;
  return null;
}

function pickServices(ctx: HistoryCtx, st: State, r: Rng, count: number): Service[] {
  const pool = ctx.items.filter((i) => st.services.has(i.id));
  if (!pool.length) return [];
  const out: Service[] = [];
  const taken = new Set<string>();
  for (let n = 0; n < count; n++) {
    const left = pool.filter((i) => !taken.has(i.id));
    if (!left.length) break;
    const item = r.weighted(left, (i: SimItem) => i.weight);
    taken.add(item.id);
    out.push(st.services.get(item.id)!);
  }
  return out;
}

const minute = (r: Rng, lo: number, hi: number) => r.int(lo, hi);

export const bookingsHook: IndustryHook = {
  id: "bookings",

  async prepare(ctx) {
    const enabled = await ctx.kit.features.service.isEnabled(ctx.tenant.id, "bookings").catch(() => false);
    const services = new Map<string, Service>();
    if (enabled) {
      for (const s of await ctx.kit.bookings.service.services(ctx.tenant.id)) {
        if (s.active) services.set(s.itemId, { id: s.id, itemId: s.itemId, name: s.name, durationMin: s.durationMin, bufferMin: s.bufferMin });
      }
    }
    const plans = (await ctx.kit.memberships.service.plans(ctx.tenant.id).catch(() => [])).map((p) => ({ id: p.id, name: p.name, weight: PLAN_WEIGHT[p.name] ?? 0.2 }));
    states.set(ctx, { services, plans, pending: [], seq: 0 });
    // The real team's names on the tills (names come from the staff module).
    const team = await ctx.kit.staff.service.listMembers(ctx.tenant.id).catch(() => []);
    const named = team.filter((m) => m.name);
    if (named.length) {
      ctx.staff.length = 0;
      for (const m of named) {
        const role = m.roles?.includes("manager") ? "Manager" : m.roles?.includes("cashier") ? "Cashier" : "Technician";
        ctx.staff.push({ role, name: m.name! });
      }
    }
  },

  shapeBill(ctx, draft) {
    const st = states.get(ctx);
    if (!st?.services.size) return;
    const r = draft.rng.fork("appt");
    let lines = draft.lines.filter((l) => st.services.has(l.item.id));
    if (!lines.length) lines = pickServices(ctx, st, r, 1).map((s) => ({ item: ctx.items.find((i) => i.id === s.itemId)!, qty: 1 }));
    // One or two treatments, two hours at most.
    let total = 0;
    draft.lines = lines
      .slice(0, 2)
      .filter((l) => (total += st.services.get(l.item.id)!.durationMin) <= 150 || total === st.services.get(l.item.id)!.durationMin)
      .map((l) => ({ ...l, qty: 1 }));
  },

  async issueBill(ctx, draft, session: Session | null): Promise<IssuedBill[] | null> {
    const st = states.get(ctx);
    if (!st || !session) return null;
    const r = draft.rng.fork("appt");
    const t = ctx.tenant.id;

    // A membership sale or renewal takes this bill slot.
    const slot = st.pending.findIndex((p) => p.index === draft.index);
    if (slot >= 0) {
      const p = st.pending.splice(slot, 1)[0]!;
      const sold = await sellPlan(ctx, st, r, p, draft, session);
      if (sold) return [sold];
    }

    const services = draft.lines.map((l) => st.services.get(l.item.id)).filter((s): s is Service => !!s);
    if (!services.length) return null;
    const dur = services.reduce((n, s) => n + s.durationMin, 0);
    // The bill time is the end of the session: work back to the start, inside opening hours.
    let start = Math.round((draft.minute - dur) / 15) * 15;
    if (start < MIN_START) start = MIN_START + 15 * r.int(0, 3);
    if (start + dur > LAST_END) start = Math.floor((LAST_END - dur) / 15) * 15;
    const guest = guestOf(r, draft);
    const isToday = draft.date === ctx.today;
    try {
      const made = await book(ctx, r, draft.date, start, services, guest, { notes: r.chance(0.12) ? r.pick(["Prefers a female therapist", "Firm pressure, lower back", "First visit", "Allergic to nuts: no almond oil", "Birthday treat"]) : null, latest: isToday ? Math.min(LAST_END, ctx.nowMinutes - 1) : LAST_END });
      if (!made) {
        ctx.log.warn({ date: draft.date, start, dur }, "bookings: no free slot, billing at the counter");
        return null;
      }
      const id = made.view.id;
      ctx.clock.set(draft.date, Math.max(made.start - 240, 0), 5);
      await ctx.kit.bookings.service.setStatus(t, id, { status: "confirmed" });
      ctx.clock.set(draft.date, Math.max(made.start - 6, 0), 20);
      await ctx.kit.bookings.service.setStatus(t, id, { status: "arrived" });
      ctx.clock.set(draft.date, made.start, 10);
      await ctx.kit.bookings.service.setStatus(t, id, { status: "in_service" });
      ctx.clock.set(draft.date, Math.min(made.end + 4, 24 * 60 - 1), r.int(0, 50));
      const { bill } = await ctx.kit.bookings.service.bill(ctx.tenant, id, { customer: { name: guest.name, phone: guest.phone }, tillSessionId: session.id }, { branchId: null });
      const inv = await ctx.kit.invoices.service.get(t, bill.id);
      return [{ id: bill.id, number: bill.number, total: bill.total, paid: inv.paid, lines: [] }];
    } catch (err) {
      ctx.log.warn({ err: err instanceof Error ? err.message : err, date: draft.date }, "bookings: appointment failed, billing at the counter");
      ctx.clock.set(draft.date, draft.minute, 59);
      return null;
    }
  },

  async beginDay(ctx, day) {
    const st = states.get(ctx);
    if (!st || day.closed) return;
    const r = ctx.rng(`appts:${day.date}`);
    st.pending = [];
    const date = day.date;
    const t = ctx.tenant.id;
    const isToday = date === ctx.today;
    const svc = ctx.kit.bookings.service;

    // ---- appointments that never became a visit
    if (st.services.size) {
      const n = r.poisson(day.expected * 0.12);
      for (let i = 0; i < n; i++) {
        const services = pickServices(ctx, st, r, 1);
        if (!services.length) break;
        const guest = guestOf(r, null);
        const start = minute(r, 11 * 60, 18 * 60);
        const latest = isToday ? Math.min(LAST_END, ctx.nowMinutes - 1) : LAST_END;
        const made = await book(ctx, r, date, start, services, guest, { latest }).catch(() => null);
        if (!made) continue;
        const id = made.view.id;
        const noShow = r.chance(0.3);
        ctx.clock.set(date, Math.max(made.start - 300, 0), 5);
        if (r.chance(0.7)) await svc.setStatus(t, id, { status: "confirmed" });
        if (noShow) {
          ctx.clock.set(date, Math.min(made.start + 20, 24 * 60 - 1), 5);
          await svc.setStatus(t, id, { status: "no_show" });
        } else {
          ctx.clock.set(date, Math.max(made.start - r.int(130, 600), 0), 5);
          await svc.setStatus(t, id, { status: "cancelled", reason: r.pick(REASONS) });
        }
      }
    }

    // ---- memberships: renewals, new members, check-ins
    if (st.plans.length) await memberDay(ctx, st, r, day);

    // ---- the coming week and the live board, once
    if (isToday && st.services.size) {
      const upcoming = await svc.list(t, { when: "upcoming", limit: 5 }).catch(() => null);
      if ((upcoming?.items.length ?? 0) < 4) {
        const nowMin = ctx.nowMinutes;
        for (let d = 0; d <= 6; d++) {
          const dd = addDays(date, d);
          const count = d === 0 ? 3 : r.int(2, 5);
          for (let i = 0; i < count; i++) {
            const services = pickServices(ctx, st, r, r.chance(0.2) ? 2 : 1);
            if (!services.length) break;
            const guest = guestOf(r, null);
            const earliest = d === 0 ? Math.max(MIN_START, Math.ceil((nowMin + 90) / 15) * 15) : MIN_START;
            if (earliest > 18 * 60) continue;
            const made = await book(ctx, r, dd, minute(r, earliest, 18 * 60), services, guest, { earliest }).catch(() => null);
            if (!made) continue;
            if (r.chance(0.45)) {
              ctx.clock.set(date, Math.max(nowMin - 5, 0), 5);
              await svc.setStatus(t, made.view.id, { status: "confirmed" });
            }
          }
        }
        // Someone in the chair now and one who just arrived.
        for (const [status, back] of [["in_service", 40], ["arrived", 5]] as const) {
          const services = pickServices(ctx, st, r, 1);
          if (!services.length) break;
          const start = Math.floor(Math.max(MIN_START, nowMin - back) / 15) * 15;
          const made = await book(ctx, r, date, start, services, guestOf(r, null), { earliest: MIN_START, latest: LAST_END }).catch(() => null);
          if (!made) continue;
          ctx.clock.set(date, Math.max(nowMin - 3, 0), 5);
          if (status === "in_service") await svc.setStatus(t, made.view.id, { status: "arrived" });
          await svc.setStatus(t, made.view.id, { status });
        }
      }
    }
  },
};

async function memberDay(ctx: HistoryCtx, st: State, r: Rng, day: { date: string; bills: number; expected: number }) {
  const m = ctx.kit.memberships.service;
  const t = ctx.tenant.id;
  const date = day.date;
  ctx.clock.set(date, 10 * 60);
  const page = await m.listMembers(t, { limit: 100 } as never).catch(() => null);
  const members = page?.items ?? [];

  // Renewals: a plan ended in the last five days and not renewed yet.
  const used = new Set<number>();
  const slotFor = () => {
    for (let tries = 0; tries < 30; tries++) {
      const i = r.int(0, Math.max(0, day.bills - 1));
      if (!used.has(i) && !st.pending.some((p) => p.index === i)) {
        used.add(i);
        return i;
      }
    }
    return null;
  };
  for (const mem of members) {
    const cur = mem.current;
    if (!cur || cur.state !== "expired") continue;
    const since = daysBetween(cur.endDate, date);
    if (since < 1 || since > 5) continue;
    if (!ctx.rng(`renew:${mem.id}:${date}`).chance(0.2)) continue;
    const index = slotFor();
    if (index !== null) st.pending.push({ index, kind: "renew", subscriptionId: cur.id, memberId: mem.id, name: mem.name, planId: cur.planId, planName: cur.planName });
  }
  // New members.
  const newcomers = day.bills > 0 && daysBetween(date, ctx.today) >= 1 ? r.poisson(0.5) : 0;
  for (let i = 0; i < newcomers; i++) {
    const index = slotFor();
    if (index === null) break;
    const plan = r.weighted(st.plans, (p) => p.weight);
    st.pending.push({ index, kind: "sell", planId: plan.id, planName: plan.name });
  }

  // Check-ins.
  for (const mem of members) {
    const cur = mem.current;
    if (!cur || cur.state !== "active" || (cur.sessionsLeft ?? 1) <= 0 || cur.startDate > date) continue;
    const days = Math.max(1, daysBetween(cur.startDate, cur.endDate) + 1);
    const total = cur.sessionsTotal ?? Math.round(days / 3);
    const left = cur.sessionsLeft ?? total;
    const daysLeft = Math.max(1, daysBetween(date, cur.endDate) + 1);
    const p = Math.min(0.6, Math.max(total / days, left / daysLeft) * 1.1);
    if (!ctx.rng(`visit:${mem.id}:${date}`).chance(p)) continue;
    ctx.clock.set(date, r.int(11 * 60, 19 * 60 + 30), r.int(0, 59));
    await m.checkIn(t, { memberId: mem.id }).catch((err: unknown) => ctx.log.warn({ err: String(err) }, "bookings: check-in failed"));
  }
}

async function sellPlan(ctx: HistoryCtx, st: State, r: Rng, p: Pending, draft: BillDraft, session: Session): Promise<IssuedBill | null> {
  const m = ctx.kit.memberships.service;
  try {
    ctx.clock.set(draft.date, draft.minute, r.int(0, 30));
    let sub;
    if (p.kind === "renew") {
      sub = await m.renew(ctx.tenant, p.subscriptionId!, { billNow: true, tillSessionId: session.id }, { branchId: null });
    } else {
      st.seq++;
      const person = personName(r.fork(`m${st.seq}`));
      const member = await m.createMember(ctx.tenant, { name: person.name, phone: testPhone(5000 + ((await memberCount(ctx)) % 4000)) }, { branchId: null });
      sub = await m.sell(ctx.tenant, member.id, { planId: p.planId!, startDate: draft.date, billNow: true, tillSessionId: session.id }, { branchId: null });
    }
    if (!sub.invoiceId) return null;
    const inv = await ctx.kit.invoices.service.get(ctx.tenant.id, sub.invoiceId);
    return { id: inv.id, number: inv.number ?? null, total: inv.total, paid: inv.paid, lines: [] };
  } catch (err) {
    ctx.log.warn({ err: err instanceof Error ? err.message : err, kind: p.kind }, "bookings: membership sale failed");
    return null;
  }
}

async function memberCount(ctx: HistoryCtx): Promise<number> {
  const page = await ctx.kit.memberships.service.listMembers(ctx.tenant.id, { limit: 1 } as never);
  return page.total ?? 0;
}
