import { requirePermission, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CMS_FEATURE_KEYS, CMS_PERMISSION_KEYS } from "./features";
import { PREVIEW_DRAFT_MAX_BYTES, PREVIEW_TOKEN_HEADER, type CmsPreview } from "./preview";

const CMS = CMS_FEATURE_KEYS.base;
/** Token-authenticated: the preview token (not a staff session) is the credential; the shop comes from the host. */
const TOKEN_ROUTE = { config: { feature: CMS } };

const tokenOf = (req: FastifyRequest) => {
  const v = req.headers[PREVIEW_TOKEN_HEADER];
  return Array.isArray(v) ? v[0] : v;
};
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
/** Preview responses are per-viewer and must never land in a shared cache. */
const noStore = (reply: FastifyReply) => reply.header("cache-control", "private, no-store").header("x-robots-tag", "noindex");

/**
 * Live-preview routes under /v1/cms:
 *
 * - `POST /preview-token` — staff with `cms.manage` (owners/admins always): a 30-minute token for this shop.
 * - `GET /preview/session` — `x-preview-token`: is the token valid for this shop; the unsaved brand tokens.
 * - `GET /preview/home` — the home to render in the preview (unsaved sections › saved draft › published).
 * - `PUT /preview/draft` — park unsaved edits `{ home?: { sections, seo? } | null, tokens?: BrandTokensInput | null }`.
 * - `DELETE /preview/draft` — forget them.
 */
export function cmsPreviewRoutes(preview: CmsPreview) {
  return async (app: FastifyInstance) => {
    app.post("/preview-token", { config: { feature: CMS, permission: CMS_PERMISSION_KEYS.manage } }, async (req, reply) => {
      const user = requirePermission(req.ctx, CMS_PERMISSION_KEYS.manage);
      noStore(reply);
      return preview.issue(tid(req), user.id);
    });
    app.get("/preview/session", TOKEN_ROUTE, async (req, reply) => {
      noStore(reply);
      return preview.session(tid(req), tokenOf(req));
    });
    app.get("/preview/home", TOKEN_ROUTE, async (req, reply) => {
      noStore(reply);
      return preview.home(tid(req), tokenOf(req));
    });
    app.put("/preview/draft", { ...TOKEN_ROUTE, bodyLimit: PREVIEW_DRAFT_MAX_BYTES }, async (req, reply) => {
      noStore(reply);
      return preview.putDraft(tid(req), tokenOf(req), req.body);
    });
    app.delete("/preview/draft", TOKEN_ROUTE, async (req, reply) => {
      noStore(reply);
      return preview.clearDraft(tid(req), tokenOf(req));
    });
  };
}

/** The module's routes plus the preview routes (one Fastify plugin, as `defineModule` takes). */
export function withPreviewRoutes(base: (app: FastifyInstance) => Promise<void>, preview: CmsPreview) {
  const extra = cmsPreviewRoutes(preview);
  return async (app: FastifyInstance) => {
    await base(app);
    await extra(app);
  };
}
