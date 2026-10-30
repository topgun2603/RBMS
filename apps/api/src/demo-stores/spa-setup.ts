import { itemName } from "@rbms/catalogue";
import type { Logger } from "pino";
import type { Kit } from "../kit";
import { PLANS, THERAPIES, minLabel } from "./spa-products";

/**
 * Appointment-side setup of store #21 (Sukham Ayur Spa), run by the demo-store seed after the catalogue exists:
 * 1. the team (phones in the test block +91 90000 9xxxx, used by no other shop): a manager, three therapists (custom
 *    `therapist` role: appointments and member check-in only) and a front desk (cashier role). The services app has no
 *    POS terminals, so there are no PINs;
 * 2. every therapy duration as a bookable service (duration, turnover buffer), the shop's weekly hours, and each
 *    therapist's services and weekly hours;
 * 3. the three membership plans, linked to their catalogue items (5% GST; the plan price is the GST-exclusive rate).
 * Idempotent: everything is matched by name / item and created only when missing.
 */
export interface SpaStaff {
  name: string;
  phone: string;
  role: string;
  roleKeys: string[];
  /** Bookable therapist (appointment calendar column). */
  therapist?: { color: string; days: { weekday: number; opens: string; closes: string; breaks: { from: string; to: string }[] }[]; does: (category: string, name: string) => boolean };
}

const week = (days: number[], opens: string, closes: string, breaks: { from: string; to: string }[] = []) => days.map((weekday) => ({ weekday, opens, closes, breaks }));
const ALL = [0, 1, 2, 3, 4, 5, 6];
const LUNCH = [{ from: "13:30", to: "14:15" }];

export const SPA_STAFF: SpaStaff[] = [
  { name: "Revathi Krishnamoorthy", phone: "+919000090101", role: "Manager", roleKeys: ["manager"] },
  {
    name: "Kavitha Murugesan",
    phone: "+919000090102",
    role: "Senior therapist (massage and Ayurveda)",
    roleKeys: ["therapist"],
    therapist: { color: "#7c6fa8", days: week([0, 2, 3, 4, 5, 6], "09:30", "19:30", LUNCH), does: (c) => ["Massages", "Ayurvedic therapies", "Foot reflexology", "Couple packages", "Steam & sauna", "Body scrubs & wraps"].includes(c) },
  },
  {
    name: "Anandhi Selvaraj",
    phone: "+919000090103",
    role: "Therapist (facials, scrubs and foot care)",
    roleKeys: ["therapist"],
    therapist: { color: "#8aa39b", days: week([0, 1, 3, 4, 5, 6], "11:00", "20:30", [{ from: "15:00", to: "15:45" }]), does: (c, n) => ["Facials", "Body scrubs & wraps", "Foot reflexology", "Steam & sauna", "Couple packages"].includes(c) || ["Abhyanga (herbal oil massage)", "Shirodhara", "Shiro abhyanga (head and shoulder oil)", "Aromatherapy massage", "Swedish relaxation massage", "Head, neck and shoulder massage"].includes(n) },
  },
  {
    name: "Prakash Rajendran",
    phone: "+919000090104",
    role: "Therapist (deep tissue and Ayurveda)",
    roleKeys: ["therapist"],
    therapist: { color: "#c49a6c", days: week([0, 1, 2, 4, 5, 6], "10:00", "20:30", LUNCH), does: (c, n) => (c === "Massages" && n !== "Aromatherapy massage") || (c === "Ayurvedic therapies" && n !== "Shirodhara") || c === "Steam & sauna" || c === "Couple packages" || c === "Body scrubs & wraps" },
  },
  { name: "Divya Bharathi", phone: "+919000090105", role: "Front desk", roleKeys: ["cashier"] },
];

export async function setupSpa(kit: Kit, tenant: { id: string; slug: string }, ownerUserId: string, log: Logger): Promise<void> {
  const tenantId = tenant.id;
  const actor = { userId: ownerUserId, level: "owner" as const, ip: null, userAgent: null };
  const ref = { id: tenantId, slug: tenant.slug, name: "Sukham Ayur Spa", appId: "SV", planId: (await kit.tenancy.service.getRef(tenantId))?.planId ?? null };

  // ---- team
  if (!(await kit.staff.service.getRole(tenantId, "therapist"))) {
    await kit.staff.service.createRole(tenantId, { key: "therapist", name: "Therapist", description: "Sees the appointment calendar, moves clients through their visit and checks members in.", permissions: ["*.view", "bookings.desk", "memberships.checkin"] } as never);
  }
  const have = new Map((await kit.staff.service.listMembers(tenantId)).map((m) => [m.userId, m]));
  const userIds = new Map<string, string>();
  for (const s of SPA_STAFF) {
    const { user } = await kit.auth.service.findOrCreateByTarget(s.phone, { name: s.name });
    if (user.name !== s.name) await kit.auth.service.updateProfile(user.id, { name: s.name });
    userIds.set(s.phone, user.id);
    if (!have.has(user.id)) {
      await kit.staff.service.invite(ref as never, { target: s.phone, roleKeys: s.roleKeys, level: "staff" }, actor);
      log.info({ slug: tenant.slug, name: s.name, role: s.role }, "demo store: team member added");
    }
  }

  // ---- bookable services (one per therapy duration)
  const bookings = kit.bookings.service;
  const items = new Map((await kit.catalogue.service.listItems(tenantId, { limit: 500 })).items.map((i) => [i.name, i.id]));
  const haveServices = new Set((await bookings.services(tenantId, { includeInactive: true })).map((s) => s.itemId));
  const serviceItems = new Map<string, { category: string; name: string }>();
  let sort = 0;
  for (const t of THERAPIES) {
    for (const [min] of t.rows) {
      const name = t.rows.length > 1 ? itemName(t.name, minLabel(min)) : t.name;
      const itemId = items.get(name);
      if (!itemId) throw new Error(`spa setup: catalogue item "${name}" is missing`);
      serviceItems.set(itemId, { category: t.category, name: t.name });
      sort += 10;
      if (haveServices.has(itemId)) continue;
      await bookings.createService(tenantId, { itemId, durationMin: min, bufferMin: t.buffer, onlineBookable: true, sort });
    }
  }
  if (sort) log.info({ slug: tenant.slug, services: serviceItems.size }, "demo store: bookable services ready");

  // ---- hours and therapists
  const hours = await bookings.hours(tenantId);
  if (!hours.shop.length) await bookings.putHours(tenantId, { staffId: null, days: week(ALL, "09:30", "20:30") });
  const haveStaff = new Map((await bookings.staff(tenantId, { includeInactive: true })).map((s) => [s.name, s]));
  const hoursNow = await bookings.hours(tenantId);
  const sameDays = (a: { weekday: number; opens: string; closes: string; breaks: { from: string; to: string }[] }[], b: typeof a) => JSON.stringify([...a].sort((x, y) => x.weekday - y.weekday)) === JSON.stringify([...b].sort((x, y) => x.weekday - y.weekday));
  for (const [i, s] of SPA_STAFF.entries()) {
    if (!s.therapist) continue;
    const does = [...serviceItems.entries()].filter(([, v]) => s.therapist!.does(v.category, v.name)).map(([id]) => id);
    const found = haveStaff.get(s.name);
    if (!found) {
      const row = await bookings.createStaff(tenantId, { name: s.name, userId: userIds.get(s.phone), color: s.therapist.color, serviceItemIds: does, sort: i * 10 });
      await bookings.putHours(tenantId, { staffId: row.id, days: s.therapist.days });
      log.info({ slug: tenant.slug, name: s.name, services: does.length }, "demo store: therapist added to the calendar");
      continue;
    }
    // Keep an existing therapist's services and weekly hours in step with this file.
    if (JSON.stringify([...(found.serviceItemIds ?? [])].sort()) !== JSON.stringify([...does].sort())) await bookings.updateStaff(tenantId, found.id, { serviceItemIds: does });
    if (!sameDays(hoursNow.staff[found.id] ?? [], s.therapist.days)) await bookings.putHours(tenantId, { staffId: found.id, days: s.therapist.days });
  }

  // ---- membership plans
  const memberships = kit.memberships.service;
  const havePlans = new Set((await memberships.plans(tenantId, { includeInactive: true })).map((p) => p.name));
  for (const [i, p] of PLANS.entries()) {
    if (havePlans.has(p.name)) continue;
    await memberships.createPlan(tenantId, {
      name: p.name,
      description: p.description,
      durationDays: p.durationDays,
      sessions: p.sessions,
      // GST-exclusive rate: the bill adds 5%, so the guest pays the price on the product.
      price: Math.round((p.price * 100) / 1.05),
      gstRate: 5,
      itemId: items.get(p.product) ?? null,
      freezeDaysAllowed: p.freezeDaysAllowed,
      sort: i * 10,
    });
    log.info({ slug: tenant.slug, plan: p.name }, "demo store: membership plan created");
  }
}
