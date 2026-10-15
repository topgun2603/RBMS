import { isSuperAdmin, permissionDenied, permissionsAllow, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { csvDisposition, ordersCsv } from "./csv";
import { ORDER_FEATURES_KEYS, ORDER_PERMISSIONS_KEYS } from "./features";
import type {
  FulfillmentInput,
  ManualOrderInput,
  NoteInput,
  OrderListQuery,
  OrderPaymentInput,
  OrdersService,
  RefundInput,
  StatusInput,
} from "./service";

const idParam = z.object({ id: z.string().uuid() });
/** Order routes only match UUID-shaped ids, so /summary and unknown paths never reach them. */
const ID = "/:id([0-9a-fA-F-]{36})";
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const FEATURE = { config: { feature: ORDER_FEATURES_KEYS.base } };

/**
 * Checks that the user holds at least one of `keys` once the staff module fills `user.permissions`
 * (docs/commerce-batch1.md §5); patterns such as `orders.*` count. Until then (no permissions on the user) the base
 * role check is all there is. Throws 403 `permission_denied` `{ permission }` (the first key).
 */
export function requirePermission(ctx: RequestContext, ...keys: [string, ...string[]]): void {
  const user = requireUser(ctx);
  if (isSuperAdmin(ctx)) return;
  const perms = (user as { permissions?: string[] }).permissions;
  if (!perms) return;
  if (keys.some((k) => permissionsAllow(perms, k))) return;
  throw permissionDenied(keys[0]);
}

/** Who may move an order to `status`: cancel needs orders.cancel; shipped/delivered also accept the Delivery role's keys. */
export function statusPermissions(status: unknown): [string, ...string[]] {
  if (status === "cancelled") return [ORDER_PERMISSIONS_KEYS.cancel];
  if (status === "shipped") return [ORDER_PERMISSIONS_KEYS.manage, ORDER_PERMISSIONS_KEYS.ship];
  if (status === "delivered") return [ORDER_PERMISSIONS_KEYS.manage, ORDER_PERMISSIONS_KEYS.deliver];
  return [ORDER_PERMISSIONS_KEYS.manage];
}

/**
 * Routes under /v1/orders (staff: owner, admin or staff member; feature `orders`). Returns additionally need
 * `orders.returns` (checked by the service). `GET /` accepts `format=csv` and filters (`status`, `paymentStatus`,
 * `channel`, `branchId`, `q`, `from`, `to`).
 */
export function ordersRoutes(service: OrdersService) {
  return async (app: FastifyInstance) => {
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });
      const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
      const userOf = (req: { ctx: RequestContext }) => requireUser(req.ctx).id;

      staff.get("/", FEATURE, async (req, reply) => {
        const q = query(req);
        const { format } = formatQuery.parse(q);
        const { format: _f, ...filters } = q;
        if (format !== "csv") return service.list(tenantOf(req), filters as OrderListQuery);
        const result = await service.list(tenantOf(req), { ...filters, limit: 500, offset: 0 } as OrderListQuery);
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", csvDisposition("orders", q.from, q.to))
          .send(ordersCsv(result.items));
      });
      staff.get("/summary", FEATURE, async (req) => service.summary(tenantOf(req)));
      staff.post("/", FEATURE, async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.manage);
        // Multi-branch shops: the order belongs to the request's branch and reserves at its stock location (unless the body names one).
        const branch = req.ctx.branch ?? null;
        return service.create(tenantOf(req), body(req) as ManualOrderInput, userOf(req), {
          branchId: branch?.id ?? null,
          locationId: branch?.locationId ?? null,
        });
      });
      staff.get(ID, FEATURE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.get(tenantOf(req), id);
      });
      staff.post(`${ID}/status`, FEATURE, async (req) => {
        const { id } = idParam.parse(req.params);
        const b = body(req) as StatusInput;
        requirePermission(req.ctx, ...statusPermissions(b.status));
        return service.updateStatus(tenantOf(req), id, b, userOf(req));
      });
      staff.post(`${ID}/notes`, FEATURE, async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.manage);
        const { id } = idParam.parse(req.params);
        return service.addNote(tenantOf(req), id, body(req) as NoteInput, userOf(req));
      });
      staff.post(`${ID}/payments`, FEATURE, async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.manage);
        const { id } = idParam.parse(req.params);
        return service.addPayment(tenantOf(req), id, body(req) as OrderPaymentInput, userOf(req));
      });
      staff.post(`${ID}/refunds`, FEATURE, async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.refund);
        const { id } = idParam.parse(req.params);
        return service.addRefund(tenantOf(req), id, body(req) as RefundInput, userOf(req));
      });
      staff.post(`${ID}/fulfillment`, FEATURE, async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.manage);
        const { id } = idParam.parse(req.params);
        return service.updateFulfillment(tenantOf(req), id, body(req) as FulfillmentInput, userOf(req));
      });
      staff.post(`${ID}/invoice`, FEATURE, async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.manage);
        const { id } = idParam.parse(req.params);
        return service.retryInvoice(tenantOf(req), id, userOf(req));
      });
    });
  };
}
