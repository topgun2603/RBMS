/**
 * Ready-made column specs for the importers/exporters the API kit registers (docs/commerce-batch1.md §7).
 * Parsing and validation are pure; committing and reading rows go through ports the kit implements
 * with the catalogue, invoices and inventory services.
 */
import { col, rupees, stateName, type ExportColumn, type GstRate, type ImportColumn } from "./columns";
import type { RowValidator } from "./engine";
import type { CommitOptions, CommitResult, CommitRow, ExporterDef, ImporterDef } from "./registry";

/** Writes a batch of rows; return per-row failures in `errors` (row numbers from the input). */
export interface ImportPort<T> {
  upsert(tenantId: string, rows: CommitRow<T>[], opts: CommitOptions): Promise<CommitResult>;
}

/** Reads rows for an export. */
export interface ExportPort<R> {
  rows(tenantId: string, query: Record<string, string | undefined>): AsyncIterable<R> | Iterable<R> | Promise<Iterable<R>>;
}

// ------------------------------------------------------------------ catalog.products

export interface ProductImportRow {
  name: string;
  /** Variant title, e.g. "M / Red"; rows with the same name become variants of one product. */
  variant?: string;
  sku?: string;
  barcode?: string;
  category?: string;
  brand?: string;
  description?: string;
  hsn?: string;
  gst: GstRate;
  unit: string;
  /** Paise. */
  price: number;
  mrp?: number;
  cost?: number;
  taxInclusive: boolean;
  /** Up to 3 decimals. */
  openingStock?: number;
  status?: "active" | "draft" | "archived";
  tags?: string[];
  /** Batch / expiry from the old software: becomes a real batch with its opening stock (pharmacies: a medicine batch). */
  batchNo?: string;
  expiry?: string;
  mfgDate?: string;
}

const HSN = /^\d{4}(\d{2}){0,2}$/;

export const productColumns: ImportColumn[] = [
  col.text("name", "Name", { required: true, max: 200, example: "Cotton Saree", aliases: ["product", "product name", "item", "item name"] }),
  col.text("variant", "Variant", { max: 120, example: "Red", help: "Optional; rows with the same Name become variants of one product", aliases: ["variant title", "option"] }),
  col.text("sku", "SKU", { max: 64, example: "SAR-COT-RED", aliases: ["item code", "code", "product code"] }),
  col.text("barcode", "Barcode", { max: 64, example: "8901234567890", aliases: ["ean", "upc", "gtin"] }),
  col.text("category", "Category", { max: 120, example: "Sarees" }),
  col.text("brand", "Brand", { max: 120 }),
  col.text("description", "Description", { max: 5000 }),
  col.text("hsn", "HSN", { pattern: HSN, patternMessage: "HSN/SAC must be 4, 6 or 8 digits", example: "5208", aliases: ["hsn code", "hsn/sac", "sac"] }),
  col.gstRate("gst", "GST %", { required: true, example: "5", aliases: ["gst", "gst rate", "tax", "tax rate", "tax %"] }),
  col.text("unit", "Unit", { max: 16, example: "pcs", default: "pcs", aliases: ["uom"] }),
  col.money("price", "Price", { required: true, example: "1,250.00", help: "Selling price in rupees", aliases: ["selling price", "rate", "sale price", "sp"] }),
  col.money("mrp", "MRP", { example: "1,499.00" }),
  col.money("cost", "Cost", { example: "900.00", aliases: ["cost price", "purchase price", "cp"] }),
  col.bool("tax_inclusive", "Tax inclusive", { example: "yes", default: false, help: "yes if Price includes GST", aliases: ["price includes gst", "inclusive", "incl tax"] }),
  col.decimal("opening_stock", "Opening stock", { decimals: 3, example: "10", aliases: ["stock", "qty", "quantity", "opening qty"] }),
  col.oneOf("status", "Status", ["active", "draft", "archived"] as const, { default: "active" }),
  col.list("tags", "Tags", { example: "cotton, summer" }),
  col.text("batch_no", "Batch no", { max: 60, help: "Optional; the opening stock goes into this batch. Several rows of one item with different batch numbers become its batches", aliases: ["batch", "batch number", "batch no."] }),
  col.batchDate("expiry", "Expiry", "expiry", { help: "Optional; the batch's last day to sell, e.g. 03/2027", aliases: ["expiry date", "exp date", "exp"] }),
  col.batchDate("mfg_date", "Mfg date", "mfg", { help: "Optional; manufacturing date of the batch, e.g. 09/2026", aliases: ["mfg", "mfg date", "manufacturing date", "mfd"] }),
];

export const validateProductRow: RowValidator<Record<string, unknown>> = (r) => {
  const errors: string[] = [];
  const price = r.price as number;
  const mrp = r.mrp as number | undefined;
  if (mrp !== undefined && mrp < price) errors.push("MRP can't be less than the price");
  if (r.tax_inclusive === true && mrp !== undefined && price > mrp) errors.push("Price can't be more than MRP");
  return errors;
};

/** Parsed row (snake_case keys from columns) → port shape. */
export function toProductRow(d: Record<string, unknown>): ProductImportRow {
  return {
    name: d.name as string,
    variant: d.variant as string | undefined,
    sku: d.sku as string | undefined,
    barcode: d.barcode as string | undefined,
    category: d.category as string | undefined,
    brand: d.brand as string | undefined,
    description: d.description as string | undefined,
    hsn: d.hsn as string | undefined,
    gst: d.gst as GstRate,
    unit: (d.unit as string | undefined) ?? "pcs",
    price: d.price as number,
    mrp: d.mrp as number | undefined,
    cost: d.cost as number | undefined,
    taxInclusive: (d.tax_inclusive as boolean | undefined) ?? false,
    openingStock: d.opening_stock as number | undefined,
    status: d.status as ProductImportRow["status"],
    tags: d.tags as string[] | undefined,
    batchNo: d.batch_no as string | undefined,
    expiry: d.expiry as string | undefined,
    mfgDate: d.mfg_date as string | undefined,
  };
}

export interface ProductExportRow {
  name: string;
  variant: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  hsn: string | null;
  gstRate: number;
  unit: string;
  price: number;
  mrp: number | null;
  cost: number | null;
  taxInclusive: boolean;
  stock?: number | null;
  status: string;
  tags?: string[];
}

export const productExportColumns: ExportColumn<ProductExportRow>[] = [
  { key: "name", label: "Name", width: 32 },
  { key: "variant", label: "Variant" },
  { key: "sku", label: "SKU" },
  { key: "barcode", label: "Barcode" },
  { key: "category", label: "Category" },
  { key: "brand", label: "Brand" },
  { key: "hsn", label: "HSN" },
  { key: "gst", label: "GST %", value: (r) => r.gstRate },
  { key: "unit", label: "Unit" },
  { key: "price", label: "Price", value: (r) => rupees(r.price) },
  { key: "mrp", label: "MRP", value: (r) => rupees(r.mrp) },
  { key: "cost", label: "Cost", value: (r) => rupees(r.cost) },
  { key: "tax_inclusive", label: "Tax inclusive", value: (r) => (r.taxInclusive ? "yes" : "no") },
  { key: "opening_stock", label: "Opening stock", value: (r) => r.stock ?? null },
  { key: "status", label: "Status" },
  { key: "tags", label: "Tags", value: (r) => r.tags?.join(", ") ?? null },
];

// ------------------------------------------------------------------ invoices.customers / inventory.suppliers

export interface PartyImportRow {
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  address?: string;
  /** 2-digit GST state code. */
  stateCode?: string;
}

export interface SupplierImportRow extends PartyImportRow {
  /** Paise; + = the shop owes the supplier, − = advance paid. */
  openingBalance?: number;
  /** YYYY-MM-DD the balance is as of. */
  openingDate?: string;
}

export interface CustomerImportRow extends PartyImportRow {
  /** Paise; + = the customer owes the shop, − = advance. */
  openingBalance?: number;
  /** Paise. */
  creditLimit?: number;
}

const partyColumns = (): ImportColumn[] => [
  col.text("name", "Name", { required: true, max: 200, example: "Murugan Stores", aliases: ["customer", "customer name", "supplier", "supplier name", "party", "party name"] }),
  col.phone("phone", "Phone", { example: "98765 43210", aliases: ["mobile", "mobile number", "phone number", "contact", "whatsapp"] }),
  col.email("email", "Email", { example: "murugan@example.com", aliases: ["email id", "e-mail"] }),
  col.gstin("gstin", "GSTIN", { example: "33AAACR5055K1ZE", aliases: ["gst number", "gst no", "gstin/uin"] }),
  col.text("address", "Address", { max: 1000, example: "5, Car Street, Madurai" }),
  col.state("state", "State", { example: "Tamil Nadu", aliases: ["state code", "state name", "place of supply"] }),
];

/** GSTIN's first two digits must match the state; fills the state from the GSTIN when it's empty. */
export const validateParty: RowValidator<Record<string, unknown>> = (r) => {
  const gstin = r.gstin as string | undefined;
  if (!gstin) return;
  const fromGstin = gstin.slice(0, 2);
  if (r.state === undefined) {
    if (!stateName(fromGstin)) return `GSTIN starts with ${fromGstin}, which is not a state code`;
    r.state = fromGstin;
  } else if (r.state !== fromGstin) {
    return `GSTIN is from state ${fromGstin} (${stateName(fromGstin) ?? "unknown"}) but State is ${r.state} (${stateName(r.state as string)})`;
  }
};

export const customerColumns: ImportColumn[] = [
  ...partyColumns(),
  col.money("opening_balance", "Opening balance", {
    allowNegative: true,
    example: "1,500.00",
    help: "Rupees the customer owes you today; negative for an advance",
    aliases: ["balance", "outstanding", "due", "opening due"],
  }),
  col.money("credit_limit", "Credit limit", { example: "10,000.00", aliases: ["limit"] }),
];

export const supplierColumns: ImportColumn[] = [
  ...partyColumns(),
  col.money("opening_balance", "Opening balance", {
    allowNegative: true,
    example: "4,200.00",
    help: "Rupees you owe the supplier today; negative for an advance you paid",
    aliases: ["balance", "outstanding", "payable", "due", "opening due"],
  }),
  col.date("opening_date", "Balance as of", { example: "2026-03-31", aliases: ["opening date", "as of date"] }),
];

const toParty = (d: Record<string, unknown>): PartyImportRow => ({
  name: d.name as string,
  phone: d.phone as string | undefined,
  email: d.email as string | undefined,
  gstin: d.gstin as string | undefined,
  address: d.address as string | undefined,
  stateCode: d.state as string | undefined,
});

export const toCustomerRow = (d: Record<string, unknown>): CustomerImportRow => ({
  ...toParty(d),
  openingBalance: d.opening_balance as number | undefined,
  creditLimit: d.credit_limit as number | undefined,
});

export const toSupplierRow = (d: Record<string, unknown>): SupplierImportRow => ({
  ...toParty(d),
  openingBalance: d.opening_balance as number | undefined,
  openingDate: d.opening_date as string | undefined,
});

export interface PartyExportRow {
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
  openingBalance?: number | null;
  creditLimit?: number | null;
  /** Current balance (customers: receivable; suppliers: payable), paise. */
  balance?: number | null;
}

const partyExport: ExportColumn<PartyExportRow>[] = [
  { key: "name", label: "Name", width: 30 },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "gstin", label: "GSTIN" },
  { key: "address", label: "Address", width: 40 },
  { key: "state", label: "State", value: (r) => stateName(r.stateCode) ?? r.stateCode },
];

export const customerExportColumns: ExportColumn<PartyExportRow>[] = [
  ...partyExport,
  { key: "opening_balance", label: "Opening balance", value: (r) => rupees(r.openingBalance) },
  { key: "credit_limit", label: "Credit limit", value: (r) => rupees(r.creditLimit) },
  { key: "balance", label: "Balance", value: (r) => rupees(r.balance) },
];

export const supplierExportColumns: ExportColumn<PartyExportRow>[] = [...partyExport, { key: "payable", label: "Payable", value: (r) => rupees(r.balance) }];

// ------------------------------------------------------------------ inventory.stock

export interface StockImportRow {
  sku?: string;
  barcode?: string;
  /** Location code or name; empty = default location. */
  location?: string;
  qty: number;
  /** "set" (default): stock becomes qty; "add": qty is added. */
  mode: "set" | "add";
  /** Paise per unit (moving-average cost), optional. */
  unitCost?: number;
  note?: string;
}

export const stockColumns: ImportColumn[] = [
  col.text("sku", "SKU", { max: 64, example: "SAR-COT-RED", aliases: ["item code", "code", "sku/barcode"] }),
  col.text("barcode", "Barcode", { max: 64, aliases: ["ean", "upc"] }),
  col.text("location", "Location", { max: 120, example: "Main", aliases: ["store", "warehouse", "location code"] }),
  col.decimal("qty", "Qty", { required: true, decimals: 3, example: "12", aliases: ["quantity", "stock", "count", "on hand"] }),
  col.oneOf("mode", "Mode", ["set", "add"] as const, { default: "set", help: "set = stock becomes Qty; add = Qty is added" }),
  col.money("unit_cost", "Unit cost", { example: "900.00", aliases: ["cost", "rate"] }),
  col.text("note", "Note", { max: 300 }),
];

export const validateStockRow: RowValidator<Record<string, unknown>> = (r) => (!r.sku && !r.barcode ? "Give a SKU or a barcode" : undefined);

export const toStockRow = (d: Record<string, unknown>): StockImportRow => ({
  sku: d.sku as string | undefined,
  barcode: d.barcode as string | undefined,
  location: d.location as string | undefined,
  qty: d.qty as number,
  mode: (d.mode as "set" | "add" | undefined) ?? "set",
  unitCost: d.unit_cost as number | undefined,
  note: d.note as string | undefined,
});

export interface StockExportRow {
  sku: string | null;
  barcode: string | null;
  name: string;
  location: string | null;
  qty: number;
  reserved?: number | null;
  available?: number | null;
  unit?: string | null;
  avgCost?: number | null;
}

export const stockExportColumns: ExportColumn<StockExportRow>[] = [
  { key: "sku", label: "SKU" },
  { key: "barcode", label: "Barcode" },
  { key: "name", label: "Name", width: 32 },
  { key: "location", label: "Location" },
  { key: "qty", label: "Qty" },
  { key: "reserved", label: "Reserved" },
  { key: "available", label: "Available" },
  { key: "unit", label: "Unit" },
  { key: "unit_cost", label: "Unit cost", value: (r) => rupees(r.avgCost) },
];

// ------------------------------------------------------------------ definitions (the kit passes ports)

function importer<T>(
  base: { key: string; label: string; feature: string; permission?: string; columns: ImportColumn[]; validate?: RowValidator<Record<string, unknown>> },
  convert: (d: Record<string, unknown>) => T,
  port: ImportPort<T>,
  batchSize?: number,
): ImporterDef<Record<string, unknown>> {
  return {
    ...base,
    batchSize,
    commit: (tenantId, rows, opts) => port.upsert(tenantId, rows.map((r) => ({ row: r.row, data: convert(r.data) })), opts),
  };
}

export const productsImporter = (port: ImportPort<ProductImportRow>, opts: { feature?: string; permission?: string } = {}) =>
  importer(
    { key: "catalog.products", label: "Products", feature: opts.feature ?? "catalogue", permission: opts.permission ?? "catalogue.manage", columns: productColumns, validate: validateProductRow },
    toProductRow,
    port,
    100,
  );

export const customersImporter = (port: ImportPort<CustomerImportRow>, opts: { feature?: string; permission?: string } = {}) =>
  importer(
    { key: "invoices.customers", label: "Customers", feature: opts.feature ?? "invoices", permission: opts.permission, columns: customerColumns, validate: validateParty },
    toCustomerRow,
    port,
  );

export const suppliersImporter = (port: ImportPort<SupplierImportRow>, opts: { feature?: string; permission?: string } = {}) =>
  importer(
    { key: "inventory.suppliers", label: "Suppliers", feature: opts.feature ?? "inventory.purchases", permission: opts.permission, columns: supplierColumns, validate: validateParty },
    toSupplierRow,
    port,
  );

export const stockImporter = (port: ImportPort<StockImportRow>, opts: { feature?: string; permission?: string } = {}) =>
  importer(
    { key: "inventory.stock", label: "Stock", feature: opts.feature ?? "inventory", permission: opts.permission ?? "inventory.adjust", columns: stockColumns, validate: validateStockRow },
    toStockRow,
    port,
  );

const exporter = <R>(key: string, label: string, feature: string, columns: ExportColumn<R>[], port: ExportPort<R>, permission?: string): ExporterDef<R> => ({
  key,
  label,
  feature,
  permission,
  columns,
  rows: (tenantId, query) => port.rows(tenantId, query),
});

export const productsExporter = (port: ExportPort<ProductExportRow>, feature = "catalogue") => exporter("catalog.products", "Products", feature, productExportColumns, port);
export const customersExporter = (port: ExportPort<PartyExportRow>, feature = "invoices") => exporter("invoices.customers", "Customers", feature, customerExportColumns, port);
export const suppliersExporter = (port: ExportPort<PartyExportRow>, feature = "inventory.purchases") =>
  exporter("inventory.suppliers", "Suppliers", feature, supplierExportColumns, port);
export const stockExporter = (port: ExportPort<StockExportRow>, feature = "inventory") => exporter("inventory.stock", "Stock", feature, stockExportColumns, port);
