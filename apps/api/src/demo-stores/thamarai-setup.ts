import type { Logger } from "pino";
import type { Kit } from "../kit";
import { VISIT_NAME } from "./thamarai-programmes";

/**
 * Appointment-side setup of Thamarai Vidyalaya, run by the demo-store seed after the catalogue exists: the "Campus
 * visit and counselling (45 min)" service (so /book works for parents), the school office's weekly hours (Monday to
 * Saturday) and two counsellors parents can choose (no sign-in: they are calendar columns only). The visit is free:
 * a billing item at ₹0, exempt (SAC 999299, 0%), kept off the online store, so a parent never sees a "fee" for it.
 * Idempotent: everything is matched by name and created only when missing.
 */
const week = (days: number[], opens: string, closes: string, breaks: { from: string; to: string }[] = []) => days.map((weekday) => ({ weekday, opens, closes, breaks }));
const LUNCH = [{ from: "12:45", to: "13:30" }];
/** 0 = Sunday: the office is closed on Sunday. */
const OFFICE = [...week([1, 2, 3, 4, 5], "09:30", "16:30", LUNCH), ...week([6], "09:30", "12:30")];

const COUNSELLORS = [
  { name: "Mrs. Jeyanthi Natarajan (Admissions counsellor)", color: "#7a1f3d", days: [...week([1, 2, 3, 4, 5], "09:30", "16:30", LUNCH), ...week([6], "09:30", "12:30")] },
  { name: "Mr. Balaji Srinivasan (Academic coordinator)", color: "#b08a3e", days: week([1, 2, 3, 4, 5], "10:00", "16:00", LUNCH) },
];

export async function setupThamarai(kit: Kit, tenant: { id: string; slug: string }, _ownerUserId: string, log: Logger): Promise<void> {
  const tenantId = tenant.id;
  const bookings = kit.bookings.service;

  // ---- the visit as a bookable service
  let item = (await kit.catalogue.service.listItems(tenantId, { limit: 500 })).items.find((i) => i.name === VISIT_NAME);
  if (!item) {
    // The shop is normally created with this billing item (thamarai.ts); an older shop gets it here.
    await kit.invoices.service.createItem(tenantId, { name: VISIT_NAME, hsn: "999299", unit: "visit", rate: 0, gstRate: 0 });
    item = (await kit.catalogue.service.listItems(tenantId, { limit: 500 })).items.find((i) => i.name === VISIT_NAME);
  }
  if (!item) throw new Error(`thamarai setup: catalogue item "${VISIT_NAME}" is missing`);
  const have = (await bookings.services(tenantId, { includeInactive: true })).find((s) => s.itemId === item!.id);
  if (!have) {
    await bookings.createService(tenantId, { itemId: item.id, durationMin: 45, bufferMin: 15, onlineBookable: true, sort: 10 });
    log.info({ slug: tenant.slug }, "demo store: campus visit service ready");
  }

  // ---- office hours and counsellors
  const hours = await bookings.hours(tenantId);
  if (!hours.shop.length) await bookings.putHours(tenantId, { staffId: null, days: OFFICE });
  const haveStaff = new Set((await bookings.staff(tenantId, { includeInactive: true })).map((s) => s.name));
  for (const [i, c] of COUNSELLORS.entries()) {
    if (haveStaff.has(c.name)) continue;
    const row = await bookings.createStaff(tenantId, { name: c.name, color: c.color, serviceItemIds: [item.id], sort: i * 10 });
    await bookings.putHours(tenantId, { staffId: row.id, days: c.days });
    log.info({ slug: tenant.slug, name: c.name }, "demo store: counsellor added to the calendar");
  }
}
