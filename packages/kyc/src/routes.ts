import { requireSuperAdmin, requireTenant, requireUser } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { KYC_FEATURE } from "./features";
import { SUBJECT_TYPES } from "./schema";
import { documentSchema, submitCheckSchema, type KycService } from "./service";

const idParam = z.object({ id: z.string().uuid() });
const subjectParams = z.object({ type: z.enum(SUBJECT_TYPES), id: z.string().uuid() });
const reviewQuery = z.object({
  tenantId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const approveBody = z.object({ reason: z.string().trim().max(500).optional() });
const rejectBody = z.object({ reason: z.string().trim().min(1).max(500) });

const feature = { feature: KYC_FEATURE };
const selfAudited = { config: { ...feature, audit: false as const } };
const audited = (action: string, entity: string, idParamName?: string) => ({
  config: { ...feature, audit: { action, entity, ...(idParamName ? { idParam: idParamName } : {}) } },
});

/**
 * Routes under /v1/kyc (feature `kyc` on every route).
 *
 * Subject access (checked in the handler, because vendor owners and users act on their own subjects without holding
 * `kyc.manage`): super-admins and `kyc.manage` holders (owners/admins always) for any subject of the shop; the vendor's
 * owner for that vendor; a user for themselves. Shop subjects use the shop's own id.
 * - `POST /checks` `{ subjectType, subjectId, type, input }` → `{ check, subject }`
 * - `POST /checks/:id/refresh` (DigiLocker polling)
 * - `GET /subjects/:type/:id` → status + checks + documents
 * - `POST /documents` `{ subjectType, subjectId, kind, fileUrl }`, `DELETE /documents/:id`
 * Super-admin: `GET /review?tenantId&limit&offset`, `POST /checks/:id/approve` `{ reason? }`, `POST /checks/:id/reject` `{ reason }`.
 *
 * Audit summaries carry the check type and outcome only — never identifiers or names.
 */
export function kycRoutes(service: KycService) {
  return async (app: FastifyInstance) => {
    app.post("/checks", audited("kyc.check", "kyc_check"), async (req) => {
      const body = submitCheckSchema.parse(req.body ?? {});
      const tenantId = await service.assertAccess(req.ctx, body.subjectType, body.subjectId);
      const out = await service.submitCheck(tenantId, req.ctx.user?.id ?? null, body);
      req.auditSummary = `${body.subjectType} ${body.type} check: ${out.check.status}`;
      return out;
    });

    app.post("/checks/:id/refresh", audited("kyc.check.refresh", "kyc_check", "id"), async (req) => {
      requireUser(req.ctx);
      const tenantId = requireTenant(req.ctx).id;
      const { id } = idParam.parse(req.params);
      const current = await service.store.checkById(tenantId, id);
      if (current) {
        const subject = await service.store.subjectById(tenantId, current.subjectId);
        if (subject) await service.assertAccess(req.ctx, subject.subjectType, subject.subjectId);
      }
      const out = await service.refreshCheck(tenantId, id);
      req.auditSummary = `${out.check.type} check: ${out.check.status}`;
      return out;
    });

    app.get("/subjects/:type/:id", { config: feature }, async (req) => {
      const { type, id } = subjectParams.parse(req.params);
      const tenantId = await service.assertAccess(req.ctx, type, id);
      return service.getSubject(tenantId, type, id);
    });

    app.post("/documents", audited("kyc.document.add", "kyc_document"), async (req) => {
      const body = documentSchema.parse(req.body ?? {});
      const tenantId = await service.assertAccess(req.ctx, body.subjectType, body.subjectId);
      const doc = await service.addDocument(tenantId, req.ctx.user?.id ?? null, body);
      req.auditSummary = `${body.subjectType} document: ${body.kind}`;
      return doc;
    });

    app.delete("/documents/:id", audited("kyc.document.remove", "kyc_document", "id"), async (req) => {
      requireUser(req.ctx);
      const tenantId = requireTenant(req.ctx).id;
      const { id } = idParam.parse(req.params);
      const subject = await service.documentSubject(tenantId, id);
      await service.assertAccess(req.ctx, subject.subjectType, subject.subjectId);
      await service.removeDocument(tenantId, id);
      return { ok: true };
    });

    // ---- review queue (super-admin, across shops)
    app.get("/review", { config: feature }, async (req) => {
      requireSuperAdmin(req.ctx);
      return service.reviewQueue(reviewQuery.parse(req.query ?? {}));
    });

    // The service records these (`kyc.review.*`) under the check's shop; the host hook would have no shop.
    app.post("/checks/:id/approve", selfAudited, async (req) => {
      const admin = requireSuperAdmin(req.ctx);
      const { id } = idParam.parse(req.params);
      const { reason } = approveBody.parse(req.body ?? {});
      return service.approve(id, admin.id, reason, { ip: req.ctx.ip, userAgent: req.ctx.userAgent });
    });

    app.post("/checks/:id/reject", selfAudited, async (req) => {
      const admin = requireSuperAdmin(req.ctx);
      const { id } = idParam.parse(req.params);
      const { reason } = rejectBody.parse(req.body ?? {});
      return service.reject(id, admin.id, reason, { ip: req.ctx.ip, userAgent: req.ctx.userAgent });
    });
  };
}
