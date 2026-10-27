import { AppError } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import type { createCatalogue, Product } from "@srirealtime/catalogue";
import type {
  BrandingPort,
  CreditNoteDocPort,
  DebitNoteDocPort,
  DocSeller,
  InvoiceDocPort,
  OrderDocPort,
  PurchaseDocPort,
  StatementDocPort,
  TillDocPort,
} from "@srirealtime/documents";
import {
  formatUnitsCell,
  customersExporter,
  customersImporter,
  productsExporter,
  productsImporter,
  stockExporter,
  stockImporter,
  suppliersExporter,
  suppliersImporter,
  type CommitResult,
  type CommitRow,
  type CustomerImportRow,
  type ImportExportRegistry,
  type PartyExportRow,
  type PartyImportRow,
  type ProductExportRow,
  type ProductImportRow,
  type SupplierImportRow,
  type StockExportRow,
  type StockImportRow,
} from "@srirealtime/importexport";
import type { createInventory, StockLocation } from "@srirealtime/inventory";
import type { MedicinesService } from "@srirealtime/medicines";
import type { createInvoices, Customer } from "@srirealtime/invoices";
import type { createOrders } from "@srirealtime/orders";
import { registerSwitching } from "./kit-switch";

/**
 * Ports of the documents and import/export modules, implemented over the catalogue, invoices, inventory and orders
 * services. Kept out of kit.ts so the composition root stays readable.
 */
type Catalogue = ReturnType<typeof createCatalogue>["service"];
type Invoices = ReturnType<typeof createInvoices>["service"];
type Inventory = ReturnType<typeof createInventory>["service"];
type Orders = ReturnType<typeof createOrders>["service"];

const is404 = (e: unknown) => e instanceof AppError && e.status === 404;
const nullOn404 = (e: unknown): null => {
  if (is404(e)) return null;
  throw e;
};
const message = (e: unknown) => (e instanceof AppError ? e.message : e instanceof Error ? e.message : String(e));
/** Last 10 digits: "+91 98765 43210" and "9876543210" are the same customer. */
const phoneKey = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d || null;
};
const nameKey = (n: string | null | undefined) => (n ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Pages through a `{ items, total }` list (limit ≤ 200). */
async function* pages<T>(fetch: (limit: number, offset: number) => Promise<{ items: T[]; total: number }>, limit = 200): AsyncIterable<T> {
  for (let offset = 0; ; offset += limit) {
    const page = await fetch(limit, offset);
    for (const item of page.items) yield item;
    if (page.items.length < limit || offset + limit >= page.total) return;
  }
}
async function all<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

// ================================================================ documents

export interface DocumentPortDeps {
  invoices: Invoices;
  orders: Orders;
  inventory: Inventory;
  catalogue: Catalogue;
  seller: (tenantId: string) => Promise<DocSeller>;
  isEnabled: (tenantId: string, feature: string) => Promise<boolean>;
  branding: BrandingPort["get"];
  /** IRN, Ack no/date and signed QR of an e-invoiced bill (null when none or e-invoicing is off). */
  einvoice?: (tenantId: string, invoiceId: string) => Promise<EInvoiceDocInfo | null>;
  /** POS till sessions (Z report). */
  till?: Invoices["till"];
  /** Branch name for the Z report. */
  branchName?: (tenantId: string, branchId: string) => Promise<string | null>;
}

export interface EInvoiceDocInfo {
  irn: string;
  ackNo: string | null;
  ackDate: string | Date | null;
  signedQrCode: string | null;
  ewbNo?: string | null;
  ewbValidTill?: string | Date | null;
  mock: boolean;
}

export function documentPorts(d: DocumentPortDeps) {
  /** Adds the e-invoice block (IRN) to a bill; a failing lookup never blocks the PDF. */
  const withIrn = async <T extends { id?: string }>(tenantId: string, inv: T | null): Promise<T | null> => {
    if (!inv?.id || !d.einvoice) return inv;
    const einvoice = await d.einvoice(tenantId, inv.id).catch(() => null);
    return einvoice ? { ...inv, einvoice } : inv;
  };
  const invoices: InvoiceDocPort = {
    invoice: async (tenantId, id) => withIrn(tenantId, await d.invoices.get(tenantId, id).catch(nullOn404)),
    publicInvoice: async (token) => {
      // paymentTarget resolves the shop behind the share token (getPublic doesn't expose it).
      const target = await d.invoices.paymentTarget(token).catch(nullOn404);
      if (!target || !(await d.isEnabled(target.tenantId, "invoices"))) return null;
      const found = await d.invoices.getPublic(token, target.tenantId).catch(nullOn404);
      // branding null → the documents module asks the branding port (which carries the primary colour).
      return found ? { tenantId: target.tenantId, invoice: (await withIrn(target.tenantId, found.invoice))!, branding: null } : null;
    },
  };

  const statements: StatementDocPort = {
    statement: async (tenantId, customerId, range) => {
      const ledger = await d.invoices.ledger(tenantId, customerId, range).catch(nullOn404);
      if (!ledger) return null;
      const { customer, ...rest } = ledger;
      return {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          gstin: customer.gstin,
          address: customer.address,
          stateCode: customer.stateCode,
        },
        seller: await d.seller(tenantId),
        ledger: rest,
        from: range.from ?? null,
        to: range.to ?? null,
      };
    },
  };

  const orders: OrderDocPort = {
    order: async (tenantId, id) => {
      const o = await d.orders.get(tenantId, id).catch(nullOn404);
      if (!o) return null;
      // Parcel weight when every line's variant has one.
      const variants = await d.catalogue.getVariants(tenantId, o.lines.map((l) => l.variantId));
      const weightOf = new Map(variants.map((v) => [v.id, v.weightGrams]));
      const weights = o.lines.map((l) => (weightOf.get(l.variantId) ?? null) === null ? null : weightOf.get(l.variantId)! * l.qty);
      const weightGrams = weights.length > 0 && weights.every((w) => w !== null) ? Math.round(weights.reduce((a, b) => a! + b!, 0)!) : null;
      return {
        id: o.id,
        number: o.number,
        placedAt: o.placedAt,
        customer: { name: o.customer.name, phone: o.customer.phone, email: o.customer.email },
        shippingAddress: o.shippingAddress,
        lines: o.lines.map((l) => ({ name: l.name, sku: l.sku, qty: l.qty, unit: l.unit, price: l.price, total: l.total })),
        total: o.total,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        fulfillment: o.fulfillment,
        customerNote: o.customerNote,
        notes: o.notes,
        seller: await d.seller(tenantId),
        weightGrams,
        updatedAt: o.updatedAt,
      };
    },
  };

  const creditNotes: CreditNoteDocPort = {
    // The IRN of a credit note is stored under the note's id (document type CRN).
    creditNote: async (tenantId, id) => withIrn(tenantId, await d.invoices.creditNotes.get(tenantId, id).catch(nullOn404)),
  };

  const debitNotes: DebitNoteDocPort = {
    // A debit note to a customer (docs/expenses-debit-notes.md); its IRN (document type DBN) is stored under its id.
    debitNote: async (tenantId, id) => withIrn(tenantId, await d.invoices.debitNotes.get(tenantId, id).catch(nullOn404)),
  };

  const till: TillDocPort | undefined = d.till
    ? {
        session: async (tenantId, id) => {
          const r = await d.till!.report(tenantId, id).catch(nullOn404);
          if (!r) return null;
          const s = r.session;
          return {
            ...s,
            branchName: s.branchId && d.branchName ? await d.branchName(tenantId, s.branchId).catch(() => null) : null,
            report: r.report,
            seller: await d.seller(tenantId),
            updatedAt: s.closedAt ?? null,
          };
        },
      }
    : undefined;

  const purchases: PurchaseDocPort = {
    purchase: async (tenantId, id) => {
      const p = await d.inventory.getPurchase(tenantId, id).catch(nullOn404);
      return p ? { ...p, shop: await d.seller(tenantId) } : null;
    },
  };

  return { invoices, statements, orders, purchases, creditNotes, debitNotes, till, branding: { get: d.branding } satisfies BrandingPort };
}

// ================================================================ import / export

export interface ImportExportPortDeps {
  catalogue: Catalogue;
  invoices: Invoices;
  inventory: Inventory;
  /** Pharmacies keep batches in the medicines module: batch rows of an import go there when the shop uses it. */
  medicines?: () => { service: MedicinesService } | undefined;
  isEnabled?: (tenantId: string, key: string) => Promise<boolean>;
  /** Needed for the switching importers (historical bills, undo); see kit-switch.ts. */
  db?: Db;
}

/** Registers the four importers and exporters (packages/importexport/src/specs.ts) with ports over the services. */
export function registerImportExport(registry: ImportExportRegistry, d: ImportExportPortDeps) {
  registry.registerImporter(productsImporter({ upsert: (tenantId, rows, opts) => importProducts(d, tenantId, rows, opts.userId) }));
  registry.registerImporter(customersImporter({ upsert: (tenantId, rows) => importCustomers(d, tenantId, rows) }));
  registry.registerImporter(suppliersImporter({ upsert: (tenantId, rows) => importSuppliers(d, tenantId, rows) }));
  registry.registerImporter(stockImporter({ upsert: (tenantId, rows, opts) => importStock(d, tenantId, rows, opts.userId) }));

  if (d.db) registerSwitching(registry, { db: d.db, catalogue: d.catalogue, invoices: d.invoices, inventory: d.inventory });

  registry.registerExporter(productsExporter({ rows: (tenantId) => exportProducts(d, tenantId) }));
  registry.registerExporter(customersExporter({ rows: (tenantId) => exportCustomers(d, tenantId) }));
  registry.registerExporter(suppliersExporter({ rows: (tenantId) => exportSuppliers(d, tenantId) }));
  registry.registerExporter(stockExporter({ rows: (tenantId) => exportStock(d, tenantId) }));
}

/** Option name used for the free-text "Variant" column ("M / Red" → { Variant: "M / Red" }). */
const VARIANT_OPTION = "Variant";

/**
 * Rows with the same name are one product. An existing product (same name) gets its variants updated (matched by
 * SKU, barcode or variant title) or added; a new product is created with all its rows as variants. Categories are
 * matched by name (case-insensitive) and created when missing. Opening stock sets the stock at the default location.
 */
async function importProducts(d: ImportExportPortDeps, tenantId: string, rows: CommitRow<ProductImportRow>[], userId: string | null): Promise<CommitResult> {
  const result: Required<CommitResult> = { created: 0, updated: 0, errors: [], records: [] };
  const categories = new Map((await d.catalogue.listCategories(tenantId)).items.map((c) => [nameKey(c.name), c.id]));
  const categoryId = async (name: string | undefined) => {
    if (!name) return undefined;
    const key = nameKey(name);
    let id = categories.get(key);
    if (!id) {
      id = (await d.catalogue.createCategory(tenantId, { name: name.trim() })).id;
      categories.set(key, id);
    }
    return id;
  };

  const groups = new Map<string, CommitRow<ProductImportRow>[]>();
  for (const r of rows) {
    const key = nameKey(r.data.name);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const stockFor: { row: number; variantId: string; name: string; qty?: number; cost?: number; note?: string; batches: ImportBatch[] }[] = [];
  // Alternate units of the rows that filled the Units column (docs/price-lists-units.md), set once the variants exist.
  const unitsFor: { row: number; variantId: string; units: NonNullable<ProductImportRow["units"]> }[] = [];
  const stockNote = (r: ProductImportRow) => `Opening stock (import)${r.batchNo ? `, batch ${r.batchNo}` : ""}${r.expiry ? `, expiry ${r.expiry}` : ""}`;
  // Rows of one item (same name and variant) that differ by batch number are the batches of that item, not variants.
  const batchesOf = new Map<CommitRow<ProductImportRow>, ImportBatch[]>();
  const batchEntry = (r: CommitRow<ProductImportRow>): ImportBatch[] =>
    r.data.batchNo ? [{ row: r.row, batchNo: r.data.batchNo, expiry: r.data.expiry, mfgDate: r.data.mfgDate, qty: r.data.openingStock, cost: r.data.cost, mrp: r.data.mrp }] : [];
  for (const [key, group] of groups) {
    const primary = new Map<string, CommitRow<ProductImportRow>>();
    const kept: CommitRow<ProductImportRow>[] = [];
    for (const r of group) {
      const vk = nameKey(r.data.variant ?? "");
      const first = primary.get(vk);
      if (first && (r.data.batchNo || first.data.batchNo)) {
        batchesOf.set(first, [...(batchesOf.get(first) ?? []), ...batchEntry(r)]);
        continue;
      }
      primary.set(vk, r);
      kept.push(r);
      batchesOf.set(r, batchEntry(r));
    }
    groups.set(key, kept);
  }
  for (const group of groups.values()) {
    const first = group[0]!.data;
    try {
      const existing = await findProductByName(d.catalogue, tenantId, first.name);
      const variantInput = (r: ProductImportRow) => ({
        sku: r.sku ?? null,
        barcode: r.barcode ?? null,
        price: r.price,
        mrp: r.mrp ?? null,
        cost: r.cost ?? null,
        ...(r.variant ? { optionValues: { [VARIANT_OPTION]: r.variant }, title: r.variant } : {}),
      });
      if (!existing) {
        const simple = group.length === 1 && !first.variant;
        const product = await d.catalogue.createProduct(tenantId, {
          name: first.name.trim(),
          description: first.description ?? null,
          brand: first.brand ?? null,
          categoryId: (await categoryId(first.category)) ?? null,
          hsn: first.hsn ?? null,
          gstRate: first.gst,
          unit: first.unit,
          taxInclusive: first.taxInclusive,
          status: first.status ?? "active",
          tags: first.tags ?? [],
          ...(simple ? { ...variantInput(first), optionValues: undefined } : { variants: group.map((r) => variantInput(r.data)) }),
        });
        result.created += group.length;
        result.records.push({ entity: "product", key: `product:${nameKey(first.name)}`, id: product.id, action: "created", meta: { variantIds: product.variants.map((x) => x.id) } });
        group.forEach((r, i) => {
          const v = simple ? product.variants[0] : product.variants.find((x) => x.title === (r.data.variant ?? "")) ?? product.variants[i];
          if (v && r.data.units) unitsFor.push({ row: r.row, variantId: v.id, units: r.data.units });
          if (v && (r.data.openingStock !== undefined || (batchesOf.get(r)?.length ?? 0) > 0)) stockFor.push({ row: r.row, variantId: v.id, name: first.name, qty: r.data.openingStock, cost: r.data.cost, note: stockNote(r.data), batches: batchesOf.get(r) ?? [] });
        });
        continue;
      }
      for (const r of group) {
        try {
          const match = existing.variants.find(
            (v) =>
              (r.data.sku && v.sku?.toLowerCase() === r.data.sku.toLowerCase()) ||
              (r.data.barcode && v.barcode === r.data.barcode) ||
              v.title === (r.data.variant ?? ""),
          );
          const input = variantInput(r.data);
          const v = match ? await d.catalogue.updateVariant(tenantId, match.id, input) : await d.catalogue.addVariant(tenantId, existing.id, input);
          if (match) result.updated++;
          else result.created++;
          if (r.data.units) unitsFor.push({ row: r.row, variantId: v.id, units: r.data.units });
          if (r.data.openingStock !== undefined || (batchesOf.get(r)?.length ?? 0) > 0) stockFor.push({ row: r.row, variantId: v.id, name: first.name, qty: r.data.openingStock, cost: r.data.cost, note: stockNote(r.data), batches: batchesOf.get(r) ?? [] });
        } catch (e) {
          result.errors.push({ row: r.row, message: message(e) });
        }
      }
    } catch (e) {
      for (const r of group) result.errors.push({ row: r.row, message: message(e) });
    }
  }

  for (const u of unitsFor) {
    try {
      await d.catalogue.units.set(tenantId, u.variantId, { units: u.units.map((x) => ({ unit: x.unit, factor: x.factor, price: x.price ?? null, barcode: x.barcode ?? null })) });
    } catch (e) {
      result.errors.push({ row: u.row, message: `Product saved, but its units failed: ${message(e)}` });
    }
  }

  for (const s of stockFor) {
    try {
      if (s.batches.length > 0) {
        await importBatches(d, tenantId, s.variantId, s.name, s.batches, userId);
        continue;
      }
      if (s.qty === undefined) continue;
      await d.inventory.adjust(tenantId, s.variantId, { mode: "set", qty: s.qty, unitCost: s.cost ?? null, note: s.note ?? "Opening stock (import)" }, userId);
    } catch (e) {
      result.errors.push({ row: s.row, message: `Product saved, but opening stock failed: ${message(e)}` });
    }
  }
  return result;
}

interface ImportBatch {
  row: number;
  batchNo: string;
  expiry?: string;
  mfgDate?: string;
  qty?: number;
  cost?: number;
  mrp?: number;
}

/**
 * Batch rows from the old software become real batches with their opening stock. Pharmacies (the medicines module is on
 * and the batch has an expiry) get medicine batches, as in Pharmacy; everything else gets the generic batches of
 * Stock > Batches and the item is switched to batch tracking. Re-importing sets the batch quantity instead of adding.
 */
async function importBatches(d: ImportExportPortDeps, tenantId: string, itemId: string, name: string, batches: ImportBatch[], userId: string | null) {
  const meds = d.medicines?.();
  const pharmacy = Boolean(meds && d.isEnabled && (await d.isEnabled(tenantId, "medicines")));
  let tracked = false;
  for (const b of batches) {
    if (b.qty === undefined) continue;
    if (pharmacy && meds && b.expiry) {
      const existing = (await meds.service.listBatches(tenantId, { itemId: [itemId], limit: 500, within: 730 } as never)).items.find((x) => x.batchNo === b.batchNo);
      if (existing) await meds.service.adjust(tenantId, existing.id, { mode: "set", qty: b.qty, reason: "adjust", note: "Import" }, userId);
      else await meds.service.receive(tenantId, { itemId, itemName: name, batchNo: b.batchNo, expiry: b.expiry, mrp: b.mrp ?? null, purchaseRate: b.cost ?? null, qty: b.qty, note: "Opening stock (import)" }, userId);
      continue;
    }
    const known = (await d.inventory.batches.listBatches(tenantId, { itemId, all: "true", limit: 200 } as never)).items.find((x) => x.batchNo === b.batchNo);
    if (known) {
      await d.inventory.batches.update(tenantId, known.id, { expiry: b.expiry, mfgDate: b.mfgDate, mrp: b.mrp, cost: b.cost });
      await d.inventory.batches.adjust(tenantId, known.id, { mode: "set", qty: b.qty, reason: "adjustment", note: "Opening stock (import)" }, userId);
    } else {
      await d.inventory.batches.receive(tenantId, { itemId, batchNo: b.batchNo, expiry: b.expiry, mfgDate: b.mfgDate, mrp: b.mrp, cost: b.cost, qty: b.qty, opening: true }, userId);
    }
    if (!tracked) {
      await d.inventory.batches.setItemTracking(tenantId, itemId, true).catch(() => undefined);
      tracked = true;
    }
  }
}

async function findProductByName(catalogue: Catalogue, tenantId: string, name: string): Promise<Product | null> {
  const page = await catalogue.listProducts(tenantId, { q: name.trim().slice(0, 100), limit: 50 });
  const hit = page.items.find((p) => nameKey(p.name) === nameKey(name) && p.status !== "archived");
  return hit ? catalogue.getProduct(tenantId, hit.id) : null;
}

/** Customers are matched by phone (last 10 digits), else by name; matches are updated, others created. */
async function importCustomers(d: ImportExportPortDeps, tenantId: string, rows: CommitRow<CustomerImportRow>[]): Promise<CommitResult> {
  const result: Required<CommitResult> = { created: 0, updated: 0, errors: [], records: [] };
  const existing = await all(pages<Customer>((limit, offset) => d.invoices.listCustomers(tenantId, { limit, offset })));
  const byPhone = new Map(existing.filter((c) => phoneKey(c.phone)).map((c) => [phoneKey(c.phone)!, c.id]));
  const byName = new Map(existing.map((c) => [nameKey(c.name), c.id]));
  for (const { row, data } of rows) {
    const input = {
      name: data.name,
      phone: data.phone ?? null,
      email: data.email ?? null,
      gstin: data.gstin ?? null,
      address: data.address ?? null,
      stateCode: data.stateCode ?? null,
      ...(data.openingBalance !== undefined ? { openingBalance: data.openingBalance } : {}),
      ...(data.creditLimit !== undefined ? { creditLimit: data.creditLimit } : {}),
    };
    try {
      const id = (phoneKey(data.phone) && byPhone.get(phoneKey(data.phone)!)) || byName.get(nameKey(data.name));
      if (id) {
        // Don't wipe fields the file leaves empty.
        const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null));
        await d.invoices.updateCustomer(tenantId, id, patch);
        result.updated++;
      } else {
        const c = await d.invoices.createCustomer(tenantId, input);
        if (phoneKey(c.phone)) byPhone.set(phoneKey(c.phone)!, c.id);
        byName.set(nameKey(c.name), c.id);
        result.created++;
        result.records.push({ entity: "party", key: `customer:${nameKey(c.name)}`, id: c.id, action: "created", meta: { kind: "customer" } });
      }
    } catch (e) {
      result.errors.push({ row, message: message(e) });
    }
  }
  return result;
}

/** Suppliers: same matching as customers (phone, else name). */
async function importSuppliers(d: ImportExportPortDeps, tenantId: string, rows: CommitRow<SupplierImportRow>[]): Promise<CommitResult> {
  const result: Required<CommitResult> = { created: 0, updated: 0, errors: [], records: [] };
  const existing = await all(pages((limit, offset) => d.inventory.listSuppliers(tenantId, { limit, offset })));
  const byPhone = new Map(existing.filter((s) => phoneKey(s.phone)).map((s) => [phoneKey(s.phone)!, s.id]));
  const byName = new Map(existing.map((s) => [nameKey(s.name), s.id]));
  for (const { row, data } of rows) {
    const input = {
      name: data.name,
      phone: data.phone ?? null,
      email: data.email ?? null,
      gstin: data.gstin ?? null,
      address: data.address ?? null,
      stateCode: data.stateCode ?? null,
      ...(data.openingBalance !== undefined ? { openingBalance: data.openingBalance, openingDate: data.openingDate ?? null } : {}),
    };
    try {
      const id = (phoneKey(data.phone) && byPhone.get(phoneKey(data.phone)!)) || byName.get(nameKey(data.name));
      if (id) {
        await d.inventory.updateSupplier(tenantId, id, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null)));
        result.updated++;
      } else {
        const s = await d.inventory.createSupplier(tenantId, input);
        if (phoneKey(s.phone)) byPhone.set(phoneKey(s.phone)!, s.id);
        byName.set(nameKey(s.name), s.id);
        result.created++;
        result.records.push({ entity: "party", key: `supplier:${nameKey(s.name)}`, id: s.id, action: "created", meta: { kind: "supplier" } });
      }
    } catch (e) {
      result.errors.push({ row, message: message(e) });
    }
  }
  return result;
}

/** Stock counts: item by SKU or barcode (catalogue lookup), location by code or name (empty = default). */
async function importStock(d: ImportExportPortDeps, tenantId: string, rows: CommitRow<StockImportRow>[], userId: string | null): Promise<CommitResult> {
  const result: Required<CommitResult> = { created: 0, updated: 0, errors: [], records: [] };
  const locations = (await d.inventory.listLocations(tenantId, { includeInactive: false })).items;
  const location = (ref: string | undefined): StockLocation | undefined => {
    if (!ref) return locations.find((l) => l.isDefault);
    const k = ref.trim().toLowerCase();
    return locations.find((l) => l.code.toLowerCase() === k) ?? locations.find((l) => l.name.toLowerCase() === k);
  };
  for (const { row, data } of rows) {
    try {
      const code = data.sku ?? data.barcode!;
      const item = await d.catalogue.lookupCode(tenantId, code).catch(nullOn404);
      if (!item) throw new Error(`No product with SKU or barcode "${code}"`);
      const loc = location(data.location);
      if (!loc) throw new Error(`Unknown location "${data.location}"`);
      if (data.mode === "add" && data.qty <= 0) throw new Error("Qty must be more than 0 to add");
      await d.inventory.adjust(
        tenantId,
        item.id,
        { mode: data.mode, qty: data.qty, unitCost: data.unitCost ?? null, note: data.note ?? "Stock import", locationId: loc.id },
        userId,
      );
      result.updated++;
    } catch (e) {
      result.errors.push({ row, message: message(e) });
    }
  }
  return result;
}

async function* exportProducts(d: ImportExportPortDeps, tenantId: string): AsyncIterable<ProductExportRow> {
  const rows = await d.catalogue.exportProducts(tenantId, {});
  const [stock, units] = await Promise.all([
    d.inventory.listStock(tenantId, {}).then((page) => new Map(page.items.map((s) => [s.itemId, s]))),
    d.catalogue.units.all(tenantId),
  ]);
  for (const r of rows) {
    const s = stock.get(r.variant.id);
    const u = units.get(r.variant.id);
    yield {
      name: r.product.name,
      variant: r.variant.title,
      sku: r.variant.sku,
      barcode: r.variant.barcode,
      category: r.categoryName,
      brand: r.product.brand,
      hsn: r.product.hsn,
      gstRate: r.product.gstRate,
      unit: r.product.unit,
      price: r.variant.price,
      mrp: r.variant.mrp,
      cost: r.variant.cost,
      taxInclusive: r.product.taxInclusive,
      stock: s && s.track ? s.qty : null,
      status: r.product.status,
      tags: r.product.tags,
      units: u?.length ? formatUnitsCell(u.map((x) => ({ unit: x.unit, factor: Number(x.factor), ownPrice: x.price, barcode: x.barcode }))) : null,
    };
  }
}

async function* exportCustomers(d: ImportExportPortDeps, tenantId: string): AsyncIterable<PartyExportRow> {
  for await (const c of pages<Customer>((limit, offset) => d.invoices.listCustomers(tenantId, { limit, offset }))) {
    yield {
      name: c.name,
      phone: c.phone,
      email: c.email,
      gstin: c.gstin,
      address: c.address,
      stateCode: c.stateCode,
      openingBalance: c.openingBalance,
      creditLimit: c.creditLimit,
      balance: c.outstanding,
    };
  }
}

async function* exportSuppliers(d: ImportExportPortDeps, tenantId: string): AsyncIterable<PartyExportRow> {
  for await (const s of pages((limit, offset) => d.inventory.listSuppliers(tenantId, { limit, offset }))) {
    yield { name: s.name, phone: s.phone, email: s.email, gstin: s.gstin, address: s.address, stateCode: s.stateCode, balance: s.payable };
  }
}

/** Every tracked item at the default location, plus items with stock at the other locations. */
async function* exportStock(d: ImportExportPortDeps, tenantId: string): AsyncIterable<StockExportRow> {
  const locations = (await d.inventory.listLocations(tenantId, {})).items;
  for (const loc of locations) {
    const items = (await d.inventory.listStock(tenantId, { locationId: loc.id })).items.filter(
      (s) => s.track && (loc.isDefault || s.qty !== 0 || s.reserved !== 0),
    );
    const codes = new Map((await d.catalogue.getItems(tenantId, items.map((s) => s.itemId))).map((i) => [i.id, i]));
    for (const s of items) {
      const c = codes.get(s.itemId);
      yield {
        sku: c?.sku ?? null,
        barcode: c?.barcode ?? null,
        name: s.name,
        location: loc.code,
        qty: s.qty,
        reserved: s.reserved,
        available: s.available,
        unit: s.unit,
        avgCost: s.avgCost,
      };
    }
  }
}
