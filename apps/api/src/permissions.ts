import { AppError, requirePermission, type PermissionDef } from "@srirealtime/core";
import { CATALOGUE_PERMISSIONS } from "@srirealtime/catalogue";
import { INVENTORY_PERMISSIONS, INVENTORY_ROUTE_PERMISSIONS } from "@srirealtime/inventory";
import { ORDER_PERMISSIONS_KEYS } from "@srirealtime/orders";
import type { FastifyInstance, FastifyRequest, RouteOptions } from "fastify";

/**
 * Permissions of the billing modules (docs/commerce-batch1.md §5) and which existing routes need them. Packages own
 * their routes, so the host attaches `config.permission` while the routes are registered (`onRoute`), keyed by
 * `<METHOD> <full URL>`. Owners, admins and super-admins pass every check; plain staff get the staff "default" role.
 */
export const INVOICE_PERMISSIONS: PermissionDef[] = [
  { key: "invoices.create", module: "invoices", label: "Create bills", description: "Create, edit, issue and share bills." },
  { key: "invoices.cancel", module: "invoices", label: "Cancel bills", description: "Cancel issued bills (stock goes back)." },
  { key: "quotations.view", module: "invoices", label: "View quotations", description: "See quotations and download their PDFs." },
  {
    key: "quotations.manage",
    module: "invoices",
    label: "Make quotations",
    description: "Create, revise, send, cancel and convert quotations into bills or orders.",
  },
  { key: "sales-docs.view", module: "invoices", label: "View proformas, sale orders and challans", description: "See proforma invoices, sale orders and delivery challans and download their PDFs." },
  {
    key: "sales-docs.manage",
    module: "invoices",
    label: "Make proformas, sale orders and challans",
    description: "Create, edit, send and cancel proforma invoices, sale orders and delivery challans, deliver goods and record returns. Billing them also needs Create bills; advances need Receive payments.",
  },
  {
    key: "invoices.credit-note",
    module: "invoices",
    label: "Credit notes and returns",
    description: "Issue credit notes against bills (full or partial returns, price corrections) with refunds, and cancel them the same day.",
  },
  { key: "pos.till", module: "invoices", label: "Open and close the till", description: "Open and close the POS cash drawer, record cash in / out and print the Z report." },
  { key: "invoices.discount", module: "invoices", label: "Give discounts", description: "Add discounts to bill lines." },
  {
    key: "invoices.discount-approve",
    module: "invoices",
    label: "Approve discounts",
    description: "Approve a discount above a cashier's limit by entering their own PIN at the counter.",
  },
  {
    key: "invoices.credit-book",
    module: "invoices",
    label: "Credit book",
    description: "See customer ledgers and dues, record receipts on account, share statements and send reminders.",
  },
  { key: "reports.view", module: "invoices", label: "View reports", description: "Sales, payments, GST, stock and purchase reports." },
  { key: "settings.manage", module: "invoices", label: "Manage settings", description: "Shop settings such as the payment account." },
  { key: "payments.receive", module: "invoices", label: "Receive payments", description: "Record payments against bills." },
  { key: "customers.create", module: "invoices", label: "Add customers", description: "Add and edit customers." },
];

/**
 * Using a customer's loyalty points on a bill or a counter order (the `loyaltyPoints` field). Declared by the host on
 * the loyalty module: the loyalty package only knows `loyalty.manage` (members, adjustments, settings).
 */
export const LOYALTY_HOST_PERMISSIONS: PermissionDef[] = [
  { key: "loyalty.redeem", module: "loyalty", label: "Redeem loyalty points", description: "Use a customer's loyalty points as a discount on a bill or order." },
];

export const CATALOGUE_PERMISSION_DEFS: PermissionDef[] = CATALOGUE_PERMISSIONS.map((p) => ({ ...p, module: "catalogue" }));
export const INVENTORY_PERMISSION_DEFS: PermissionDef[] = INVENTORY_PERMISSIONS.map((p) => ({ ...p }));

const BILL = "/v1/invoices/:id([0-9a-fA-F-]{36})";
const QUOTE = "/v1/quotations/:id([0-9a-fA-F-]{36})";
const ORDER = "/v1/orders/:id([0-9a-fA-F-]{36})";
const SD = "/v1/sales-docs";
const PI = `${SD}/proformas/:id([0-9a-fA-F-]{36})`;
const SO = `${SD}/sale-orders/:id([0-9a-fA-F-]{36})`;
const DC = `${SD}/challans/:id([0-9a-fA-F-]{36})`;
const COUPON = "/v1/coupons/:id([0-9a-fA-F-]{36})";
const CATALOGUE_MANAGE = CATALOGUE_PERMISSIONS[0].key;

export const ROUTE_PERMISSIONS: Record<string, string | string[]> = {
  // ---- invoices: bills
  "POST /v1/invoices/": "invoices.create",
  [`PATCH ${BILL}`]: "invoices.create",
  [`DELETE ${BILL}`]: "invoices.create",
  [`POST ${BILL}/issue`]: "invoices.create",
  [`POST ${BILL}/share`]: "invoices.create",
  [`POST ${BILL}/send`]: "invoices.create",
  [`POST ${BILL}/cancel`]: "invoices.cancel",
  [`POST ${BILL}/payments`]: "payments.receive",
  // ---- quotations (estimates): view = see them, manage = make, revise, send, cancel and convert
  "GET /v1/quotations/": "quotations.view",
  "GET /v1/quotations/summary": "quotations.view",
  "GET /v1/quotations/linked": "quotations.view",
  "GET /v1/quotations/settings": "quotations.view",
  [`GET ${QUOTE}`]: "quotations.view",
  "POST /v1/quotations/": "quotations.manage",
  [`PATCH ${QUOTE}`]: "quotations.manage",
  [`POST ${QUOTE}/revise`]: "quotations.manage",
  [`POST ${QUOTE}/duplicate`]: "quotations.manage",
  [`POST ${QUOTE}/cancel`]: "quotations.manage",
  [`POST ${QUOTE}/share`]: "quotations.manage",
  [`POST ${QUOTE}/send`]: "quotations.manage",
  [`POST ${QUOTE}/convert`]: "quotations.manage",

  // ---- proforma invoices, sale orders, delivery challans (docs/sales-documents.md): view / manage; billing them also
  // needs invoices.create and an advance payments.receive.
  [`GET ${SD}/summary`]: "sales-docs.view",
  [`GET ${SD}/settings`]: "sales-docs.view",
  [`GET ${SD}/linked`]: "sales-docs.view",
  [`GET ${SD}/proformas`]: "sales-docs.view",
  [`GET ${PI}`]: "sales-docs.view",
  [`POST ${SD}/proformas`]: "sales-docs.manage",
  [`PATCH ${PI}`]: "sales-docs.manage",
  [`POST ${PI}/issue`]: "sales-docs.manage",
  [`POST ${PI}/cancel`]: "sales-docs.manage",
  [`POST ${PI}/share`]: "sales-docs.manage",
  [`POST ${PI}/send`]: "sales-docs.manage",
  [`POST ${PI}/advance`]: ["sales-docs.manage", "payments.receive"],
  [`POST ${PI}/convert`]: ["sales-docs.manage", "invoices.create"],
  [`GET ${SD}/sale-orders`]: "sales-docs.view",
  [`GET ${SO}`]: "sales-docs.view",
  [`POST ${SD}/sale-orders`]: "sales-docs.manage",
  [`PATCH ${SO}`]: "sales-docs.manage",
  [`POST ${SO}/cancel`]: "sales-docs.manage",
  [`POST ${SO}/share`]: "sales-docs.manage",
  [`POST ${SO}/send`]: "sales-docs.manage",
  [`POST ${SO}/advance`]: ["sales-docs.manage", "payments.receive"],
  [`POST ${SO}/deliver`]: "sales-docs.manage",
  [`POST ${SO}/invoice`]: ["sales-docs.manage", "invoices.create"],
  [`POST ${SO}/invoice-challans`]: ["sales-docs.manage", "invoices.create"],
  [`GET ${SD}/challans`]: "sales-docs.view",
  [`GET ${DC}`]: "sales-docs.view",
  [`POST ${SD}/challans`]: "sales-docs.manage",
  [`POST ${SD}/challans/invoice`]: ["sales-docs.manage", "invoices.create"],
  [`PATCH ${DC}`]: "sales-docs.manage",
  [`POST ${DC}/return`]: "sales-docs.manage",
  [`POST ${DC}/cancel`]: "sales-docs.manage",
  [`POST ${DC}/share`]: "sales-docs.manage",
  [`POST ${DC}/send`]: "sales-docs.manage",

  // ---- invoices: credit notes and POS till sessions
  [`POST ${BILL}/credit-notes`]: "invoices.credit-note",
  "POST /v1/invoices/credit-notes/:id/cancel": "invoices.credit-note",
  "POST /v1/invoices/till/open": "pos.till",
  "POST /v1/invoices/till/:id/cash": "pos.till",
  "POST /v1/invoices/till/:id/close": "pos.till",
  // Other registers' sessions.
  "GET /v1/invoices/till/sessions": "reports.view",
  [`DELETE ${BILL}/payments/:paymentId`]: "payments.receive",
  // ---- invoices: customers and credit book
  "POST /v1/invoices/customers": "customers.create",
  "PATCH /v1/invoices/customers/:id": "customers.create",
  "DELETE /v1/invoices/customers/:id": "customers.create",
  "GET /v1/invoices/credit-book": "invoices.credit-book",
  "GET /v1/invoices/customers/:id/ledger": "invoices.credit-book",
  "POST /v1/invoices/customers/:id/receipts": ["invoices.credit-book", "payments.receive"],
  "DELETE /v1/invoices/customers/:id/receipts/:receiptId": ["invoices.credit-book", "payments.receive"],
  "POST /v1/invoices/customers/:id/statement/share": "invoices.credit-book",
  "POST /v1/invoices/customers/:id/remind": "invoices.credit-book",
  // ---- invoices: saved items (a facade over the catalogue). Adding one while billing is part of making a bill.
  "POST /v1/invoices/items": "invoices.create",
  "PATCH /v1/invoices/items/:id": CATALOGUE_MANAGE,
  "DELETE /v1/invoices/items/:id": CATALOGUE_MANAGE,
  // ---- invoices: reports
  "GET /v1/invoices/reports/sales-trend": "reports.view",
  "GET /v1/invoices/reports/sales-register": "reports.view",
  "GET /v1/invoices/reports/gst-summary": "reports.view",
  "GET /v1/einvoice/gstr1": "reports.view",
  "GET /v1/einvoice/gstr1.json": "reports.view",
  "GET /v1/invoices/reports/payments": "reports.view",
  "GET /v1/invoices/reports/ageing": "reports.view",
  "GET /v1/invoices/reports/top-items": "reports.view",
  "GET /v1/invoices/reports/top-customers": "reports.view",

  // ---- inventory (the package's own mapping) + reports
  ...Object.fromEntries(
    Object.entries(INVENTORY_ROUTE_PERMISSIONS).map(([k, v]) => {
      const [method, path] = k.split(" ");
      return [`${method} /v1/inventory${path}`, v];
    }),
  ),
  "GET /v1/inventory/reports/stock": "reports.view",
  "GET /v1/inventory/reports/purchases": ["reports.view", "inventory.purchases"],
  "GET /v1/inventory/reports/payables-ageing": ["reports.view", "inventory.purchases"],
  "GET /v1/inventory/payables/summary": "inventory.purchases",

  // ---- payments (owner/admin routes already)
  "PUT /v1/payments/account": "settings.manage",
  "DELETE /v1/payments/account": "settings.manage",

  // ---- catalogue writes
  "POST /v1/catalog/categories": CATALOGUE_MANAGE,
  "PUT /v1/catalog/categories/order": CATALOGUE_MANAGE,
  "PATCH /v1/catalog/categories/:id": CATALOGUE_MANAGE,
  "DELETE /v1/catalog/categories/:id": CATALOGUE_MANAGE,
  "POST /v1/catalog/products": CATALOGUE_MANAGE,
  "PATCH /v1/catalog/products/:id": CATALOGUE_MANAGE,
  "DELETE /v1/catalog/products/:id": CATALOGUE_MANAGE,
  "POST /v1/catalog/products/:id/variants": CATALOGUE_MANAGE,
  "POST /v1/catalog/products/:id/variants/generate": CATALOGUE_MANAGE,
  "PATCH /v1/catalog/variants/:id": CATALOGUE_MANAGE,
  "DELETE /v1/catalog/variants/:id": CATALOGUE_MANAGE,

  // ---- orders (status changes are checked per target status inside the route: cancel / ship / deliver / manage)
  "POST /v1/orders/": ORDER_PERMISSIONS_KEYS.manage,
  [`POST ${ORDER}/notes`]: ORDER_PERMISSIONS_KEYS.manage,
  [`POST ${ORDER}/payments`]: ORDER_PERMISSIONS_KEYS.manage,
  [`POST ${ORDER}/fulfillment`]: ORDER_PERMISSIONS_KEYS.manage,
  [`POST ${ORDER}/invoice`]: ORDER_PERMISSIONS_KEYS.manage,
  [`POST ${ORDER}/refunds`]: ORDER_PERMISSIONS_KEYS.refund,

  // ---- coupons
  "POST /v1/coupons/": "coupons.manage",
  [`PATCH ${COUPON}`]: "coupons.manage",
  [`DELETE ${COUPON}`]: "coupons.manage",
};

/** "POST /v1/orders/" and "POST /v1/orders" are the same route (Fastify registers both for a prefixed "/"). */
const keyOf = (method: string, url: string) => `${method.toUpperCase()} ${url.length > 1 ? url.replace(/\/+$/, "") : url}`;

/** Bill lines with a discount need `invoices.discount` on create and edit. */
async function discountGuard(req: FastifyRequest) {
  const lines = (req.body as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines)) return;
  if (lines.some((l) => typeof l === "object" && l !== null && Number((l as { discount?: unknown }).discount ?? 0) > 0)) {
    requirePermission(req.ctx, "invoices.discount");
  }
}
/** `loyaltyPoints` on a bill or a staff order needs `loyalty.redeem`. */
async function loyaltyGuard(req: FastifyRequest) {
  const points = (req.body as { loyaltyPoints?: unknown } | null)?.loyaltyPoints;
  if (points !== undefined && points !== null && Number(points) > 0) requirePermission(req.ctx, "loyalty.redeem");
}
/** Making a bill or an order from a quotation needs the permission to make one; recording the advance needs payments.receive. */
async function convertGuard(req: FastifyRequest) {
  const b = (req.body ?? {}) as { to?: unknown; recordAdvance?: unknown };
  requirePermission(
    req.ctx,
    b.to === "order" ? ORDER_PERMISSIONS_KEYS.manage : b.to === "proforma" || b.to === "sale_order" ? "sales-docs.manage" : "invoices.create",
  );
  if (b.recordAdvance === true) requirePermission(req.ctx, "payments.receive");
}
const both =
  (...guards: ((req: FastifyRequest) => Promise<void>)[]) =>
  async (req: FastifyRequest) => {
    for (const g of guards) await g(req);
  };
export const ROUTE_GUARDS: Record<string, (req: FastifyRequest) => Promise<void>> = {
  "POST /v1/invoices/": both(discountGuard, loyaltyGuard),
  [`PATCH ${BILL}`]: both(discountGuard, loyaltyGuard),
  [`POST ${BILL}/issue`]: loyaltyGuard,
  [`POST ${QUOTE}/convert`]: convertGuard,
  // A discount on a quotation is a promise to the customer: same permission as on a bill.
  "POST /v1/quotations/": discountGuard,
  [`PATCH ${QUOTE}`]: discountGuard,
  [`POST ${QUOTE}/revise`]: discountGuard,
  // Discounts on a proforma, sale order or challan: same permission as on a bill.
  [`POST ${SD}/proformas`]: discountGuard,
  [`PATCH ${PI}`]: discountGuard,
  [`POST ${SD}/sale-orders`]: discountGuard,
  [`PATCH ${SO}`]: discountGuard,
  [`POST ${SD}/challans`]: discountGuard,
  "POST /v1/orders/": loyaltyGuard,
};

/** The routes that set bill lines, where discount limits apply (discount-guard.ts). */
export const DISCOUNT_LIMIT_ROUTES = ["POST /v1/invoices/", `PATCH ${BILL}`] as const;
/** The existing guards of those routes followed by the discount-limit guard (permission first, then the limit). */
export function withDiscountLimits(base: Record<string, (req: FastifyRequest) => Promise<void>>, limit: (req: FastifyRequest) => Promise<void>) {
  return Object.fromEntries(DISCOUNT_LIMIT_ROUTES.map((k) => [k, both(...(base[k] ? [base[k]!] : []), limit)])) as Record<string, (req: FastifyRequest) => Promise<void>>;
}

/**
 * Fixed-window counter per key (in-memory, per API instance — enough to stop a script hammering one form; put a shared
 * limiter in front for multi-instance deployments). `hit` returns false once `limit` hits happened within `windowMs`.
 */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  hit(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 50_000) this.hits.clear();
    return true;
  }
}

/**
 * Guest tickets (`POST /v1/support/public/tickets` with an OTP-verified guest token, no account): at most 5 an hour per
 * verified phone and 20 an hour per IP address (higher, as an office or a mobile carrier's NAT shares one address).
 * 429 `rate_limited` otherwise. Unverifiable tokens aren't counted (the route answers 401); signed-in requesters are
 * not limited here.
 */
export function guestTicketGuard(
  phoneOf: (tenantId: string, token: string) => { phone: string } | null,
  opts = { perPhone: 5, perIp: 20, windowMs: 3_600_000 },
) {
  const byPhone = new WindowLimiter(opts.perPhone, opts.windowMs);
  const byIp = new WindowLimiter(opts.perIp, opts.windowMs);
  return async (req: FastifyRequest) => {
    if (req.ctx.user || !req.ctx.tenant) return;
    const h = req.headers["x-guest-token"];
    const token = (Array.isArray(h) ? h[0] : h)?.trim();
    const phone = token ? phoneOf(req.ctx.tenant.id, token)?.phone : null;
    if (!phone) return; // the route answers 401
    const tooMany = () => new AppError(429, "rate_limited", "Too many tickets from this number; please try again in an hour");
    if (!byPhone.hit(`${req.ctx.tenant.id}:${phone}`)) throw tooMany();
    if (req.ctx.ip && !byIp.hit(`${req.ctx.tenant.id}:${req.ctx.ip}`)) throw tooMany();
  };
}

/**
 * Registers an `onRoute` hook that copies `ROUTE_PERMISSIONS` into each matching route's `config.permission` and adds
 * the body guards. Call before the modules are mounted; afterwards `assertAllMatched()` throws when a key matched no
 * route (a renamed route would otherwise silently lose its permission).
 */
export function routePermissions(map: Record<string, string | string[]> = ROUTE_PERMISSIONS, guards = ROUTE_GUARDS) {
  const norm = <T>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).map(([k, v]) => {
    const i = k.indexOf(" ");
    return [keyOf(k.slice(0, i), k.slice(i + 1)), v];
  })) as Record<string, T>;
  map = norm(map);
  guards = norm(guards);
  const seen = new Set<string>();
  return {
    register(app: FastifyInstance) {
      app.addHook("onRoute", (route: RouteOptions) => {
        for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
          const key = keyOf(method, route.url);
          const permission = map[key];
          if (permission) {
            seen.add(key);
            const existing = route.config?.permission;
            const merged = [...new Set([...(existing ? [existing].flat() : []), ...[permission].flat()])];
            route.config = { ...(route.config ?? {}), permission: merged };
          }
          const guard = guards[key];
          if (guard) {
            seen.add(key);
            const pre = route.preHandler ? [route.preHandler].flat() : [];
            route.preHandler = [...pre, guard];
          }
        }
      });
    },
    assertAllMatched() {
      const missing = [...new Set([...Object.keys(map), ...Object.keys(guards)])].filter((k) => !seen.has(k));
      if (missing.length) throw new Error(`Route permissions for unknown routes: ${missing.join(", ")}`);
    },
  };
}
