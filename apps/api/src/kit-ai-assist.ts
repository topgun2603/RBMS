import { createAiAssist, TRANSLATE_JOB, type AiService, type AssistPorts, type ProductFacts, type TranslateJobPayload } from "@rbms/ai";
import type { Db } from "@rbms/db";
import type { JobsService } from "@rbms/jobs";

/** The slice of the catalogue service the helpers read. */
export interface AssistCatalogue {
  getProduct(tenantId: string, id: string): Promise<{
    id: string;
    name: string;
    description: string | null;
    brand: string | null;
    categoryId: string | null;
    unit: string;
    tags: string[];
    attributes: Record<string, string>;
    options: { name: string; values: string[] }[];
    variants: { price: number; isDefault: boolean }[];
  }>;
  getCategory(tenantId: string, id: string): Promise<{ name: string }>;
}

export interface AssistKitDeps {
  db: Db;
  ai: AiService;
  catalogue: AssistCatalogue;
  jobs: JobsService;
  /** The `store` settings namespace. */
  storeSettings: { get(scope: { tenantId: string }): Promise<unknown> };
  log: { warn(o: object, m?: string): void };
}

type StorePolicies = {
  businessType?: string;
  deliveryEnabled?: boolean;
  pickupEnabled?: boolean;
  pickupNote?: string;
  policies?: { shipping?: string; returns?: string };
  trust?: { returns?: string };
};

/** Facts the shop itself stated in its storefront settings: the ONLY promises a description may repeat. */
export function policyLines(s: StorePolicies): string[] {
  const out: string[] = [];
  const clip = (x: string) => x.replace(/\s+/g, " ").trim().slice(0, 300);
  if (s.policies?.shipping?.trim()) out.push(`Delivery: ${clip(s.policies.shipping)}`);
  if (s.policies?.returns?.trim()) out.push(`Returns: ${clip(s.policies.returns)}`);
  const trust = { easy: "Easy returns are offered", replace: "Replacement is offered for faulty items", exchange: "Exchange is offered" }[s.trust?.returns ?? ""];
  if (trust) out.push(`Returns: ${trust}`);
  if (s.pickupEnabled && s.pickupNote?.trim()) out.push(`Pickup: ${clip(s.pickupNote)}`);
  return out;
}

/** Phase 1 AI text helpers (docs/ai.md): wiring of ports, the bulk-translation job and the module. */
export function createAiAssistKit(deps: AssistKitDeps) {
  const ports: AssistPorts = {
    async product(tenantId, id): Promise<ProductFacts | null> {
      try {
        const p = await deps.catalogue.getProduct(tenantId, id);
        const category = p.categoryId ? await deps.catalogue.getCategory(tenantId, p.categoryId).then((c) => c.name).catch(() => null) : null;
        const v = p.variants.find((x) => x.isDefault) ?? p.variants[0];
        return { name: p.name, category, brand: p.brand, attributes: p.attributes, options: p.options, price: p.variants.length === 1 ? (v?.price ?? null) : null, unit: p.unit, tags: p.tags, existingDescription: p.description };
      } catch {
        return null;
      }
    },
    async products(tenantId, ids) {
      const out = [];
      for (const id of ids) {
        try {
          const p = await deps.catalogue.getProduct(tenantId, id);
          out.push({ id: p.id, name: p.name, description: p.description });
        } catch {
          // not this shop's product: skipped
        }
      }
      return out;
    },
    async shop(tenantId) {
      const s = (await deps.storeSettings.get({ tenantId })) as StorePolicies;
      return { trade: s.businessType?.trim() || null, policies: policyLines(s) };
    },
  };
  const assist = createAiAssist({
    db: deps.db,
    ai: deps.ai,
    ports,
    log: deps.log,
    enqueueTranslate: (payload: TranslateJobPayload) => deps.jobs.enqueue(TRANSLATE_JOB, payload),
  });
  deps.jobs.define<TranslateJobPayload>(
    TRANSLATE_JOB,
    async (data) => {
      const r = await assist.translations.process(data);
      deps.log.warn({ ...r, tenantId: data.tenantId, batchId: data.batchId }, "ai: translation batch drafted");
    },
    { attempts: 1, concurrency: 2 },
  );
  return assist;
}
