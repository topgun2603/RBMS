import { AppError } from "@srirealtime/core";
import type { createCatalogue, Product } from "@srirealtime/catalogue";
import type { BrandingPort, DocSeller, InvoiceDocPort, OrderDocPort, PurchaseDocPort, StatementDocPort } from "@srirealtime/documents";
import {
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
  type StockExportRow,
  type StockImportRow,
} from "@srirealtime/importexport";
import type { createInventory, StockLocation } from "@srirealtime/inventory";
import type { createInvoices, Customer } from "@srirealtime/invoices";
import type { createOrders } from "@srirealtime/orders";

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
}

export function documentPorts(d: DocumentPortDeps) {
  const invoices: InvoiceDocPort = {
    invoice: (tenantId, id) => d.invoices.get(tenantId, id).catch(nullOn404),
    publicInvoice: async (token) => {
      // paymentTarget resolves the shop behind the share token (getPublic doesn't expose it).
      const target = await d.invoices.paymentTarget(token).catch(nullOn404);
      if (!target || !(await d.isEnabled(target.tenantId, "invoices"))) return null;
      const found = await d.invoices.getPublic(token, target.tenantId).catch(nullOn404);
      // branding null → the documents module asks the branding port (which carries the primary colour).
      return found ? { tenantId: target.tenantId, invoice: found.invoice, branding: null } : null;
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

  const purchases: PurchaseDocPort = {
    purchase: async (tenantId, id) => {
      const p = await d.inventory.getPurchase(tenantId, id).catch(nullOn404);
      return p ? { ...p, shop: await d.seller(tenantId) } : null;
    },
  };

  return { invoices, statements, orders, purchases, branding: { get: d.branding } satisfies BrandingPort };
}

// ================================================================ import / export

export interface ImportExportPortDeps {
  catalogue: Catalogue;
  invoices: Invoices;
  inventory: Inventory;
}

/** Registers the four importers and exporters (packages/importexport/src/specs.ts) with ports over the services. */
export function registerImportExport(registry: ImportExportRegistry, d: ImportExportPortDeps) {
  registry.registerImporter(productsImporter({ upsert: (tenantId, rows, opts) => importProducts(d, tenantId, rows, opts.userId) }));
  registry.registerImporter(customersImporter({ upsert: (tenantId, rows) => importCustomers(d, tenantId, rows) }));
  registry.registerImporter(suppliersImporter({ upsert: (tenantId, rows) => importSuppliers(d, tenantId, rows) }));
  registry.registerImporter(stockImporter({ upsert: (tenantId, rows, opts) => importStock(d, tenantId, rows, opts.userId) }));

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
  const result: Required<CommitResult> = { created: 0, updated: 0, errors: [] };
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

  const stockFor: { row: number; variantId: string; qty: number; cost?: number }[] = [];
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
        group.forEach((r, i) => {
          const v = simple ? product.variants[0] : product.variants.find((x) => x.title === (r.data.variant ?? "")) ?? product.variants[i];
          if (v && r.data.openingStock !== undefined) stockFor.push({ row: r.row, variantId: v.id, qty: r.data.openingStock, cost: r.data.cost });
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
          if (r.data.openingStock !== undefined) stockFor.push({ row: r.row, variantId: v.id, qty: r.data.openingStock, cost: r.data.cost });
        } catch (e) {
          result.errors.push({ row: r.row, message: message(e) });
        }
      }
    } catch (e) {
      for (const r of group) result.errors.push({ row: r.row, message: message(e) });
    }
  }

  for (const s of stockFor) {
    try {
      await d.inventory.adjust(tenantId, s.variantId, { mode: "set", qty: s.qty, unitCost: s.cost ?? null, note: "Opening stock (import)" }, userId);
    } catch (e) {
      result.errors.push({ row: s.row, message: `Product saved, but opening stock failed: ${message(e)}` });
    }
  }
  return result;
}

async function findProductByName(catalogue: Catalogue, tenantId: string, name: string): Promise<Product | null> {
  const page = await catalogue.listProducts(tenantId, { q: name.trim().slice(0, 100), limit: 50 });
  const hit = page.items.find((p) => nameKey(p.name) === nameKey(name) && p.status !== "archived");
  return hit ? catalogue.getProduct(tenantId, hit.id) : null;
}

/** Customers are matched by phone (last 10 digits), else by name; matches are updated, others created. */
async function importCustomers(d: ImportExportPortDeps, tenantId: string, rows: CommitRow<CustomerImportRow>[]): Promise<CommitResult> {
  const result: Required<CommitResult> = { created: 0, updated: 0, errors: [] };
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
      }
    } catch (e) {
      result.errors.push({ row, message: message(e) });
    }
  }
  return result;
}

/** Suppliers: same matching as customers (phone, else name). */
async function importSuppliers(d: ImportExportPortDeps, tenantId: string, rows: CommitRow<PartyImportRow>[]): Promise<CommitResult> {
  const result: Required<CommitResult> = { created: 0, updated: 0, errors: [] };
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
      }
    } catch (e) {
      result.errors.push({ row, message: message(e) });
    }
  }
  return result;
}

/** Stock counts: item by SKU or barcode (catalogue lookup), location by code or name (empty = default). */
async function importStock(d: ImportExportPortDeps, tenantId: string, rows: CommitRow<StockImportRow>[], userId: string | null): Promise<CommitResult> {
  const result: Required<CommitResult> = { created: 0, updated: 0, errors: [] };
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
  const stock = new Map((await d.inventory.listStock(tenantId, {})).items.map((s) => [s.itemId, s]));
  for (const r of rows) {
    const s = stock.get(r.variant.id);
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
