import type { Logger } from "pino";
import type { Kit } from "../kit";

/**
 * Restaurant-side setup of store #19 (Theneer Kadai), run by the demo-store seed after the catalogue exists. Counter-
 * first: no tables, no kitchen tickets, so this only gives the shop its team and its two POS counters:
 * 1. the team (phones in the test block +91 90000 78xxx, used by no other shop): an owner-manager, two counter staff
 *    and a juice maker (custom `juice-bar` role: bills, receives payments and sees the menu), each with a POS PIN;
 * 2. two POS terminals, "Morning counter" and "Evening counter" (the registers the history's till sessions use).
 * Idempotent: members, PINs and terminals are added only when missing.
 */

export interface TheneerStaff {
  name: string;
  phone: string;
  role: string;
  roleKeys: string[];
  pin: string;
}

/** Demo PINs (4 digits, not sequences) for the POS lock screen; shown in the docs, never real. */
export const THENEER_STAFF: TheneerStaff[] = [
  { name: "Gopalakrishnan Subramanian", phone: "+919000078101", role: "Owner-manager", roleKeys: ["manager"], pin: "4826" },
  { name: "Muthulakshmi Karthikeyan", phone: "+919000078102", role: "Counter (morning)", roleKeys: ["cashier"], pin: "5173" },
  { name: "Ravichandran Pandian", phone: "+919000078103", role: "Counter (evening)", roleKeys: ["cashier"], pin: "6290" },
  { name: "Selvam Murugesan", phone: "+919000078104", role: "Juice maker", roleKeys: ["juice-bar"], pin: "7348" },
];

export const THENEER_TERMINALS = ["Morning counter", "Evening counter"];

export async function setupTheneer(kit: Kit, tenant: { id: string; slug: string }, ownerUserId: string, log: Logger): Promise<void> {
  const tenantId = tenant.id;
  const actor = { userId: ownerUserId, level: "owner" as const };
  const posActor = { userId: ownerUserId, ip: null, userAgent: null };
  const planId = (await kit.tenancy.service.getRef(tenantId))?.planId ?? null;
  const ref = { id: tenantId, slug: tenant.slug, name: "Theneer Kadai", appId: "RS", planId };

  // ---- team
  if (!(await kit.staff.service.getRole(tenantId, "juice-bar"))) {
    await kit.staff.service.createRole(
      tenantId,
      { key: "juice-bar", name: "Juice maker", description: "Presses juices and shakes and bills at the counter: no reports, no settings.", permissions: ["invoices.create", "payments.receive", "catalogue.view", "pos.till"] },
      actor,
    );
  }
  const have = new Map((await kit.staff.service.listMembers(tenantId)).map((m) => [m.userId, m]));
  const pins = new Map((await kit.pos.service.listPins(tenantId)).items.map((p) => [p.userId, p.hasPin]));
  for (const s of THENEER_STAFF) {
    const { user } = await kit.auth.service.findOrCreateByTarget(s.phone, { name: s.name });
    if (user.name !== s.name) await kit.auth.service.updateProfile(user.id, { name: s.name });
    if (!have.has(user.id)) {
      await kit.staff.service.invite(ref as never, { target: s.phone, roleKeys: s.roleKeys, level: "staff" }, actor);
      log.info({ slug: tenant.slug, name: s.name, role: s.role }, "demo store: team member added");
    }
    if (!pins.get(user.id)) await kit.pos.service.setPin(tenantId, user.id, s.pin, posActor);
  }

  // ---- POS counters
  const terminals = await kit.pos.service.listTerminals(ref as never);
  const named = new Set(terminals.items.map((t) => t.name));
  for (const name of THENEER_TERMINALS) {
    if (named.has(name)) continue;
    await kit.pos.service.createTerminal(ref as never, { name, role: "pos" }, posActor);
    log.info({ slug: tenant.slug, terminal: name }, "demo store: POS terminal added");
  }
}
