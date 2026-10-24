import { AI_PERMISSION_KEYS, PURCHASE_BILL_FEATURE, PURCHASE_BILL_SCHEMA, PURCHASE_BILL_SYSTEM, RECEIPT_FEATURE, RECEIPT_SCHEMA, RECEIPT_SYSTEM, type AiImageType, type AiService } from "@srirealtime/ai";
import { AppError, badRequest, requirePermission, requireRole, requireTenant, requireUser, type SrModule } from "@srirealtime/core";
import { todayIST } from "@srirealtime/gst";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { processBill, type BillContext } from "./ai-vision/bill";
import { processReceipt } from "./ai-vision/receipt";

/** The slices of the other modules the scanners read. Read-only: the scanners never write anything but their `ai_runs` row. */
export interface AiVisionDeps {
  ai: AiService;
  inventory: { listSuppliers(tenantId: string, q: { q?: string; limit?: number }): Promise<{ items: { id: string; name: string; gstin: string | null; stateCode: string | null }[] }> };
  items: { listItems(tenantId: string, q: { q?: string; limit?: number }): Promise<{ items: { id: string; name: string; hsn: string | null; unit: string; gstRate: number }[] }> };
  expenses: { categories(tenantId: string): Promise<{ id: string; name: string }[]> };
  /** The shop's billing profile (settings "billing"): its state decides intra- or inter-state. */
  billingProfile: { get(scope: { tenantId: string }): Promise<unknown> };
  isEnabled: (tenantId: string, key: string) => Promise<boolean>;
  now?: () => Date;
}

/** Largest request: 20 MB of base64 (the AI service refuses more) plus the JSON around it. */
export const SCAN_BODY_LIMIT = 24 * 1024 * 1024;
const MAX_IMAGES = 6;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const scanBody = z
  .object({
    images: z.array(z.object({ mediaType: z.enum(IMAGE_TYPES), data: z.string().min(64) })).max(MAX_IMAGES).default([]),
    pdf: z.object({ data: z.string().min(64) }).optional(),
  })
  .refine((b) => b.images.length > 0 || !!b.pdf, { message: "Send a photo or a PDF" })
  .refine((b) => !(b.images.length > 0 && b.pdf), { message: "Send photos or one PDF, not both" });

/** The file's own first bytes must match what the request says it is. */
export function sniff(data: string): "jpeg" | "png" | "webp" | "gif" | "pdf" | null {
  let head: Buffer;
  try {
    head = Buffer.from(data.slice(0, 32), "base64");
  } catch {
    return null;
  }
  if (head.length < 8) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (head.subarray(0, 3).toString("latin1") === "GIF") return "gif";
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  return null;
}

export function parseScanBody(body: unknown) {
  const parsed = scanBody.safeParse(body ?? {});
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Send a photo or a PDF");
  const b = parsed.data;
  for (const img of b.images) {
    const kind = sniff(img.data);
    const want = img.mediaType.split("/")[1];
    if (!kind || kind === "pdf" || kind !== want) throw new AppError(400, "ai_bad_image", "That file is not a valid photo. Use a JPG, PNG or WebP photo.");
  }
  if (b.pdf && sniff(b.pdf.data) !== "pdf") throw new AppError(400, "ai_bad_image", "That file is not a valid PDF.");
  return { images: b.images.map((i) => ({ mediaType: i.mediaType as AiImageType, data: i.data })), pdfs: b.pdf ? [{ data: b.pdf.data, title: "supplier-bill.pdf" }] : [] };
}

const UNREADABLE = "ai_unreadable_image";
const unreadable = (why?: string | null) =>
  new AppError(422, UNREADABLE, "The photo could not be read. Retake it in good light, flat and fully in the frame.", why ? { reason: String(why).slice(0, 200) } : undefined);

/**
 * `POST /v1/ai/scan/purchase-bill` and `POST /v1/ai/scan/receipt` (docs/ai.md). Each takes a photo (or a PDF) in the body,
 * asks the vision model for a strict JSON reading, then checks every field in code (`ai-vision/*`). The answer is a
 * DRAFT for the purchase or expense form: these routes save nothing, and the person saves through the normal routes.
 * Permissions: `ai.use` plus the permission of the thing being filled (purchases / expenses); the AI switches and credits
 * are checked by `AiService.run`.
 */
export function createAiVision(d: AiVisionDeps): SrModule {
  const now = d.now ?? (() => new Date());
  const shopCtx = (req: { ctx: Parameters<typeof requireTenant>[0] }, permission: string) => {
    requireUser(req.ctx);
    requireRole(req.ctx, "owner", "admin", "staff");
    const tenant = requireTenant(req.ctx);
    requirePermission(req.ctx, AI_PERMISSION_KEYS.use, permission);
    return tenant.id;
  };

  const billContext = async (tenantId: string): Promise<BillContext> => {
    const profile = ((await d.billingProfile.get({ tenantId }).catch(() => null)) ?? {}) as { stateCode?: string | number | null };
    const state = profile.stateCode === null || profile.stateCode === undefined ? null : String(profile.stateCode).padStart(2, "0");
    return {
      today: todayIST(now()),
      shopState: state && /^\d{2}$/.test(state) ? state : null,
      pharmacy: await d.isEnabled(tenantId, "medicines").catch(() => false),
      suppliers: {
        byGstin: async (gstin) => (await d.inventory.listSuppliers(tenantId, { q: gstin, limit: 5 })).items.find((s) => s.gstin?.toUpperCase() === gstin) ?? null,
        search: async (q) => (await d.inventory.listSuppliers(tenantId, { q: q.slice(0, 60), limit: 20 })).items,
      },
      items: { search: async (q) => (await d.items.listItems(tenantId, { q: q.slice(0, 80), limit: 20 })).items },
    };
  };

  return {
    id: "ai/scan",
    routes: async (app: FastifyInstance) => {
      const OPTS = (feature: string, permission: string) => ({ bodyLimit: SCAN_BODY_LIMIT, config: { feature, permission, audit: false as const } });

      app.post("/purchase-bill", OPTS("inventory.purchases", "inventory.purchases"), async (req) => {
        const tenantId = shopCtx(req, "inventory.purchases");
        const input = parseScanBody(req.body);
        const r = await d.ai.run({
          tenantId,
          userId: req.ctx.user?.id ?? null,
          feature: PURCHASE_BILL_FEATURE,
          tier: "vision",
          system: PURCHASE_BILL_SYSTEM,
          input: { text: "Read the attached supplier bill. Return the JSON structure only.", ...input },
          schema: PURCHASE_BILL_SCHEMA,
          maxTokens: 12_000,
          effort: "low",
        });
        if (!r.output.readable) throw unreadable(r.output.notes);
        const draft = await processBill(r.output, await billContext(tenantId));
        return { draft, runId: r.runId, credits: r.credits, provider: r.provider };
      });

      app.post("/receipt", OPTS("expenses", "expenses.manage"), async (req) => {
        const tenantId = shopCtx(req, "expenses.manage");
        const input = parseScanBody(req.body);
        const categories = await d.expenses.categories(tenantId);
        const r = await d.ai.run({
          tenantId,
          userId: req.ctx.user?.id ?? null,
          feature: RECEIPT_FEATURE,
          tier: "vision",
          system: RECEIPT_SYSTEM,
          input: { text: `Read the attached receipt. The shop's expense categories: ${categories.map((c) => c.name).join(" | ")}. Return the JSON structure only.`, ...input },
          schema: RECEIPT_SCHEMA,
          maxTokens: 6000,
          effort: "low",
        });
        if (!r.output.readable) throw unreadable(r.output.unreadableReason);
        const draft = processReceipt(r.output, { today: todayIST(now()), categories });
        return { draft, runId: r.runId, credits: r.credits, provider: r.provider };
      });
    },
  };
}
