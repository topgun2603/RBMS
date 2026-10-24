import { randomUUID } from "node:crypto";
import { AppError } from "@srirealtime/core";
import type { createCatalogue } from "@srirealtime/catalogue";
import { and, eq, gt, inArray, isNull, sql, type Db } from "@srirealtime/db";
import { expenseCategories, expenses } from "@srirealtime/expenses";
import {
  billImporter,
  migratePartiesImporter,
  nameKey,
  type BillsPort,
  type CommitResult,
  type ExportColumn,
  type ExportDataset,
  type FilePort,
  type FullExportPort,
  type HistoricalBill,
  type ImportExportRegistry,
  type ImportRecordRef,
  type PartiesPort,
  type PartyTarget,
  type RollbackResult,
  type TallyVoucher,
} from "@srirealtime/importexport";
import { debitNotes, purchasePayments, purchases, stockMovements, suppliers, type createInventory } from "@srirealtime/inventory";
import { billingCustomers, customerReceipts, invoicePayments, invoices, type createInvoices } from "@srirealtime/invoices";
import type { StorageAdapter } from "@srirealtime/uploads";

/**
 * Switching to us (docs/importing.md): the party and historical-bill importers, their undo, and "Export all my data".
 * Historical bills are written straight to the invoices/purchases tables as `imported` documents: no stock movement, no
 * messages, no e-invoice, original number kept with no series (fy/seq null).
 */
type Catalogue = ReturnType<typeof createCatalogue>["service"];
type Invoices = ReturnType<typeof createInvoices>["service"];
type Inventory = ReturnType<typeof createInventory>["service"];

export interface SwitchDeps {
  db: Db;
  catalogue: Catalogue;
  invoices: Invoices;
  inventory: Inventory;
}

const message = (e: unknown) => (e instanceof AppError ? e.message : e instanceof Error ? e.message : String(e));
const phoneKey = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d || null;
};
const rupees = (paise: number | null | undefined) => (paise === null || paise === undefined ? null : Math.round(paise) / 100);
const WALK_IN = /^(cash|cash sale|cash sales|walk[- ]?in.*|counter sale|retail|customer|cash customer|unknown)$/i;

// ================================================================ party index (match existing parties)

interface PartyRec {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
  openingBalance: number;
}

class PartyIndex {
  private readonly byPhone = new Map<string, PartyRec>();
  private readonly byGstin = new Map<string, PartyRec>();
  private readonly byName = new Map<string, PartyRec>();
  add(r: PartyRec) {
    if (phoneKey(r.phone)) this.byPhone.set(phoneKey(r.phone)!, r);
    if (r.gstin) this.byGstin.set(`${r.gstin}|${nameKey(r.name)}`, r);
    this.byName.set(nameKey(r.name), r);
  }
  find(p: { name: string; phone?: string | null; gstin?: string | null }): PartyRec | undefined {
    return this.byName.get(nameKey(p.name)) ?? (p.gstin ? this.byGstin.get(`${p.gstin}|${nameKey(p.name)}`) : undefined) ?? (phoneKey(p.phone) ? this.byPhone.get(phoneKey(p.phone)!) : undefined);
  }
}

async function* pages<T>(fetch: (limit: number, offset: number) => Promise<{ items: T[]; total: number }>, limit = 200): AsyncIterable<T> {
  for (let offset = 0; ; offset += limit) {
    const page = await fetch(limit, offset);
    for (const item of page.items) yield item;
    if (page.items.length < limit || offset + limit >= page.total) return;
  }
}

export function registerSwitching(registry: ImportExportRegistry, d: SwitchDeps) {
  const indexes = new Map<string, Promise<PartyIndex>>();
  const index = (tenantId: string, job: string, kind: "customer" | "supplier"): Promise<PartyIndex> => {
    const key = `${tenantId}:${job}:${kind}`;
    let p = indexes.get(key);
    if (!p) {
      if (indexes.size > 12) indexes.delete(indexes.keys().next().value!);
      p = (async () => {
        const idx = new PartyIndex();
        if (kind === "customer") for await (const c of pages((limit, offset) => d.invoices.listCustomers(tenantId, { limit, offset }))) idx.add(c as PartyRec);
        else for await (const s of pages((limit, offset) => d.inventory.listSuppliers(tenantId, { limit, offset }))) idx.add(s as PartyRec);
        return idx;
      })();
      indexes.set(key, p);
    }
    return p;
  };

  // ---------------------------------------------------------------- parties
  const partiesPort: PartiesPort = {
    async save(tenantId, targets: PartyTarget[], opts): Promise<CommitResult> {
      const result: Required<CommitResult> = { created: 0, updated: 0, errors: [], records: [] };
      for (const t of targets) {
        try {
          const idx = await index(tenantId, opts.jobId, t.kind);
          const found = idx.find({ name: t.data.name, phone: t.data.phone, gstin: t.data.gstin });
          const common = {
            name: t.data.name.trim().slice(0, 120),
            phone: t.data.phone ?? null,
            email: t.data.email ?? null,
            gstin: t.data.gstin ?? null,
            address: t.data.address ?? null,
            stateCode: t.data.stateCode ?? null,
          };
          if (found) {
            // Link to the party that already exists: fill gaps only; set the balance only when it has none yet.
            const patch: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(common)) if (v && !(found as unknown as Record<string, unknown>)[k]) patch[k] = v;
            let balanceSet = false;
            if (t.opening !== 0 && found.openingBalance === 0) {
              patch.openingBalance = t.opening;
              balanceSet = true;
            }
            if (Object.keys(patch).length) {
              if (t.kind === "customer") await d.invoices.updateCustomer(tenantId, found.id, patch);
              else await d.inventory.updateSupplier(tenantId, found.id, patch);
              Object.assign(found, patch);
              result.updated++;
            }
            result.records.push({ entity: "party", key: t.key, id: found.id, action: "linked", meta: { kind: t.kind, ...(balanceSet ? { balanceSet: t.opening } : {}) } });
            continue;
          }
          let created: PartyRec;
          if (t.kind === "customer") {
            created = (await d.invoices.createCustomer(tenantId, {
              ...common,
              ...(t.opening !== 0 ? { openingBalance: t.opening } : {}),
              ...(t.data.creditLimit !== undefined ? { creditLimit: t.data.creditLimit } : {}),
            })) as PartyRec;
          } else {
            created = (await d.inventory.createSupplier(tenantId, {
              ...common,
              ...(t.opening !== 0 ? { openingBalance: t.opening, openingDate: t.data.openingDate ?? null } : {}),
            })) as PartyRec;
          }
          idx.add(created);
          result.created++;
          result.records.push({ entity: "party", key: t.key, id: created.id, action: "created", meta: { kind: t.kind } });
        } catch (e) {
          result.errors.push({ row: t.row, message: `${t.kind === "customer" ? "Customer" : "Supplier"} "${t.data.name}": ${message(e)}` });
        }
      }
      return result;
    },
  };
  registry.registerImporter(migratePartiesImporter(partiesPort));

  // ---------------------------------------------------------------- item lookup for bill lines
  const itemMaps = new Map<string, Promise<Map<string, string>>>();
  const itemMap = (tenantId: string, job: string) => {
    const key = `${tenantId}:${job}`;
    let p = itemMaps.get(key);
    if (!p) {
      if (itemMaps.size > 6) itemMaps.delete(itemMaps.keys().next().value!);
      p = (async () => {
        const m = new Map<string, string>();
        for (const r of await d.catalogue.exportProducts(tenantId, {})) {
          const id = r.variant.id;
          if (r.variant.sku) m.set(`sku:${r.variant.sku.toLowerCase()}`, id);
          if (r.variant.barcode) m.set(`bc:${r.variant.barcode}`, id);
          const n = `name:${nameKey(r.variant.title ? `${r.product.name} ${r.variant.title}` : r.product.name)}`;
          if (!m.has(n)) m.set(n, id);
          if (!m.has(`name:${nameKey(r.product.name)}`)) m.set(`name:${nameKey(r.product.name)}`, id);
        }
        return m;
      })();
      itemMaps.set(key, p);
    }
    return p;
  };
  const itemIdFor = (m: Map<string, string>, l: HistoricalBill["lines"][number]) =>
    (l.sku && m.get(`sku:${l.sku.toLowerCase()}`)) || (l.barcode && m.get(`bc:${l.barcode}`)) || m.get(`name:${nameKey(l.description)}`) || undefined;

  // ---------------------------------------------------------------- bills
  const statusFor = (total: number, paid: number) => (paid >= total ? "paid" : paid > 0 ? "partially_paid" : "issued");

  const billsPort = (kind: "sale" | "purchase"): BillsPort => ({
    async context(tenantId) {
      const seller = await d.invoices.sellerProfile(tenantId);
      return { sellerState: seller.stateCode ?? null };
    },
    async save(tenantId, bills, opts) {
      const seller = await d.invoices.sellerProfile(tenantId);
      const items = await itemMap(tenantId, opts.jobId);
      const out: Awaited<ReturnType<BillsPort["save"]>> = [];
      const carry = opts.options.carryDues === true;
      for (const bill of bills) {
        try {
          const lines = bill.lines.map((l) => {
            const { sku: _s, barcode: _b, ...rest } = l;
            const itemId = itemIdFor(items, l);
            return itemId ? { ...rest, itemId } : rest;
          });
          const totals = {
            subtotal: bill.subtotal,
            discount: bill.discount,
            taxable: bill.taxable,
            cgst: bill.cgst,
            sgst: bill.sgst,
            igst: bill.igst,
            roundOff: bill.roundOff,
            total: bill.total,
            taxBreakup: bill.taxBreakup,
          };
          const unpaid = Math.max(0, bill.total - bill.paid);
          const settle = !carry && unpaid > 0;
          const paidFinal = settle ? bill.total : bill.paid;
          const placeOfSupply = bill.placeOfSupply ?? seller.stateCode ?? "";
          const records: ImportRecordRef[] = [];
          const fy = `${Number(bill.date.slice(5, 7)) >= 4 ? Number(bill.date.slice(0, 4)) : Number(bill.date.slice(0, 4)) - 1}`;
          const fyLabel = `${fy}-${String(Number(fy) + 1).slice(2)}`;
          const key = `${kind}:${fyLabel}|${bill.number.trim().toLowerCase()}`;

          if (kind === "sale") {
            const walkIn = !bill.party || WALK_IN.test(bill.party.name.trim());
            let customerId: string | null = null;
            let snapshot = { name: walkIn ? (bill.party?.name ?? "Walk-in customer") : bill.party!.name, phone: bill.party?.phone ?? null, email: null as string | null, gstin: bill.party?.gstin ?? null, address: null as string | null, stateCode: bill.party?.stateCode ?? null };
            if (!walkIn) {
              const idx = await index(tenantId, opts.jobId, "customer");
              let c = idx.find({ name: bill.party!.name, phone: bill.party!.phone, gstin: bill.party!.gstin });
              if (!c) {
                c = (await d.invoices.createCustomer(tenantId, {
                  name: bill.party!.name.trim().slice(0, 120),
                  phone: bill.party!.phone ?? null,
                  gstin: bill.party!.gstin ?? null,
                  stateCode: bill.party!.stateCode ?? null,
                }).catch(() => d.invoices.createCustomer(tenantId, { name: bill.party!.name.trim().slice(0, 120) }))) as PartyRec;
                idx.add(c);
                records.push({ entity: "party", key: `customer:${nameKey(bill.party!.name)}`, id: c.id, action: "created", meta: { kind: "customer", fromBill: true } });
              }
              customerId = c.id;
              snapshot = { name: c.name, phone: c.phone, email: c.email, gstin: c.gstin ?? bill.party?.gstin ?? null, address: c.address, stateCode: c.stateCode ?? bill.party?.stateCode ?? null };
            }
            const id = await d.db.transaction(async (tx) => {
              const [row] = await tx
                .insert(invoices)
                .values({
                  tenantId,
                  customerId,
                  customer: snapshot,
                  seller,
                  number: bill.number,
                  fy: null,
                  seq: null,
                  status: statusFor(bill.total, paidFinal),
                  date: bill.date,
                  dueDate: bill.dueDate ?? null,
                  placeOfSupply,
                  interState: bill.interState,
                  lines,
                  totals,
                  total: bill.total,
                  paid: paidFinal,
                  notes: bill.notes ?? null,
                  issuedAt: new Date(`${bill.date}T12:00:00+05:30`),
                  imported: true,
                  importBatchId: opts.jobId,
                })
                .returning({ id: invoices.id });
              const pays = [
                ...(bill.paid > 0 ? [{ amount: bill.paid, method: bill.payMode, reference: "IMPORT" }] : []),
                ...(settle ? [{ amount: unpaid, method: "other" as const, reference: "IMPORT-SETTLED" }] : []),
              ];
              if (pays.length) {
                await tx.insert(invoicePayments).values(pays.map((p) => ({ tenantId, invoiceId: row!.id, amount: p.amount, method: p.method, date: bill.date, reference: p.reference, source: "manual" as const, createdBy: opts.userId })));
              }
              return row!.id;
            });
            records.push({ entity: "sale", key, id, action: "created" });
          } else {
            let supplierId: string | null = null;
            let snapshot = { name: bill.party?.name ?? "Unknown supplier", phone: bill.party?.phone ?? null, email: null as string | null, gstin: bill.party?.gstin ?? null, address: null as string | null, stateCode: bill.party?.stateCode ?? null };
            if (bill.party) {
              const idx = await index(tenantId, opts.jobId, "supplier");
              let s = idx.find({ name: bill.party.name, phone: bill.party.phone, gstin: bill.party.gstin });
              if (!s) {
                s = (await d.inventory.createSupplier(tenantId, {
                  name: bill.party.name.trim().slice(0, 120),
                  phone: bill.party.phone ?? null,
                  gstin: bill.party.gstin ?? null,
                  stateCode: bill.party.stateCode ?? null,
                }).catch(() => d.inventory.createSupplier(tenantId, { name: bill.party!.name.trim().slice(0, 120) }))) as PartyRec;
                idx.add(s);
                records.push({ entity: "party", key: `supplier:${nameKey(bill.party.name)}`, id: s.id, action: "created", meta: { kind: "supplier", fromBill: true } });
              }
              supplierId = s.id;
              snapshot = { name: s.name, phone: s.phone, email: s.email, gstin: s.gstin ?? bill.party.gstin ?? null, address: s.address, stateCode: s.stateCode ?? bill.party.stateCode ?? null };
            }
            const id = await d.db.transaction(async (tx) => {
              const [row] = await tx
                .insert(purchases)
                .values({
                  tenantId,
                  supplierId,
                  supplier: snapshot,
                  billNumber: bill.number,
                  date: bill.date,
                  placeOfSupply: seller.stateCode ?? placeOfSupply,
                  interState: bill.interState,
                  lines,
                  totals,
                  total: bill.total,
                  paid: paidFinal >= bill.total,
                  amountPaid: paidFinal,
                  dueDate: bill.dueDate ?? null,
                  status: "recorded",
                  notes: bill.notes ?? null,
                  createdBy: opts.userId,
                  imported: true,
                  importBatchId: opts.jobId,
                })
                .returning({ id: purchases.id });
              const pays = [
                ...(bill.paid > 0 ? [{ amount: bill.paid, mode: bill.payMode, reference: "IMPORT" }] : []),
                ...(settle ? [{ amount: unpaid, mode: "other" as const, reference: "IMPORT-SETTLED" }] : []),
              ];
              for (const p of pays) {
                await tx.insert(purchasePayments).values({
                  tenantId,
                  supplierId,
                  purchaseId: row!.id,
                  groupId: randomUUID(),
                  kind: "payment",
                  amount: p.amount,
                  mode: p.mode,
                  reference: p.reference,
                  date: bill.date,
                  note: "Imported from your old software",
                  createdBy: opts.userId,
                });
              }
              return row!.id;
            });
            records.push({ entity: "purchase", key, id, action: "created" });
          }
          out.push({ number: bill.number, ok: true, records });
        } catch (e) {
          out.push({ number: bill.number, ok: false, error: message(e), records: [] });
        }
      }
      return out;
    },
  });
  registry.registerImporter(billImporter("sale", billsPort("sale")));
  registry.registerImporter(billImporter("purchase", billsPort("purchase")));

  // ---------------------------------------------------------------- undo
  registry.rollbackPort = {
    async rollback(tenantId, records, opts): Promise<RollbackResult> {
      const kept: RollbackResult["kept"] = [];
      let reverted = 0;
      const ofEntity = (e: string) => records.filter((r) => r.entity === e);
      const keep = (r: { entity: string; key: string }, reason: string) => kept.push({ entity: r.entity, key: r.key, reason });

      // Bills first (they hold the parties).
      for (const r of ofEntity("sale")) {
        try {
          const del = await d.db.delete(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, r.id), eq(invoices.imported, true))).returning({ id: invoices.id });
          if (del.length) reverted++;
        } catch {
          keep(r, "Has credit notes or other records that depend on it");
        }
      }
      for (const r of ofEntity("purchase")) {
        try {
          const [dn] = await d.db.select({ id: debitNotes.id }).from(debitNotes).where(and(eq(debitNotes.tenantId, tenantId), eq(debitNotes.purchaseId, r.id))).limit(1);
          if (dn) {
            keep(r, "Has a debit note");
            continue;
          }
          await d.db.transaction(async (tx) => {
            await tx.delete(purchasePayments).where(and(eq(purchasePayments.tenantId, tenantId), eq(purchasePayments.purchaseId, r.id)));
            await tx.delete(purchases).where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, r.id), eq(purchases.imported, true)));
          });
          reverted++;
        } catch {
          keep(r, "Could not be removed");
        }
      }
      // Parties.
      for (const r of ofEntity("party")) {
        const kind = (r.meta?.kind as string | undefined) ?? r.key.split(":")[0];
        try {
          if (r.action === "linked") {
            // Put back the opening balance we set on an existing party.
            const set = r.meta?.balanceSet as number | undefined;
            if (set !== undefined) {
              if (kind === "customer") await d.invoices.updateCustomer(tenantId, r.id, { openingBalance: 0 });
              else await d.inventory.updateSupplier(tenantId, r.id, { openingBalance: 0 });
              reverted++;
            }
            continue;
          }
          if (kind === "customer") {
            const [used] = await d.db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, r.id))).limit(1);
            const [rec] = await d.db.select({ id: customerReceipts.id }).from(customerReceipts).where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.customerId, r.id))).limit(1);
            if (used || rec) {
              keep(r, "Customer has other bills or receipts now");
              continue;
            }
            await d.db.update(billingCustomers).set({ deletedAt: new Date() }).where(and(eq(billingCustomers.tenantId, tenantId), eq(billingCustomers.id, r.id), isNull(billingCustomers.deletedAt)));
          } else {
            const [used] = await d.db.select({ id: purchases.id }).from(purchases).where(and(eq(purchases.tenantId, tenantId), eq(purchases.supplierId, r.id))).limit(1);
            const [pay] = await d.db.select({ id: purchasePayments.id }).from(purchasePayments).where(and(eq(purchasePayments.tenantId, tenantId), eq(purchasePayments.supplierId, r.id))).limit(1);
            if (used || pay) {
              keep(r, "Supplier has other bills or payments now");
              continue;
            }
            await d.db.update(suppliers).set({ deletedAt: new Date() }).where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, r.id), isNull(suppliers.deletedAt)));
          }
          reverted++;
        } catch (e) {
          keep(r, message(e));
        }
      }
      // Products created by the item importer.
      for (const r of ofEntity("product")) {
        const variantIds = (r.meta?.variantIds as string[] | undefined) ?? [];
        try {
          if (variantIds.length) {
            const [moved] = await d.db
              .select({ id: stockMovements.id })
              .from(stockMovements)
              .where(and(eq(stockMovements.tenantId, tenantId), inArray(stockMovements.itemId, variantIds), sql`${stockMovements.reason} not in ('opening','adjustment')`))
              .limit(1);
            if (moved) {
              keep(r, "Product has been sold or purchased since");
              continue;
            }
            for (const v of variantIds) await d.inventory.adjust(tenantId, v, { mode: "set", qty: 0, note: "Import rolled back" }, opts.userId).catch(() => undefined);
          }
          await d.catalogue.deleteProduct(tenantId, r.id);
          reverted++;
        } catch (e) {
          keep(r, message(e));
        }
      }
      return { reverted, kept };
    },
  };
}

// ================================================================ export all my data

type Row = Record<string, unknown>;

/** Pages through a table ordered by id (keyset), 1000 rows at a time. */
async function* keyset<T extends { id: string }>(fetch: (after: string | null) => Promise<T[]>): AsyncGenerator<T> {
  let after: string | null = null;
  for (;;) {
    const rows = await fetch(after);
    for (const r of rows) yield r;
    if (rows.length < 1000) return;
    after = rows[rows.length - 1]!.id;
  }
}

const col = (key: string, label: string, value?: (r: Row) => string | number | boolean | Date | null | undefined, width?: number): ExportColumn<Row> => ({ key, label, value, width });
const money = (key: string, label: string): ExportColumn<Row> => ({ key, label, value: (r) => rupees(r[key] as number | null) });

export function fullExportPort(d: SwitchDeps & { company?: (tenantId: string) => Promise<string | null> }): FullExportPort {
  return {
    company: async (tenantId) => (d.company ? d.company(tenantId) : ((await d.invoices.sellerProfile(tenantId)).legalName ?? null)),

    async datasets(tenantId): Promise<ExportDataset[]> {
      const db = d.db;
      const list: ExportDataset[] = [];

      // Items with stock.
      list.push({
        key: "items",
        label: "Items",
        columns: [
          col("name", "Name"), col("variant", "Variant"), col("sku", "SKU"), col("barcode", "Barcode"), col("category", "Category"), col("brand", "Brand"),
          col("hsn", "HSN"), col("gst", "GST %"), col("unit", "Unit"), money("price", "Price"), money("mrp", "MRP"), money("cost", "Cost"),
          col("taxInclusive", "Tax inclusive", (r) => (r.taxInclusive ? "yes" : "no")), col("stock", "Stock"), col("status", "Status"),
        ],
        rows: (async function* () {
          const stock = new Map((await d.inventory.listStock(tenantId, {})).items.map((s) => [s.itemId, s]));
          for (const r of await d.catalogue.exportProducts(tenantId, {})) {
            const s = stock.get(r.variant.id);
            yield {
              name: r.product.name, variant: r.variant.title, sku: r.variant.sku, barcode: r.variant.barcode, category: r.categoryName, brand: r.product.brand,
              hsn: r.product.hsn, gst: r.product.gstRate, unit: r.product.unit, price: r.variant.price, mrp: r.variant.mrp, cost: r.variant.cost,
              taxInclusive: r.product.taxInclusive, stock: s && s.track ? s.qty : null, status: r.product.status,
            };
          }
        })(),
      });

      // Parties.
      const partyCols = (extra: ExportColumn<Row>[]) => [col("name", "Name"), col("phone", "Phone"), col("email", "Email"), col("gstin", "GSTIN"), col("address", "Address"), col("state", "State code"), money("openingBalance", "Opening balance"), ...extra];
      list.push({
        key: "customers",
        label: "Customers",
        columns: partyCols([money("creditLimit", "Credit limit"), money("outstanding", "Balance now")]),
        rows: (async function* () {
          for await (const c of pages((limit, offset) => d.invoices.listCustomers(tenantId, { limit, offset }))) {
            yield { name: c.name, phone: c.phone, email: c.email, gstin: c.gstin, address: c.address, state: c.stateCode, openingBalance: c.openingBalance, creditLimit: c.creditLimit, outstanding: c.outstanding };
          }
        })(),
      });
      list.push({
        key: "suppliers",
        label: "Suppliers",
        columns: partyCols([col("openingDate", "Balance as of"), money("payable", "Payable now")]),
        rows: (async function* () {
          for await (const s of pages((limit, offset) => d.inventory.listSuppliers(tenantId, { limit, offset }))) {
            yield { name: s.name, phone: s.phone, email: s.email, gstin: s.gstin, address: s.address, state: s.stateCode, openingBalance: s.openingBalance, openingDate: s.openingDate, payable: s.payable };
          }
        })(),
      });

      // Sales bills and their lines / payments.
      const billCols = [
        col("number", "Invoice no"), col("date", "Date"), col("dueDate", "Due date"), col("status", "Status"), col("customer", "Customer"), col("gstin", "Customer GSTIN"),
        col("placeOfSupply", "Place of supply"), money("taxable", "Taxable"), money("cgst", "CGST"), money("sgst", "SGST"), money("igst", "IGST"), money("roundOff", "Round off"),
        money("total", "Total"), money("paid", "Paid"), money("credited", "Credited"), col("imported", "Imported", (r) => (r.imported ? "yes" : "no")), col("notes", "Notes"),
      ];
      list.push({
        key: "invoices",
        label: "Sales invoices",
        columns: billCols,
        rows: (async function* () {
          for await (const r of keyset((after) =>
            db.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), after ? gt(invoices.id, after) : undefined)).orderBy(invoices.id).limit(1000),
          )) {
            const t = r.totals as unknown as Record<string, number>;
            yield { number: r.number, date: r.date, dueDate: r.dueDate, status: r.status, customer: r.customer.name, gstin: r.customer.gstin, placeOfSupply: r.placeOfSupply, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff, total: r.total, paid: r.paid, credited: r.credited, imported: r.imported, notes: r.notes };
          }
        })(),
      });
      const lineCols = (numberLabel: string) => [
        col("number", numberLabel), col("date", "Date"), col("party", "Party"), col("line", "Line"), col("description", "Item"), col("hsn", "HSN"), col("qty", "Qty"), col("unit", "Unit"),
        money("rate", "Rate"), money("discount", "Discount"), money("taxable", "Taxable"), col("gstRate", "GST %"), money("cgst", "CGST"), money("sgst", "SGST"), money("igst", "IGST"), money("total", "Line total"),
      ];
      const flat = (number: string | null, date: string, party: string, lines: unknown): Row[] =>
        ((lines as Row[]) ?? []).map((l, i) => ({ number, date, party, line: i + 1, description: l.description, hsn: l.hsn ?? null, qty: l.qty, unit: l.unit ?? null, rate: l.rate, discount: l.discount ?? 0, taxable: l.taxable, gstRate: l.gstRate, cgst: l.cgst, sgst: l.sgst, igst: l.igst, total: l.total }));
      list.push({
        key: "invoice-lines",
        label: "Sales invoice lines",
        columns: lineCols("Invoice no"),
        rows: (async function* () {
          for await (const r of keyset((after) =>
            db.select({ id: invoices.id, number: invoices.number, date: invoices.date, customer: invoices.customer, lines: invoices.lines }).from(invoices).where(and(eq(invoices.tenantId, tenantId), after ? gt(invoices.id, after) : undefined)).orderBy(invoices.id).limit(500),
          )) yield* flat(r.number, r.date, r.customer.name, r.lines);
        })(),
      });
      list.push({
        key: "payments-received",
        label: "Payments received",
        columns: [col("number", "Invoice no"), col("date", "Date"), money("amount", "Amount"), col("method", "Method"), col("reference", "Reference"), col("source", "Source")],
        rows: (async function* () {
          for await (const r of keyset((after) =>
            db.select({ id: invoicePayments.id, number: invoices.number, date: invoicePayments.date, amount: invoicePayments.amount, method: invoicePayments.method, reference: invoicePayments.reference, source: invoicePayments.source })
              .from(invoicePayments).innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
              .where(and(eq(invoicePayments.tenantId, tenantId), after ? gt(invoicePayments.id, after) : undefined)).orderBy(invoicePayments.id).limit(1000),
          )) yield r;
        })(),
      });
      list.push({
        key: "customer-receipts",
        label: "Customer receipts (on account)",
        columns: [col("date", "Date"), col("customer", "Customer"), money("amount", "Amount"), col("method", "Method"), col("reference", "Reference"), money("advance", "Advance left"), col("note", "Note")],
        rows: (async function* () {
          for await (const r of keyset((after) =>
            db.select({ id: customerReceipts.id, date: customerReceipts.date, customer: billingCustomers.name, amount: customerReceipts.amount, method: customerReceipts.method, reference: customerReceipts.reference, advance: customerReceipts.advance, note: customerReceipts.note })
              .from(customerReceipts).innerJoin(billingCustomers, eq(billingCustomers.id, customerReceipts.customerId))
              .where(and(eq(customerReceipts.tenantId, tenantId), after ? gt(customerReceipts.id, after) : undefined)).orderBy(customerReceipts.id).limit(1000),
          )) yield r;
        })(),
      });

      // Purchases.
      list.push({
        key: "purchases",
        label: "Purchase bills",
        columns: [
          col("number", "Bill no"), col("date", "Date"), col("dueDate", "Due date"), col("supplier", "Supplier"), col("gstin", "Supplier GSTIN"), money("taxable", "Taxable"), money("cgst", "CGST"), money("sgst", "SGST"), money("igst", "IGST"),
          money("freight", "Freight"), money("total", "Total"), money("amountPaid", "Paid"), money("returnedAmount", "Returned"), col("status", "Status"), col("imported", "Imported", (r) => (r.imported ? "yes" : "no")),
        ],
        rows: (async function* () {
          for await (const r of keyset((after) =>
            db.select().from(purchases).where(and(eq(purchases.tenantId, tenantId), after ? gt(purchases.id, after) : undefined)).orderBy(purchases.id).limit(1000),
          )) {
            const t = r.totals as unknown as Record<string, number>;
            yield { number: r.billNumber, date: r.date, dueDate: r.dueDate, supplier: r.supplier.name, gstin: r.supplier.gstin, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, freight: r.freight, total: r.total, amountPaid: r.amountPaid, returnedAmount: r.returnedAmount, status: r.status, imported: r.imported };
          }
        })(),
      });
      list.push({
        key: "purchase-lines",
        label: "Purchase bill lines",
        columns: lineCols("Bill no"),
        rows: (async function* () {
          for await (const r of keyset((after) =>
            db.select({ id: purchases.id, number: purchases.billNumber, date: purchases.date, supplier: purchases.supplier, lines: purchases.lines }).from(purchases).where(and(eq(purchases.tenantId, tenantId), after ? gt(purchases.id, after) : undefined)).orderBy(purchases.id).limit(500),
          )) yield* flat(r.number, r.date, r.supplier.name, r.lines);
        })(),
      });
      list.push({
        key: "payments-made",
        label: "Payments to suppliers",
        columns: [col("date", "Date"), col("supplier", "Supplier"), col("number", "Bill no"), col("kind", "Kind"), money("amount", "Amount"), col("mode", "Mode"), col("reference", "Reference"), col("reversed", "Reversed", (r) => (r.reversed ? "yes" : "no")), col("note", "Note")],
        rows: (async function* () {
          for await (const r of keyset((after) =>
            db.select({ id: purchasePayments.id, date: purchasePayments.date, supplier: suppliers.name, number: purchases.billNumber, kind: purchasePayments.kind, amount: purchasePayments.amount, mode: purchasePayments.mode, reference: purchasePayments.reference, reversedAt: purchasePayments.reversedAt, note: purchasePayments.note })
              .from(purchasePayments).leftJoin(suppliers, eq(suppliers.id, purchasePayments.supplierId)).leftJoin(purchases, eq(purchases.id, purchasePayments.purchaseId))
              .where(and(eq(purchasePayments.tenantId, tenantId), after ? gt(purchasePayments.id, after) : undefined)).orderBy(purchasePayments.id).limit(1000),
          )) yield { ...r, reversed: r.reversedAt !== null };
        })(),
      });

      // Expenses.
      list.push({
        key: "expenses",
        label: "Expenses",
        columns: [col("date", "Date"), col("category", "Category"), money("amount", "Amount"), col("gstRate", "GST %"), money("gstAmount", "GST amount"), col("vendorName", "Vendor"), col("vendorGstin", "Vendor GSTIN"), col("paymentMethod", "Method"), col("reference", "Reference"), col("note", "Note"), col("status", "Status")],
        rows: (async function* () {
          for await (const r of keyset((after) =>
            db.select({ id: expenses.id, date: expenses.date, category: expenseCategories.name, amount: expenses.amount, gstRate: expenses.gstRate, gstAmount: expenses.gstAmount, vendorName: expenses.vendorName, vendorGstin: expenses.vendorGstin, paymentMethod: expenses.paymentMethod, reference: expenses.reference, note: expenses.note, status: expenses.status })
              .from(expenses).leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
              .where(and(eq(expenses.tenantId, tenantId), after ? gt(expenses.id, after) : undefined)).orderBy(expenses.id).limit(1000),
          )) yield r;
        })(),
      });

      // Stock movements.
      list.push({
        key: "stock-movements",
        label: "Stock movements",
        columns: [col("at", "Date and time", (r) => (r.at as Date).toISOString()), col("item", "Item id"), col("reason", "Reason"), col("delta", "Change"), col("qtyAfter", "Qty after"), col("refType", "Reference type"), col("refNumber", "Reference no"), money("unitCost", "Unit cost"), col("note", "Note")],
        rows: (async function* () {
          for await (const r of keyset((after) =>
            db.select().from(stockMovements).where(and(eq(stockMovements.tenantId, tenantId), after ? gt(stockMovements.id, after) : undefined)).orderBy(stockMovements.id).limit(1000),
          )) yield { at: r.createdAt, item: r.itemId, reason: r.reason, delta: r.delta, qtyAfter: r.qtyAfter, refType: r.refType, refNumber: r.refNumber, unitCost: r.unitCost, note: r.note };
        })(),
      });
      return list;
    },

    async *vouchers(tenantId, q): AsyncGenerator<TallyVoucher> {
      const db = d.db;
      const rate2 = (p: number) => Math.round(p) / 100;
      const toLines = (lines: unknown) =>
        ((lines as Row[]) ?? []).map((l) => ({
          name: String(l.description ?? "Item"),
          qty: Number(l.qty ?? 1),
          unit: String(l.unit ?? "Nos"),
          rate: Number(l.qty) > 0 ? Math.round((Number(l.taxable) / Number(l.qty)) * 1) / 100 : rate2(Number(l.taxable)),
          amount: rate2(Number(l.taxable)),
          hsn: l.hsn ? String(l.hsn) : undefined,
          gstRate: Number(l.gstRate ?? 0),
        }));
      if (q.kind === "sale") {
        for await (const r of keyset((after) =>
          db.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), sql`${invoices.status} in ('issued','partially_paid','paid')`, sql`${invoices.date} >= ${q.from}`, sql`${invoices.date} <= ${q.to}`, after ? gt(invoices.id, after) : undefined)).orderBy(invoices.id).limit(500),
        )) {
          const t = r.totals as unknown as Record<string, number>;
          yield { kind: "sale", number: r.number ?? r.id.slice(0, 8), date: r.date, party: r.customer.name || "Cash", partyGstin: r.customer.gstin, placeOfSupply: r.placeOfSupply, lines: toLines(r.lines), cgst: rate2(t.cgst ?? 0), sgst: rate2(t.sgst ?? 0), igst: rate2(t.igst ?? 0), roundOff: rate2(t.roundOff ?? 0), total: rate2(r.total), narration: r.notes };
        }
      } else {
        for await (const r of keyset((after) =>
          db.select().from(purchases).where(and(eq(purchases.tenantId, tenantId), eq(purchases.status, "recorded"), sql`${purchases.date} >= ${q.from}`, sql`${purchases.date} <= ${q.to}`, after ? gt(purchases.id, after) : undefined)).orderBy(purchases.id).limit(500),
        )) {
          const t = r.totals as unknown as Record<string, number>;
          yield { kind: "purchase", number: r.billNumber, date: r.date, party: r.supplier.name, partyGstin: r.supplier.gstin, placeOfSupply: r.placeOfSupply, lines: toLines(r.lines), cgst: rate2(t.cgst ?? 0), sgst: rate2(t.sgst ?? 0), igst: rate2(t.igst ?? 0), roundOff: rate2(t.roundOff ?? 0), total: rate2(r.total), narration: r.notes };
        }
      }
    },
  };
}

/** Object storage for the export zips, over the uploads storage adapter. */
export function exportFiles(storage: StorageAdapter): FilePort {
  return {
    put: (key, body, contentType) => storage.put(key, body, contentType),
    get: (key) => storage.get(key),
    url: (key, opts) => storage.presignGet(key, { expiresIn: opts.expiresIn, downloadName: opts.downloadName }),
    delete: (key) => storage.delete(key),
  };
}
