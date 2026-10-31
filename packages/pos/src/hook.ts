import { AppError } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import type { PosTenantsPort } from "./ports";
import type { PosService } from "./service";

export const DEVICE_HEADER = "x-device-token";

/** `POST /v1/pos/pair` ignores a stale device token (the device is pairing again). */
const isPairRoute = (method: string, url: string) => method === "POST" && /^\/v1\/pos\/pair(?:[?#]|$)/.test(url);

/**
 * Fills `req.ctx.device` from the `x-device-token` header. MUST be registered AFTER the tenancy hook and BEFORE auth
 * (auth accepts a terminal-bound PIN session only with `ctx.device`; branches reads `ctx.device.branchId`):
 * `contextHooks: [tenancy.contextHook, pos.deviceHook, …, auth.contextHook, branches.contextHook]`.
 * - no header → `ctx.device = null`;
 * - unknown / revoked token → 401 `device_not_paired`;
 * - no shop resolved yet → the terminal's shop becomes `ctx.tenant`; a different shop (x-tenant / host) → 403
 *   `device_shop_mismatch`.
 */
export function deviceContextHook(service: PosService, tenants: PosTenantsPort) {
  return (app: FastifyInstance) => {
    app.addHook("onRequest", async (req) => {
      req.ctx.device = null;
      const raw = req.headers[DEVICE_HEADER];
      const token = (Array.isArray(raw) ? raw[0] : raw)?.trim();
      if (!token || isPairRoute(req.method, req.url)) return;
      const row = await service.deviceFor(token);
      if (!row) throw new AppError(401, "device_not_paired", "This device is not paired with a terminal");
      if (req.ctx.tenant) {
        if (req.ctx.tenant.id !== row.tenantId) throw new AppError(403, "device_shop_mismatch", "This device is paired with another shop");
      } else {
        const tenant = await tenants.ref(row.tenantId);
        if (!tenant) throw new AppError(401, "device_not_paired", "This device is not paired with a terminal");
        req.ctx.tenant = tenant;
      }
      req.ctx.device = { terminalId: row.id, role: row.role, branchId: row.branchId, locationId: row.locationId };
    });
  };
}
