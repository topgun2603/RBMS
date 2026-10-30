import { badRequest, requirePermission, requireRole, requireTenant, requireUser, type SrModule } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RateLimiter } from "../assist/routes";
import { AI_FEATURE, AI_PERMISSION_KEYS } from "../features";
import type { AiService } from "../service";
import { askBodyZ, askShop } from "./ask";
import { explainGst } from "./gst-explain";
import type { AskPorts } from "./ports";

/** Money across the whole shop is reports: asking about it needs `reports.view` on top of `ai.use`. */
export const ASK_PERMISSIONS = [AI_PERMISSION_KEYS.use, "reports.view"] as const;

const gstBody = z.object({ period: z.string().regex(/^(0[1-9]|1[0-2])20\d{2}$/, "Use the return period as MMYYYY, for example 102026"), language: z.enum(["en", "ta"]).default("en") });

export interface AskRouteDeps {
  ai: AiService;
  ports: AskPorts;
  limiter?: RateLimiter;
}

/**
 * Mounted at /v1/ai/ask (feature `ai`, permissions `ai.use` + `reports.view`; the read-only demo role holds neither).
 *
 *  POST /       { question, history? }      -> answer, blocks (tables from the tool data), verified, fallback, credits
 *  POST /gst    { period: "MMYYYY", language } -> note, facts, blocks, fallback, credits
 *
 * Every tool is read-only and bound to the caller's shop. Nothing is saved except the `ai_runs` row.
 */
export function askModule(d: AskRouteDeps): SrModule {
  const limiter = d.limiter ?? new RateLimiter();
  const use = { config: { feature: AI_FEATURE, permission: [...ASK_PERMISSIONS], audit: false as const } };
  return {
    id: "ai/ask",
    routes: async (app: FastifyInstance) => {
      const who = (req: { ctx: Parameters<typeof requireTenant>[0] }, route: string, max: number) => {
        requireUser(req.ctx);
        requireRole(req.ctx, "owner", "admin", "staff");
        const tenantId = requireTenant(req.ctx).id;
        const userId = req.ctx.user?.id ?? null;
        requirePermission(req.ctx, ...ASK_PERMISSIONS);
        limiter.check(`${tenantId}:${userId}:ask:${route}`, max, 60_000);
        return { tenantId, userId };
      };
      app.post("/", use, async (req) => {
        const { tenantId, userId } = who(req, "ask", 10);
        const b = askBodyZ.safeParse(req.body ?? {});
        if (!b.success) throw badRequest(b.error.issues[0]?.message ?? "Type a question");
        return askShop(d.ai, { tenantId, userId, question: b.data.question, history: b.data.history, ports: d.ports });
      });
      app.post("/gst", use, async (req) => {
        const { tenantId, userId } = who(req, "gst", 6);
        const b = gstBody.safeParse(req.body ?? {});
        if (!b.success) throw badRequest(b.error.issues[0]?.message ?? "Choose a month");
        return explainGst(d.ai, { tenantId, userId, period: b.data.period, language: b.data.language, ports: d.ports });
      });
    },
  };
}
