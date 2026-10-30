import { aiPlatform, type AiService, type GuideIndex } from "@rbms/ai";
import { inArray, type Db } from "@rbms/db";
import type { JobsService } from "@rbms/jobs";
import { tenants } from "@rbms/tenancy";
import { churnSignals } from "./ai-platform/churn-data";

/**
 * Phase 7 part B (docs/ai.md "Phase 7 part B: platform tools"): churn signals, the RBMS support desk with AI triage, and
 * What's new notes. Shop routes at /v1/platform, super-admin routes at /v1/admin/platform. Triage runs as a background
 * job on the platform's own AI account (no shop's credits); nothing is sent to anyone by WhatsApp, SMS or e-mail.
 */
export interface PlatformKitDeps {
  db: Db;
  ai: AiService;
  jobs: JobsService;
  /** The same guide index the help assistant searches (kit-ai-assist.ts). */
  guides: GuideIndex;
  /** The `store` settings namespace (the shop's trade). */
  storeSettings: { get(scope: { tenantId: string }): Promise<unknown> };
  userName(userId: string): Promise<string | null>;
  demoSlugs: ReadonlySet<string>;
  log: { warn(o: object, m?: string): void };
  now?: () => Date;
}

export function createAiPlatformKit(d: PlatformKitDeps) {
  const trade = async (tenantId: string) => ((await d.storeSettings.get({ tenantId })) as { businessType?: string } | null)?.businessType?.trim() || null;
  const service = new aiPlatform.PlatformService({
    store: new aiPlatform.DbPlatformStore(d.db),
    ai: d.ai,
    guides: d.guides,
    now: d.now,
    ports: {
      churnSignals: (now) => churnSignals({ db: d.db, demoSlugs: d.demoSlugs, trade }, now),
      trade,
      async shops(ids) {
        if (ids.length === 0) return new Map();
        const rows = await d.db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name, appId: tenants.appId }).from(tenants).where(inArray(tenants.id, ids));
        return new Map(rows.map((r) => [r.id, { slug: r.slug, name: r.name, appId: r.appId }]));
      },
      enqueueTriage: (ticketId) => d.jobs.enqueue(aiPlatform.TRIAGE_JOB, { ticketId }),
      log: d.log,
    },
  });
  d.jobs.define<{ ticketId: string }>(
    aiPlatform.TRIAGE_JOB,
    async (data) => {
      await service.triage(data.ticketId);
    },
    { attempts: 2, concurrency: 2 },
  );
  const deps = { service, userName: d.userName };
  return { service, module: aiPlatform.platformShopModule(deps), adminModule: aiPlatform.platformAdminModule(deps) };
}
