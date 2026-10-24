import type { IndustryHook } from "../context";
import { addDays } from "../calendar";
import { personName } from "../names";
import { createRng } from "../rng";

/**
 * Pharmacy:
 * - prepare: every catalogue item becomes a medicine (schedule, composition, pack) on shops with the medicines feature;
 *   the shop's real team (manager, cashiers, stock keeper) replaces the generated staff names;
 * - restock: stock arrives as batches with expiry (`medicines.receive`, which also raises the inventory totals), most
 *   with 12 to 30 months of life and a few short-dated ones; the supplier's bill is recorded without stock lines, so
 *   purchases, input credit and payables are right without counting the goods twice;
 * - sales take from the batches first-expiry-first through the invoice-issued hook of the kit (no code here);
 * - bills with Schedule H1 / H / X medicines go to a saved customer and get a prescription (patient, doctor with
 *   registration number), which is what the H1 register shows.
 */
const RX = new Set(["H1", "H", "X", "narcotic"]);
const DOCTORS = ["Dr. S. Ramesh MBBS", "Dr. K. Meenakshi MD", "Dr. R. Balasubramanian MBBS", "Dr. P. Anitha MBBS", "Dr. V. Karthikeyan MD", "Dr. M. Subbulakshmi MBBS"];

export const pharmacyHook: IndustryHook = {
  id: "pharmacy",

  async prepare(ctx) {
    if (!ctx.features.medicines) return;
    const svc = ctx.kit.medicines.service;
    for (const item of ctx.items) {
      const e = item.entry;
      if (!e.schedule) continue;
      if (await svc.getMedicine(ctx.tenant.id, item.id)) continue;
      await svc.saveMedicine(ctx.tenant.id, item.id, {
        name: item.name,
        composition: e.composition,
        manufacturer: e.manufacturer,
        rack: e.rack,
        schedule: e.schedule,
        packSize: e.packSize ?? 1,
        packUnit: item.unit,
      });
    }
    // The people at the counter are the shop's real team when it has one (names on tills and salaries): a manager is
    // the pharmacist in charge, a stock keeper the helper.
    try {
      const roleFor: Record<string, string> = { manager: "Pharmacist", cashier: "Cashier", "stock-keeper": "Helper" };
      const team = (await ctx.kit.staff.service.listMembers(ctx.tenant.id)).flatMap((m) => {
        const key = Object.keys(roleFor).find((k) => m.roleKeys.includes(k));
        return m.name && key ? [{ role: roleFor[key]!, name: m.name }] : [];
      });
      if (team.length) ctx.staff.splice(0, ctx.staff.length, ...team);
    } catch {
      // No staff module: the generated names stay.
    }
  },

  shapeBill(_ctx, draft) {
    // A prescription needs a patient on record.
    if (draft.lines.some((l) => l.item.entry.schedule && RX.has(l.item.entry.schedule))) draft.needsCustomer = true;
  },

  async restock(ctx, day, low) {
    if (!ctx.features.medicines) return false;
    const svc = ctx.kit.medicines.service;
    const r = createRng(`${ctx.slug}:batches:${day.date}`);
    const bySupplier = new Map<string, typeof low>();
    for (const l of low) {
      if (!l.item.entry.schedule) continue;
      const s = l.item.entry.supplier ?? "";
      bySupplier.set(s, [...(bySupplier.get(s) ?? []), l]);
    }
    for (const l of low) {
      const e = l.item.entry;
      if (!e.schedule) continue;
      const months = r.chance(0.07) ? r.int(2, 4) : r.int(12, 30);
      const expiry = addDays(day.date, months * 30).slice(0, 7);
      const mrp = Math.round((l.item.rate * (100 + l.item.gstRate)) / 100 / 100) * 100;
      await svc.receive(ctx.tenant.id, {
        itemId: l.item.id,
        itemName: l.item.name,
        batchNo: `${l.item.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}${day.date.slice(2, 4)}${day.date.slice(5, 7)}${r.int(10, 99)}`,
        expiry,
        mrp,
        purchaseRate: Math.round(l.item.rate * e.cost),
        qty: l.qty,
        supplier: e.supplier ?? null,
        note: "Purchase received",
      });
    }
    // The supplier bills: accounting only (the goods came in as batches above).
    for (const [supplier, lines] of bySupplier) {
      await ctx.recordPurchase(
        day.date,
        supplier,
        lines.map((l) => ({
          description: `${l.item.name} x ${l.qty}`,
          hsn: l.item.hsn ?? "3004",
          qty: l.qty,
          unit: l.item.unit,
          rate: Math.max(1, Math.round(l.item.rate * l.item.entry.cost)),
          gstRate: l.item.gstRate,
        })),
      );
    }
    return true;
  },

  async afterBill(ctx, draft, bills) {
    if (!ctx.features["medicines.prescriptions"]) return;
    const rx = draft.lines.filter((l) => l.item.entry.schedule && RX.has(l.item.entry.schedule));
    if (!rx.length || !draft.customer) return;
    if (!draft.rng.chance(0.97)) return; // a rare missing prescription shows in the register's "missing Rx" filter
    const doctor = draft.rng.pick(DOCTORS);
    const bill = bills[0]!;
    const patient = draft.customer.planned;
    await ctx.kit.medicines.service.createPrescription(ctx.tenant.id, {
      invoiceId: bill.id,
      invoiceNumber: bill.number,
      patientName: patient.name,
      patientAge: draft.rng.int(8, 78),
      patientPhone: patient.phone,
      patientAddress: patient.address,
      doctorName: doctor,
      doctorRegNo: `TN-${draft.rng.int(41000, 88999)}`,
      doctorAddress: `${personName(draft.rng).name}'s Clinic, ${ctx.city ?? "Tamil Nadu"}`,
      rxDate: draft.date,
    });
  },
};
