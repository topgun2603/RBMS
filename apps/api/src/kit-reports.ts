import type { Db } from "@rbms/db";
import { datasetFromSql, type DatasetDefinition, type ReportsService } from "@rbms/reports";
import { sql, type SQL } from "@rbms/db";

/**
 * Report-builder datasets (docs/batch3.md §B5) over the modules' tables, registered with `reports.service`. Each one is
 * whitelisted SQL through `datasetFromSql`: a fixed FROM, a mandatory tenant WHERE and one expression per column —
 * user input only ever reaches SQL as bound parameters. Money columns are paise. Each dataset names the feature the
 * shop needs (checked by the reports module) and, where the data is more sensitive than sales, a permission on top
 * of `reports.view`.
 */
const GST_RATE_OPTIONS = ["0", "0.25", "3", "5", "12", "18", "28"].map((v) => ({ value: v, label: `${v}%` }));
const BILL_STATUS = [
  { value: "issued", label: "Unpaid" },
  { value: "partially_paid", label: "Partly paid" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];
const PAY_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];
const ORDER_STATUS = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled", "returned"].map((v) => ({
  value: v,
  label: v[0]!.toUpperCase() + v.slice(1),
}));

export function registerDatasets(reports: ReportsService, db: Db, _isEnabled: (tenantId: string, key: string) => Promise<boolean>) {
  const execute = (q: SQL) => db.execute(q);
  const add = (definition: DatasetDefinition, from: SQL, where: (tenantId: string) => SQL, columns: Parameters<typeof datasetFromSql>[0]["columns"]) =>
    reports.registerDataset(datasetFromSql({ definition, execute, from, where, columns }));

  // ---- invoices: every line of every issued bill, and every credit note line as a negative row (net sales, like the
  // sales register)
  add(
    {
      id: "invoices.sales-lines",
      label: "Sales lines",
      description: "Every item sold on a bill: quantity, taxable value and GST. Credit notes (returns) are negative rows.",
      module: "invoices",
      feature: "invoices.reports",
      dateColumn: "date",
      defaultSort: { column: "date", dir: "desc" },
      columns: [
        { key: "date", label: "Bill date", type: "date", groupable: true },
        { key: "invoiceNumber", label: "Bill no.", type: "text" },
        { key: "customerName", label: "Customer", type: "text", groupable: true },
        {
          key: "status",
          label: "Payment status",
          type: "enum",
          options: [...BILL_STATUS.slice(0, 3), { value: "credit_note", label: "Credit note" }],
          groupable: true,
        },
        { key: "item", label: "Item", type: "text", groupable: true },
        { key: "hsn", label: "HSN/SAC", type: "text", groupable: true, default: false },
        { key: "gstRate", label: "GST rate", type: "enum", options: GST_RATE_OPTIONS, groupable: true },
        { key: "qty", label: "Qty", type: "number", aggregatable: true },
        { key: "rate", label: "Rate", type: "money", default: false },
        { key: "taxable", label: "Taxable value", type: "money", aggregatable: true },
        { key: "gst", label: "GST", type: "money", aggregatable: true },
        { key: "total", label: "Line total", type: "money", aggregatable: true },
        { key: "branchId", label: "Branch", type: "text", groupable: true, default: false },
      ],
    },
    sql`(
      SELECT i.tenant_id, i.date, i.number, i.customer, i.status, i.branch_id, l.line, 1 AS sign
        FROM invoices i CROSS JOIN LATERAL jsonb_array_elements(i.lines) AS l(line)
        WHERE i.status NOT IN ('draft', 'cancelled')
      UNION ALL
      SELECT cn.tenant_id, cn.date, cn.number, cn.customer, 'credit_note', cn.branch_id, l.line, -1
        FROM credit_notes cn CROSS JOIN LATERAL jsonb_array_elements(cn.lines) AS l(line)
        WHERE cn.status = 'issued'
    ) s`,
    (tenantId) => sql`s.tenant_id = ${tenantId}`,
    {
      date: sql`s.date`,
      invoiceNumber: sql`s.number`,
      customerName: sql`s.customer->>'name'`,
      status: sql`s.status`,
      item: sql`s.line->>'description'`,
      hsn: sql`s.line->>'hsn'`,
      gstRate: sql`((s.line->>'gstRate')::numeric)::text`,
      qty: sql`s.sign * (s.line->>'qty')::numeric`,
      rate: sql`(s.line->>'rate')::bigint`,
      taxable: sql`s.sign * (s.line->>'taxable')::bigint`,
      gst: sql`s.sign * ((s.line->>'cgst')::bigint + (s.line->>'sgst')::bigint + (s.line->>'igst')::bigint)`,
      total: sql`s.sign * (s.line->>'total')::bigint`,
      branchId: sql`s.branch_id::text`,
    },
  );

  // ---- invoices: one row per bill
  add(
    {
      id: "invoices.bills",
      label: "Bills",
      description: "Every numbered bill with its totals, payments and balance.",
      module: "invoices",
      feature: "invoices.reports",
      dateColumn: "date",
      defaultSort: { column: "date", dir: "desc" },
      columns: [
        { key: "date", label: "Bill date", type: "date", groupable: true },
        { key: "number", label: "Bill no.", type: "text" },
        { key: "customerName", label: "Customer", type: "text", groupable: true },
        { key: "customerGstin", label: "Customer GSTIN", type: "text", default: false },
        { key: "status", label: "Status", type: "enum", options: BILL_STATUS, groupable: true },
        { key: "interState", label: "Supply", type: "enum", options: [{ value: "intra", label: "Within state" }, { value: "inter", label: "Inter-state" }], groupable: true, default: false },
        { key: "taxable", label: "Taxable value", type: "money", aggregatable: true },
        { key: "gst", label: "GST", type: "money", aggregatable: true },
        { key: "total", label: "Bill total", type: "money", aggregatable: true },
        { key: "paid", label: "Paid", type: "money", aggregatable: true },
        { key: "balance", label: "Balance", type: "money", aggregatable: true },
        { key: "branchId", label: "Branch", type: "text", groupable: true, default: false },
      ],
    },
    sql`invoices i`,
    (tenantId) => sql`i.tenant_id = ${tenantId} AND i.status <> 'draft'`,
    {
      date: sql`i.date`,
      number: sql`i.number`,
      customerName: sql`i.customer->>'name'`,
      customerGstin: sql`i.customer->>'gstin'`,
      status: sql`i.status`,
      interState: sql`CASE WHEN i.inter_state THEN 'inter' ELSE 'intra' END`,
      taxable: sql`(i.totals->>'taxable')::bigint`,
      gst: sql`((i.totals->>'cgst')::bigint + (i.totals->>'sgst')::bigint + (i.totals->>'igst')::bigint)`,
      total: sql`i.total`,
      paid: sql`i.paid`,
      balance: sql`CASE WHEN i.status = 'cancelled' THEN 0 ELSE greatest(i.total - i.paid - i.credited, 0) END`,
      branchId: sql`i.branch_id::text`,
    },
  );

  // ---- invoices: payments received
  add(
    {
      id: "invoices.payments",
      label: "Payments received",
      description: "Money received against bills, by date and payment mode.",
      module: "invoices",
      feature: "invoices.reports",
      dateColumn: "date",
      defaultSort: { column: "date", dir: "desc" },
      columns: [
        { key: "date", label: "Date", type: "date", groupable: true },
        { key: "recordedAt", label: "Recorded on", type: "date", groupable: true, default: false },
        { key: "method", label: "Mode", type: "enum", groupable: true, options: PAY_METHODS },
        {
          key: "source",
          label: "Recorded via",
          type: "enum",
          groupable: true,
          default: false,
          options: [
            { value: "manual", label: "On the bill" },
            { value: "receipt", label: "Receipt" },
            { value: "online", label: "Online payment" },
            { value: "refund", label: "Refund (credit note)" },
          ],
        },
        { key: "amount", label: "Amount", type: "money", aggregatable: true },
        { key: "reference", label: "Reference", type: "text", default: false },
        { key: "invoiceNumber", label: "Bill no.", type: "text" },
        { key: "customerName", label: "Customer", type: "text", groupable: true },
      ],
    },
    sql`invoice_payments p JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id`,
    (tenantId) => sql`p.tenant_id = ${tenantId} AND i.status <> 'cancelled'`,
    {
      date: sql`p.date`,
      recordedAt: { expr: sql`p.created_at`, timestamp: true },
      method: sql`p.method`,
      source: sql`p.source`,
      amount: sql`p.amount`,
      reference: sql`p.reference`,
      invoiceNumber: sql`i.number`,
      customerName: sql`i.customer->>'name'`,
    },
  );

  // ---- invoices: customers (billing customers)
  add(
    {
      id: "invoices.customers",
      label: "Customers",
      description: "Billing customers with their contact details, credit limit and opening balance.",
      module: "invoices",
      feature: "invoices",
      permission: "customers.create",
      dateColumn: "createdOn",
      defaultSort: { column: "name", dir: "asc" },
      columns: [
        { key: "name", label: "Name", type: "text" },
        { key: "phone", label: "Mobile", type: "text" },
        { key: "email", label: "Email", type: "text", default: false },
        { key: "gstin", label: "GSTIN", type: "text" },
        { key: "stateCode", label: "State code", type: "text", groupable: true, default: false },
        { key: "openingBalance", label: "Opening balance", type: "money", aggregatable: true, default: false },
        { key: "creditLimit", label: "Credit limit", type: "money", default: false },
        { key: "createdOn", label: "Added on", type: "date", groupable: true },
      ],
    },
    sql`billing_customers c`,
    (tenantId) => sql`c.tenant_id = ${tenantId} AND c.deleted_at IS NULL`,
    {
      name: sql`c.name`,
      phone: sql`c.phone`,
      email: sql`c.email`,
      gstin: sql`c.gstin`,
      stateCode: sql`c.state_code`,
      openingBalance: sql`c.opening_balance`,
      creditLimit: sql`c.credit_limit`,
      createdOn: { expr: sql`c.created_at`, timestamp: true },
    },
  );

  // ---- orders
  add(
    {
      id: "orders.orders",
      label: "Orders",
      description: "Store, counter and phone orders with status, payment and totals.",
      module: "orders",
      feature: "orders",
      dateColumn: "placedOn",
      defaultSort: { column: "placedOn", dir: "desc" },
      columns: [
        { key: "placedOn", label: "Placed on", type: "date", groupable: true },
        { key: "number", label: "Order no.", type: "text" },
        { key: "channel", label: "Channel", type: "enum", groupable: true, options: ["store", "manual", "pos", "marketplace"].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })) },
        { key: "status", label: "Status", type: "enum", options: ORDER_STATUS, groupable: true },
        {
          key: "paymentStatus",
          label: "Payment",
          type: "enum",
          groupable: true,
          options: ["unpaid", "pending", "paid", "cod", "refunded", "partially_refunded"].map((v) => ({ value: v, label: v.replace("_", " ") })),
        },
        { key: "paymentMethod", label: "Payment mode", type: "text", groupable: true, default: false },
        { key: "customerName", label: "Customer", type: "text", groupable: true },
        { key: "customerPhone", label: "Mobile", type: "text", default: false },
        { key: "items", label: "Items", type: "number", aggregatable: true, default: false },
        { key: "discount", label: "Coupon discount", type: "money", aggregatable: true, default: false },
        { key: "shipping", label: "Shipping", type: "money", aggregatable: true, default: false },
        { key: "total", label: "Order total", type: "money", aggregatable: true },
        { key: "paid", label: "Paid", type: "money", aggregatable: true },
      ],
    },
    sql`orders o`,
    (tenantId) => sql`o.tenant_id = ${tenantId}`,
    {
      placedOn: { expr: sql`o.placed_at`, timestamp: true },
      number: sql`o.number`,
      channel: sql`o.channel`,
      status: sql`o.status`,
      paymentStatus: sql`o.payment_status`,
      paymentMethod: sql`o.payment_method`,
      customerName: sql`o.customer->>'name'`,
      customerPhone: sql`o.customer->>'phone'`,
      items: sql`jsonb_array_length(o.lines)`,
      discount: sql`coalesce((o.totals->>'discount')::bigint, 0)`,
      shipping: sql`coalesce((o.totals->>'shipping')::bigint, 0)`,
      total: sql`o.total`,
      paid: sql`o.paid`,
    },
  );

  // ---- inventory: stock on hand per item and location (no date range: it is a snapshot)
  add(
    {
      id: "inventory.stock",
      label: "Stock on hand",
      description: "Quantity, reorder level and value of every tracked item at each location.",
      module: "inventory",
      feature: "inventory",
      defaultSort: { column: "item", dir: "asc" },
      columns: [
        { key: "item", label: "Item", type: "text", groupable: true },
        { key: "sku", label: "SKU", type: "text" },
        { key: "location", label: "Location", type: "text", groupable: true },
        { key: "qty", label: "Qty", type: "number", aggregatable: true },
        { key: "reserved", label: "Reserved", type: "number", aggregatable: true, default: false },
        { key: "reorderLevel", label: "Reorder level", type: "number", default: false },
        { key: "avgCost", label: "Average cost", type: "money", default: false },
        { key: "value", label: "Stock value", type: "money", aggregatable: true },
      ],
    },
    sql`stock_items s
      JOIN catalog_variants v ON v.id = s.item_id AND v.tenant_id = s.tenant_id
      JOIN catalog_products p ON p.id = v.product_id AND p.tenant_id = s.tenant_id
      LEFT JOIN stock_locations loc ON loc.id = s.location_id AND loc.tenant_id = s.tenant_id`,
    (tenantId) => sql`s.tenant_id = ${tenantId} AND s.track AND v.deleted_at IS NULL`,
    {
      item: sql`CASE WHEN v.title = '' THEN p.name ELSE p.name || ' – ' || v.title END`,
      sku: sql`v.sku`,
      location: sql`coalesce(loc.name, 'Main')`,
      qty: sql`s.qty`,
      reserved: sql`s.reserved`,
      reorderLevel: sql`s.reorder_level`,
      avgCost: sql`s.avg_cost`,
      value: sql`round(greatest(s.qty, 0) * coalesce(s.avg_cost, 0))::bigint`,
    },
  );

  // ---- expenses
  add(
    {
      id: "expenses.expenses",
      label: "Expenses",
      description: "Shop expenses by category, with the GST inside them.",
      module: "expenses",
      feature: "expenses",
      dateColumn: "date",
      defaultSort: { column: "date", dir: "desc" },
      columns: [
        { key: "date", label: "Date", type: "date", groupable: true },
        { key: "category", label: "Category", type: "text", groupable: true },
        { key: "vendor", label: "Paid to", type: "text", groupable: true },
        { key: "paymentMethod", label: "Mode", type: "text", groupable: true, default: false },
        { key: "amount", label: "Amount (incl. GST)", type: "money", aggregatable: true },
        { key: "gst", label: "GST", type: "money", aggregatable: true },
        { key: "note", label: "Note", type: "text", default: false },
      ],
    },
    sql`expenses e LEFT JOIN expense_categories c ON c.id = e.category_id AND c.tenant_id = e.tenant_id`,
    (tenantId) => sql`e.tenant_id = ${tenantId} AND e.status = 'recorded'`,
    {
      date: sql`e.date`,
      category: sql`coalesce(c.name, '')`,
      vendor: sql`e.vendor_name`,
      paymentMethod: sql`e.payment_method`,
      amount: sql`e.amount`,
      gst: sql`e.gst_amount`,
      note: sql`e.note`,
    },
  );

  // ---- loyalty members
  add(
    {
      id: "loyalty.members",
      label: "Loyalty members",
      description: "Customers in the loyalty programme with their points, tier and lifetime spend.",
      module: "loyalty",
      feature: "loyalty",
      permission: "loyalty.manage",
      dateColumn: "joinedOn",
      defaultSort: { column: "points", dir: "desc" },
      columns: [
        { key: "name", label: "Name", type: "text" },
        { key: "mobile", label: "Mobile", type: "text" },
        { key: "tier", label: "Tier", type: "text", groupable: true },
        { key: "points", label: "Points", type: "number", aggregatable: true },
        { key: "lifetimeSpend", label: "Lifetime spend", type: "money", aggregatable: true },
        { key: "joinedOn", label: "Joined on", type: "date", groupable: true },
      ],
    },
    sql`loyalty_members m`,
    (tenantId) => sql`m.tenant_id = ${tenantId}`,
    {
      name: sql`m.name`,
      mobile: sql`m.member_key`,
      tier: sql`m.tier`,
      points: sql`m.points_balance`,
      lifetimeSpend: sql`m.lifetime_spend`,
      joinedOn: { expr: sql`m.joined_at`, timestamp: true },
    },
  );

  // ---- marketplace: seller ledger (feature `marketplace`, staff with marketplace.manage)
  add(
    {
      id: "marketplace.vendor-ledger",
      label: "Seller ledger",
      description: "Sales, commission, refunds, payouts and adjustments per seller.",
      module: "marketplace",
      feature: "marketplace",
      permission: "marketplace.manage",
      dateColumn: "date",
      defaultSort: { column: "date", dir: "desc" },
      columns: [
        { key: "date", label: "Date", type: "date", groupable: true },
        { key: "seller", label: "Seller", type: "text", groupable: true },
        {
          key: "type",
          label: "Type",
          type: "enum",
          groupable: true,
          options: ["sale", "commission", "refund", "payout", "adjustment"].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })),
        },
        { key: "amount", label: "Amount", type: "money", aggregatable: true },
        { key: "note", label: "Note", type: "text", default: false },
      ],
    },
    sql`vendor_ledger l JOIN vendors v ON v.id = l.vendor_id AND v.tenant_id = l.tenant_id`,
    (tenantId) => sql`l.tenant_id = ${tenantId}`,
    {
      date: { expr: sql`l.created_at`, timestamp: true },
      seller: sql`v.name`,
      type: sql`l.type`,
      amount: sql`l.amount`,
      note: sql`l.note`,
    },
  );
}
