import { forbidden, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { csvDisposition, rupees, toCsv } from "./csv";
import { MARKETPLACE_FEATURE, MARKETPLACE_PERMISSIONS_KEYS, PAYOUTS_FEATURE } from "./features";
import type { VendorUserRole } from "./logic";
import type { VendorRow } from "./schema";
import type {
  AdjustmentInput,
  ApplyInput,
  LedgerEntry,
  LedgerListQuery,
  MarketplaceService,
  Payout,
  PayoutListQuery,
  ProfilePatch,
  ReviewListQuery,
  ShipInput,
  StockAdjustInput,
  VendorInput,
  VendorListQuery,
  VendorOrder,
  VendorOrderListQuery,
  VendorPatch,
} from "./service";

/** Header naming the seller (id or slug) when a user belongs to several. */
export const VENDOR_HEADER = "x-vendor";

const ID = ":id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const variantParam = z.object({ variantId: z.string().uuid() });
const userParam = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
const slugParam = z.object({ slug: z.string().min(1).max(80) });
const commissionBody = z.object({ commissionBps: z.number().int().min(0).max(10_000).nullable() });
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().max(100).optional(),
});
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
const userOf = (req: { ctx: RequestContext }) => requireUser(req.ctx).id;
const isCsv = (req: { query: unknown }) => query(req).format === "csv";

const feature = (key: string | string[]) => ({ config: { feature: key } });
/** Seller writes the host's audit hook records with an explicit action (sellers hold no shop role). */
const sellerWrite = (key: string | string[], action: string, entity: string, idParam: string) => ({
  config: { feature: key, audit: { action, entity, idParam } },
});
/** Seller stock needs the shop's inventory feature too. */
const STOCK_FEATURES = [MARKETPLACE_FEATURE, "inventory"];
const MANAGE = MARKETPLACE_PERMISSIONS_KEYS.manage;
const staffRoute = (key: string = MARKETPLACE_FEATURE) => ({ config: { feature: key, permission: MANAGE } });

/** Rows exported with `format=csv` (the first 500 matching). */
const CSV_LIMIT = { limit: 500, offset: 0 };

const fmtDate = (d: Date | null) => (d ? d.toISOString() : "");

export function vendorOrdersCsv(items: VendorOrder[]) {
  return toCsv(
    ["Order", "Seller", "Placed", "Status", "Settlement", "Subtotal", "Discount", "Shipping share", "Commission", "Net", "Payable from"],
    items.map((o) => [
      o.orderNumber,
      o.vendorName ?? "",
      fmtDate(o.placedAt),
      o.status,
      o.settlementStatus,
      rupees(o.subtotal),
      rupees(o.discount),
      rupees(o.shippingShare),
      rupees(o.commission),
      rupees(o.net),
      fmtDate(o.eligibleAt),
    ]),
  );
}

export function ledgerCsv(items: LedgerEntry[]) {
  return toCsv(
    ["Date", "Seller", "Type", "Amount", "Note"],
    items.map((e) => [fmtDate(e.createdAt), e.vendorName ?? "", e.type, rupees(e.amount), e.note ?? ""]),
  );
}

export function payoutsCsv(items: Payout[]) {
  return toCsv(
    ["Created", "Seller", "Amount", "Status", "Provider", "Reference", "Period from", "Period to", "Paid at", "Error"],
    items.map((p) => [
      fmtDate(p.createdAt),
      p.vendorName ?? "",
      rupees(p.amount),
      p.status,
      p.provider,
      p.providerRef ?? "",
      fmtDate(p.periodFrom),
      fmtDate(p.periodTo),
      fmtDate(p.paidAt),
      p.error ?? "",
    ]),
  );
}

const sendCsv = (reply: FastifyReply, name: string, csv: string) =>
  reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", csvDisposition(name)).send(csv);

/**
 * Routes under /v1/marketplace.
 * - Public (tenant from host / x-tenant; feature `marketplace`): `GET /public/vendors/:slug`;
 *   `POST /public/vendors/apply` (signed-in user).
 * - Seller (signed-in member of a seller; `x-vendor` when several, else 403): `GET /vendor/mine`, `GET /vendor/me`,
 *   `PATCH /vendor/profile`, `PUT /vendor/payout-account` (owner), `GET /vendor/orders|ledger|products`,
 *   `GET /vendor/payouts` (`marketplace.payouts`), `GET /vendor/product-reviews`, `GET /vendor/stock` +
 *   `POST /vendor/stock/:variantId/adjust` (feature `inventory` too), `POST /vendor/orders/:id/packed|shipped`.
 *   Everything is limited to the seller's own products, variants and orders (others 404).
 * - Staff (owner/admin/staff with `marketplace.manage`): vendors CRUD, approve/suspend, commission, payout account,
 *   seller users, `GET /vendor-orders`, `GET /ledger`, adjustments, payouts (`marketplace.payouts`), product review
 *   queue (`GET /product-reviews`, `POST /product-reviews/:id/approve|reject`).
 * Lists accept `format=csv` where noted.
 */
export function marketplaceRoutes(service: MarketplaceService) {
  return async (app: FastifyInstance) => {
    // ---- public
    app.get("/public/vendors/:slug", feature(MARKETPLACE_FEATURE), async (req) => {
      const { slug } = slugParam.parse(req.params);
      const q = pageQuery.parse(req.query ?? {});
      return service.publicVendor(tenantOf(req), slug, q);
    });
    // Storefront "Sold by": `?ids=<seller uuid,…>&productIds=<product uuid,…>` (comma-separated or repeated).
    app.get("/public/sellers", feature(MARKETPLACE_FEATURE), async (req) => {
      const q = query(req) as Record<string, string | string[] | undefined>;
      const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(",")).filter(Boolean);
      return service.publicSellers(tenantOf(req), { ids: list(q.ids), productIds: list(q.productIds) });
    });
    app.post("/public/vendors/apply", feature(MARKETPLACE_FEATURE), async (req) => {
      const userId = userOf(req);
      return service.apply(tenantOf(req), userId, body(req) as ApplyInput);
    });

    // ---- seller (vendor users)
    await app.register(async (seller) => {
      const scopes = new WeakMap<FastifyRequest, { vendor: VendorRow; role: VendorUserRole }>();
      seller.addHook("preHandler", async (req) => {
        const user = requireUser(req.ctx);
        const tenant = requireTenant(req.ctx);
        if (req.routeOptions.url?.endsWith("/vendor/mine")) return;
        scopes.set(req, await service.resolveVendor(tenant.id, user.id, header(req.headers[VENDOR_HEADER])));
      });
      const scope = (req: FastifyRequest) => {
        const s = scopes.get(req);
        if (!s) throw forbidden("You're not a seller in this shop");
        return s;
      };

      seller.get("/vendor/mine", feature(MARKETPLACE_FEATURE), async (req) => {
        const items = await service.memberships(tenantOf(req), userOf(req));
        return { items, total: items.length };
      });
      seller.get("/vendor/me", feature(MARKETPLACE_FEATURE), async (req) => {
        const { vendor, role } = scope(req);
        return service.vendorSelf(tenantOf(req), vendor, role);
      });
      seller.patch("/vendor/profile", feature(MARKETPLACE_FEATURE), async (req) => {
        const { vendor, role } = scope(req);
        return service.updateProfile(tenantOf(req), vendor, role, body(req) as ProfilePatch);
      });
      seller.put("/vendor/payout-account", feature(MARKETPLACE_FEATURE), async (req) => {
        const { vendor, role } = scope(req);
        if (role !== "owner") throw forbidden("Only the seller's owner can change the payout account");
        if (vendor.status === "suspended") throw forbidden("This seller account is suspended");
        return service.setPayoutAccount(tenantOf(req), vendor.id, body(req), "vendor");
      });
      seller.get("/vendor/orders", feature(MARKETPLACE_FEATURE), async (req, reply) => {
        const { vendor } = scope(req);
        const q = { ...query(req), vendorId: vendor.id } as VendorOrderListQuery;
        if (!isCsv(req)) return service.listVendorOrders(tenantOf(req), q);
        const r = await service.listVendorOrders(tenantOf(req), { ...q, ...CSV_LIMIT });
        return sendCsv(reply, "seller-orders", vendorOrdersCsv(r.items));
      });
      seller.get("/vendor/ledger", feature(MARKETPLACE_FEATURE), async (req, reply) => {
        const { vendor } = scope(req);
        const q = { ...query(req), vendorId: vendor.id } as LedgerListQuery;
        if (!isCsv(req)) return service.listLedger(tenantOf(req), q);
        const r = await service.listLedger(tenantOf(req), { ...q, ...CSV_LIMIT });
        return sendCsv(reply, "seller-ledger", ledgerCsv(r.items));
      });
      seller.get("/vendor/payouts", feature(PAYOUTS_FEATURE), async (req) => {
        const { vendor } = scope(req);
        return service.listPayouts(tenantOf(req), { ...query(req), vendorId: vendor.id } as PayoutListQuery);
      });
      seller.get("/vendor/products", feature(MARKETPLACE_FEATURE), async (req) => {
        const { vendor } = scope(req);
        return service.vendorProducts(tenantOf(req), vendor.id, pageQuery.parse(req.query ?? {}));
      });
      // Review status of the seller's own products (`?productIds=a,b`, `?status=`).
      seller.get("/vendor/product-reviews", feature(MARKETPLACE_FEATURE), async (req) => {
        const { vendor } = scope(req);
        return service.listProductReviews(tenantOf(req), { ...(query(req) as ReviewListQuery), vendorId: vendor.id });
      });
      // Stock of the seller's own variants (`?productIds=`) at their location.
      seller.get("/vendor/stock", feature(STOCK_FEATURES), async (req) => {
        const { vendor } = scope(req);
        return service.vendorStock(tenantOf(req), vendor, query(req) as { productIds?: string });
      });
      seller.post(
        "/vendor/stock/:variantId/adjust",
        sellerWrite(STOCK_FEATURES, "marketplace.vendor_stock.adjust", "stock_item", "variantId"),
        async (req) => {
          const { vendor } = scope(req);
          const { variantId } = variantParam.parse(req.params);
          const b = body(req) as StockAdjustInput;
          const r = await service.adjustVendorStock(tenantOf(req), vendor, variantId, b, userOf(req));
          req.auditSummary = `Seller ${vendor.name}: ${b.mode} ${b.qty} (${String(b.reason ?? "").slice(0, 80)})`;
          req.auditDetail = { before: { qty: r.before, locationId: r.locationId }, after: { qty: r.item.qty, vendorId: vendor.id } };
          return r;
        },
      );
      seller.post(
        `/vendor/orders/${ID}/packed`,
        sellerWrite(MARKETPLACE_FEATURE, "marketplace.vendor_order.packed", "vendor_order", "id"),
        async (req) => {
          const { vendor } = scope(req);
          const { id } = idParam.parse(req.params);
          return service.markFulfilment(tenantOf(req), vendor, id, "packed", {}, userOf(req));
        },
      );
      seller.post(
        `/vendor/orders/${ID}/shipped`,
        sellerWrite(MARKETPLACE_FEATURE, "marketplace.vendor_order.shipped", "vendor_order", "id"),
        async (req) => {
          const { vendor } = scope(req);
          const { id } = idParam.parse(req.params);
          return service.markFulfilment(tenantOf(req), vendor, id, "shipped", body(req) as ShipInput, userOf(req));
        },
      );
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
        // The host checks config.permission too; repeated here so the module is safe on its own.
        const p = req.routeOptions.config?.permission;
        if (p) requirePermission(req.ctx, ...(Array.isArray(p) ? p : [p]));
      });

      staff.get("/vendors", staffRoute(), async (req) => service.listVendors(tenantOf(req), query(req) as VendorListQuery));
      staff.post("/vendors", staffRoute(), async (req) => service.createVendor(tenantOf(req), body(req) as VendorInput));
      staff.get(`/vendors/${ID}`, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getVendor(tenantOf(req), id);
      });
      staff.patch(`/vendors/${ID}`, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateVendor(tenantOf(req), id, body(req) as VendorPatch);
      });
      staff.delete(`/vendors/${ID}`, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteVendor(tenantOf(req), id);
        return { ok: true };
      });
      staff.post(`/vendors/${ID}/approve`, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.setVendorStatus(tenantOf(req), id, "active");
      });
      staff.post(`/vendors/${ID}/suspend`, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.setVendorStatus(tenantOf(req), id, "suspended");
      });
      staff.put(`/vendors/${ID}/commission`, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        const { commissionBps } = commissionBody.parse(body(req));
        return service.updateVendor(tenantOf(req), id, { commissionBps });
      });
      staff.put(`/vendors/${ID}/payout-account`, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.setPayoutAccount(tenantOf(req), id, body(req), "staff");
      });
      staff.post(`/vendors/${ID}/users`, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.addVendorUser(tenantOf(req), id, body(req) as { userId: string });
      });
      staff.delete(`/vendors/${ID}/users/:userId`, staffRoute(), async (req) => {
        const { id, userId } = userParam.parse(req.params);
        return service.removeVendorUser(tenantOf(req), id, userId);
      });
      staff.post(`/vendors/${ID}/adjustments`, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.adjust(tenantOf(req), id, body(req) as AdjustmentInput, userOf(req));
      });

      // Products to review (seller products waiting to go live).
      staff.get("/product-reviews", staffRoute(), async (req) => service.listProductReviews(tenantOf(req), query(req) as ReviewListQuery));
      staff.post(`/product-reviews/${ID}/approve`, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.approveProductReview(tenantOf(req), id, userOf(req));
      });
      staff.post(`/product-reviews/${ID}/reject`, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.rejectProductReview(tenantOf(req), id, body(req) as { reason?: string }, userOf(req));
      });

      staff.get("/vendor-orders", staffRoute(), async (req, reply) => {
        const q = query(req) as VendorOrderListQuery;
        if (!isCsv(req)) return service.listVendorOrders(tenantOf(req), q);
        const r = await service.listVendorOrders(tenantOf(req), { ...q, ...CSV_LIMIT });
        return sendCsv(reply, "seller-orders", vendorOrdersCsv(r.items));
      });
      staff.get("/ledger", staffRoute(), async (req, reply) => {
        const q = query(req) as LedgerListQuery;
        if (!isCsv(req)) return service.listLedger(tenantOf(req), q);
        const r = await service.listLedger(tenantOf(req), { ...q, ...CSV_LIMIT });
        return sendCsv(reply, "seller-ledger", ledgerCsv(r.items));
      });

      staff.get("/payouts", staffRoute(PAYOUTS_FEATURE), async (req, reply) => {
        const q = query(req) as PayoutListQuery;
        if (!isCsv(req)) return service.listPayouts(tenantOf(req), q);
        const r = await service.listPayouts(tenantOf(req), { ...q, ...CSV_LIMIT });
        return sendCsv(reply, "seller-payouts", payoutsCsv(r.items));
      });
      staff.post("/payouts/run", staffRoute(PAYOUTS_FEATURE), async (req) =>
        service.runPayouts(tenantOf(req), body(req) as { until?: string; vendorId?: string }, userOf(req)),
      );
      staff.post(`/payouts/${ID}/retry`, staffRoute(PAYOUTS_FEATURE), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.retryPayout(tenantOf(req), id);
      });
      staff.post(`/payouts/${ID}/mark-paid`, staffRoute(PAYOUTS_FEATURE), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.markPayoutPaid(tenantOf(req), id, body(req) as { reference: string });
      });
      staff.post(`/payouts/${ID}/cancel`, staffRoute(PAYOUTS_FEATURE), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.cancelPayout(tenantOf(req), id, userOf(req));
      });
      staff.post(`/payouts/${ID}/refresh`, staffRoute(PAYOUTS_FEATURE), async (req) => {
        const { id } = idParam.parse(req.params);
        const items = await service.refreshPayouts(tenantOf(req), id);
        return { items, total: items.length };
      });
    });
  };
}
