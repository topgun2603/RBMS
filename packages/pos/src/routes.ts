import { createHash } from "node:crypto";
import {
  AppError,
  documented,
  hasPermission,
  permissionDenied,
  requireRole,
  requireTenant,
  requireUser,
  type DeviceRef,
  type RequestContext,
} from "@srirealtime/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  catalogQuery,
  catalogResponse,
  categoriesResponse,
  codeParams,
  deviceResponse,
  idParams,
  okSchema,
  pairBody,
  pairingSchema,
  pairResponse,
  pinBody,
  pinListResponse,
  pinSessionResponse,
  staffListResponse,
  terminalCreateBody,
  terminalCreateResponse,
  terminalListResponse,
  terminalPatchBody,
  terminalSchema,
  useTicketBody,
  userParams,
  weighTicketBody,
  weighTicketListQuery,
  weighTicketListResponse,
  weighTicketSchema,
} from "./api-schemas";
import { POS_FEATURE_KEYS, POS_PERMISSION_KEYS } from "./ports";
import type { Actor, PosService } from "./service";

const TERMINALS = POS_FEATURE_KEYS.terminals;
const WEIGHING = POS_FEATURE_KEYS.weighing;
/** These routes record their own audit entries (many have no user yet). */
const SELF = { audit: false as const };

const actorOf = (req: FastifyRequest): Actor => ({ userId: req.ctx.user?.id ?? null, ip: req.ctx.ip, userAgent: req.ctx.userAgent });

/** The paired terminal of the request; 401 `device_not_paired` without one. */
export function requireDevice(ctx: RequestContext): DeviceRef {
  if (!ctx.device) throw new AppError(401, "device_not_paired", "This request needs a paired device (x-device-token)");
  return ctx.device;
}

/** A shop member who holds any of `keys` (owners / admins hold all). */
function requireAny(ctx: RequestContext, ...keys: string[]) {
  const user = requireRole(ctx, "owner", "admin", "staff");
  requireTenant(ctx);
  if (!keys.some((k) => hasPermission(ctx, k))) throw permissionDenied(keys[0]!);
  return user;
}

/** Routes under /v1/pos (docs/pos-terminals.md). */
export function posRoutes(service: PosService) {
  return (app: FastifyInstance) => {
    // ---------------------------------------------------------------- terminals (managers)
    const manage = { feature: TERMINALS, permission: POS_PERMISSION_KEYS.devices, ...SELF };

    app.get("/terminals", documented({ response: terminalListResponse }, { feature: TERMINALS, permission: POS_PERMISSION_KEYS.devices }), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      return service.listTerminals(requireTenant(req.ctx));
    });
    app.post("/terminals", documented({ body: terminalCreateBody, response: terminalCreateResponse }, manage), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      return service.createTerminal(requireTenant(req.ctx), req.body, actorOf(req));
    });
    app.patch("/terminals/:id", documented({ body: terminalPatchBody, response: terminalSchema }, manage), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      const { id } = idParams.parse(req.params);
      return service.updateTerminal(requireTenant(req.ctx).id, id, req.body, actorOf(req));
    });
    app.post("/terminals/:id/pairing-code", documented({ response: pairingSchema }, manage), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      const { id } = idParams.parse(req.params);
      return service.newPairingCode(requireTenant(req.ctx).id, id, actorOf(req));
    });
    app.delete("/terminals/:id/device", documented({ response: terminalSchema }, manage), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      const { id } = idParams.parse(req.params);
      return service.unpairTerminal(requireTenant(req.ctx).id, id, actorOf(req));
    });
    app.delete("/terminals/:id", documented({ response: okSchema }, manage), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      const { id } = idParams.parse(req.params);
      return service.deleteTerminal(requireTenant(req.ctx), id, actorOf(req));
    });

    // ---------------------------------------------------------------- pairing (public)
    app.post("/pair", documented({ body: pairBody, response: pairResponse }, SELF), async (req) => service.pair(req.body, actorOf(req)));

    // ---------------------------------------------------------------- the device (x-device-token)
    const deviceCfg = { feature: TERMINALS, ...SELF };
    app.get("/device", documented({ response: deviceResponse }, { feature: TERMINALS }), async (req) => {
      const device = requireDevice(req.ctx);
      return service.deviceInfo(requireTenant(req.ctx).id, device);
    });
    app.post("/device/unpair", documented({ response: okSchema }, SELF), async (req) => {
      const device = requireDevice(req.ctx);
      return service.deviceUnpair(requireTenant(req.ctx).id, device, actorOf(req));
    });
    app.post("/session", documented({ body: pinBody, response: pinSessionResponse }, deviceCfg), async (req) => {
      const device = requireDevice(req.ctx);
      const { pin } = pinBody.parse(req.body);
      return service.pinLogin(requireTenant(req.ctx), device, pin, actorOf(req));
    });
    app.post("/session/lock", documented({ response: okSchema }, deviceCfg), async (req) => {
      const device = requireDevice(req.ctx);
      const user = requireUser(req.ctx);
      return service.lock(requireTenant(req.ctx).id, device, user.sessionId, actorOf(req));
    });
    app.get("/staff", documented({ response: staffListResponse }, { feature: TERMINALS }), async (req) => {
      requireDevice(req.ctx);
      return service.staffForLock(requireTenant(req.ctx).id);
    });

    // ---------------------------------------------------------------- staff PINs
    app.put("/pins/me", documented({ body: pinBody, response: okSchema }, { feature: TERMINALS, ...SELF }), async (req) => {
      const user = requireRole(req.ctx, "owner", "admin", "staff");
      const { pin } = pinBody.parse(req.body);
      return service.setPin(requireTenant(req.ctx).id, user.id, pin, actorOf(req));
    });
    app.get("/pins", documented({ response: pinListResponse }, { feature: TERMINALS, permission: POS_PERMISSION_KEYS.devices }), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      return service.listPins(requireTenant(req.ctx).id);
    });
    app.put("/pins/:userId", documented({ body: pinBody, response: okSchema }, manage), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      const { userId } = userParams.parse(req.params);
      const { pin } = pinBody.parse(req.body);
      return service.setPin(requireTenant(req.ctx).id, userId, pin, actorOf(req));
    });
    app.delete("/pins/:userId", documented({ response: okSchema }, { feature: TERMINALS, ...SELF }), async (req) => {
      const user = requireRole(req.ctx, "owner", "admin", "staff");
      const { userId } = userParams.parse(req.params);
      if (userId !== user.id && !hasPermission(req.ctx, POS_PERMISSION_KEYS.devices)) throw permissionDenied(POS_PERMISSION_KEYS.devices);
      return service.deletePin(requireTenant(req.ctx).id, userId, actorOf(req));
    });

    // ---------------------------------------------------------------- catalogue (PIN session on a device, or a staff session)
    app.get("/catalog", documented({ query: catalogQuery, response: catalogResponse }), async (req, reply) => {
      requireAny(req.ctx, "invoices.create", POS_PERMISSION_KEYS.weigh, "catalogue.view");
      const page = await service.catalog(requireTenant(req.ctx).id, req.query as never);
      const etag = `"${createHash("sha1").update(JSON.stringify(page)).digest("base64url")}"`;
      reply.header("etag", etag);
      reply.header("cache-control", "private, no-cache");
      if (req.headers["if-none-match"] === etag) return reply.code(304).send();
      return page;
    });
    app.get("/catalog/categories", documented({ response: categoriesResponse }), async (req) => {
      requireAny(req.ctx, "invoices.create", POS_PERMISSION_KEYS.weigh, "catalogue.view");
      return { items: await service.categories(requireTenant(req.ctx).id) };
    });

    // ---------------------------------------------------------------- weigh tickets
    app.post("/weigh-tickets", documented({ body: weighTicketBody, response: weighTicketSchema }, { feature: WEIGHING, permission: POS_PERMISSION_KEYS.weigh }), async (req) => {
      const device = requireDevice(req.ctx);
      const user = requireRole(req.ctx, "owner", "admin", "staff");
      return service.createTicket(requireTenant(req.ctx).id, device, user.id, req.body);
    });
    app.get("/weigh-tickets", documented({ query: weighTicketListQuery, response: weighTicketListResponse }, { feature: WEIGHING }), async (req) => {
      requireAny(req.ctx, POS_PERMISSION_KEYS.weigh, "invoices.create");
      // A device sees its own terminal's tickets; a staff session without a device sees every terminal's.
      return service.listTickets(requireTenant(req.ctx).id, req.ctx.device?.terminalId ?? null, req.query);
    });
    app.get("/weigh-tickets/by-code/:code", documented({ response: weighTicketSchema }, { feature: WEIGHING }), async (req) => {
      requireAny(req.ctx, "invoices.create", POS_PERMISSION_KEYS.weigh);
      const { code } = codeParams.parse(req.params);
      return service.ticketByCode(requireTenant(req.ctx).id, code);
    });
    app.post("/weigh-tickets/:id/use", documented({ body: useTicketBody, response: weighTicketSchema }, { feature: WEIGHING, permission: "invoices.create" }), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      const { id } = idParams.parse(req.params);
      return service.useTicket(requireTenant(req.ctx).id, id, req.body);
    });
    app.post("/weigh-tickets/:id/cancel", documented({ response: weighTicketSchema }, { feature: WEIGHING }), async (req) => {
      requireAny(req.ctx, POS_PERMISSION_KEYS.weigh, "invoices.create");
      const { id } = idParams.parse(req.params);
      return service.cancelTicket(requireTenant(req.ctx).id, id);
    });
  };
}
