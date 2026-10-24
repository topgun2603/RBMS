import type { Logger } from "pino";
import type { Kit } from "../kit";
import { DISHES } from "./vaasam-menu";

/**
 * Restaurant-side setup of store #18 (Vaasam Biryani Kitchen), run by the demo-store seed after the catalogue exists:
 * 1. kitchen stations and veg / non-veg marks for every dish, so online orders print KOTs per station (kitchen,
 *    biryani, beverages) on the kitchen display;
 * 2. the team (phones in the test block +91 90000 6xxxx, not used by any other shop) with roles and POS PINs: a manager,
 *    two kitchen staff (custom `kitchen` role: kitchen display and serving only) and a dispatcher / cashier.
 * Idempotent: stations are set only for dishes with none, members and PINs only when missing.
 */

export interface VaasamStaff {
  name: string;
  phone: string;
  role: string;
  roleKeys: string[];
  pin: string;
}

/** Demo PINs (4 digits, not sequences) for the POS lock screen; shown in the docs, never real. */
export const VAASAM_STAFF: VaasamStaff[] = [
  { name: "Senthil Kumaran", phone: "+919000060101", role: "Manager", roleKeys: ["manager"], pin: "4821" },
  { name: "Muthu Selvam", phone: "+919000060102", role: "Kitchen (biryani)", roleKeys: ["kitchen"], pin: "5937" },
  { name: "Pandiyan Murugesan", phone: "+919000060103", role: "Kitchen (tawa and fry)", roleKeys: ["kitchen"], pin: "6074" },
  { name: "Revathi Subramani", phone: "+919000060104", role: "Dispatcher and cashier", roleKeys: ["cashier", "delivery"], pin: "7352" },
];

export async function setupVaasam(kit: Kit, tenant: { id: string; slug: string }, ownerUserId: string, log: Logger): Promise<void> {
  const tenantId = tenant.id;

  // ---- stations and veg marks
  const dining = kit.dining.service;
  const marked = new Set((await dining.menuItems(tenantId)).map((m) => m.itemId));
  const items = (await kit.catalogue.service.listItems(tenantId, { limit: 500 })).items;
  let stationed = 0;
  for (const item of items) {
    if (marked.has(item.id)) continue;
    const dish = DISHES.find((d) => item.name === d.name || item.name.startsWith(`${d.name} – `));
    if (!dish) continue;
    await dining.saveMenuItem(tenantId, item.id, { station: dish.station, veg: dish.veg && !dish.egg });
    stationed++;
  }
  if (stationed) log.info({ slug: tenant.slug, items: stationed }, "demo store: kitchen stations set");

  // ---- team
  const actor = { userId: ownerUserId, level: "owner" as const, ip: null, userAgent: null };
  const ref = { id: tenantId, slug: tenant.slug, name: "Vaasam Biryani Kitchen", appId: "RS", planId: (await kit.tenancy.service.getRef(tenantId))?.planId ?? null };
  if (!(await kit.staff.service.getRole(tenantId, "kitchen"))) {
    await kit.staff.service.createRole(tenantId, { key: "kitchen", name: "Kitchen", description: "Cooks: see the kitchen display and mark tickets, nothing else.", permissions: ["dining.kitchen", "dining.serve"] }, actor);
  }
  const have = new Map((await kit.staff.service.listMembers(tenantId)).map((m) => [m.userId, m]));
  const pins = new Map((await kit.pos.service.listPins(tenantId)).items.map((p) => [p.userId, p.hasPin]));
  for (const s of VAASAM_STAFF) {
    const { user } = await kit.auth.service.findOrCreateByTarget(s.phone, { name: s.name });
    if (user.name !== s.name) await kit.auth.service.updateProfile(user.id, { name: s.name });
    if (!have.has(user.id)) {
      await kit.staff.service.invite(ref as never, { target: s.phone, roleKeys: s.roleKeys, level: "staff" }, actor);
      log.info({ slug: tenant.slug, name: s.name, role: s.role }, "demo store: team member added");
    }
    if (!pins.get(user.id)) await kit.pos.service.setPin(tenantId, user.id, s.pin, actor);
  }
}
