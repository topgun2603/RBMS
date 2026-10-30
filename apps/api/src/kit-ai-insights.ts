import { createAiInsights, DAILY_JOB, indianPhone, resolveDailySummary, shortDate, type AiService, type AiSettings, type DailyPorts } from "@rbms/ai";
import type { Db } from "@rbms/db";
import { sql } from "@rbms/db";
import { maskTarget, type SendInput, type SendResult } from "@rbms/notify";
import { todayIST } from "@rbms/gst";
import { gatherFacts, type ExpiryPort, type FactsItems } from "./ai-insights/facts";
import { gatherReorder, type ReorderItems } from "./ai-insights/reorder";
import { gatherSegment, loadReview, loadReviewTexts, peakHour } from "./ai-insights/audience";

export interface AiInsightsKitDeps {
  db: Db;
  ai: AiService;
  catalogue: FactsItems & ReorderItems;
  expiry: ExpiryPort | null;
  /** The settings namespace "ai". */
  aiSettings: { get(scope: { tenantId: string }): Promise<unknown> };
  notify: { send(input: SendInput): Promise<SendResult> };
  /** The shop's owner: id, phone, email, language. */
  owner: (tenantId: string) => Promise<{ userId: string; phone: string | null; email: string | null } | null>;
  shopName: (tenantId: string) => Promise<string>;
  /** The shop's trade ("Textiles & garments"), when known. */
  shopTrade: (tenantId: string) => Promise<string | null>;
  /** Which delivery channels the platform has real providers for (otherwise only the in-app copy is made). */
  channels: { whatsapp: boolean; email: boolean };
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
  now?: () => Date;
  /** Phase 5 part A: unusual-activity lines to add to a day's summary (empty unless the owner switched that on). */
  extraFacts?: (tenantId: string, date: string) => Promise<{ en: string; ta: string }[]>;
}

/** Phase 2 part B wiring (docs/ai.md "Phase 2 part B"): daily summary job + delivery, reorder, campaign writer, review helpers. */
export function createAiInsightsKit(deps: AiInsightsKitDeps) {
  const now = deps.now ?? (() => new Date());
  const settingsOf = async (tenantId: string) => (await deps.aiSettings.get({ tenantId })) as AiSettings;

  const daily: DailyPorts = {
    facts: async (tenantId, date) => {
      const f = await gatherFacts(deps.db, deps.catalogue, deps.expiry, tenantId, date);
      const unusual = deps.extraFacts ? await deps.extraFacts(tenantId, date).catch(() => []) : [];
      return unusual.length ? { ...f, unusual } : f;
    },
    shopName: deps.shopName,
    async aiSettings(tenantId) {
      const s = await settingsOf(tenantId);
      return { enabled: s.enabled === true, features: s.features ?? {}, dailySummary: s.dailySummary };
    },
    async candidates() {
      const rows = (await deps.db.execute(sql`
        select tenant_id::text as id from settings_values
        where namespace = 'ai' and tenant_id is not null and user_id is null
          and value->>'enabled' = 'true' and value->'dailySummary'->>'enabled' = 'true'`)) as unknown as { id: string }[];
      return rows.map((r) => r.id);
    },
    async deliver({ tenantId, shop, date, text, whatsappText, language, settings }) {
      const skipped: string[] = [];
      const whatsapp: { to: string; status: string }[] = [];
      const email: { to: string; status: string }[] = [];
      const owner = await deps.owner(tenantId);
      const dateText = shortDate(date, language);

      const phones = [...new Set([...(settings.toOwner && owner?.phone ? [owner.phone] : []), ...settings.phones].map((p) => indianPhone(p)).filter((p): p is string => !!p))];
      if (phones.length === 0) skipped.push("no_phone");
      else if (!deps.channels.whatsapp) skipped.push("whatsapp_not_configured");
      else {
        for (const to of phones) {
          try {
            const r = await deps.notify.send({ tenantId, userId: null, channel: "whatsapp", to, template: "daily.summary", vars: { shop, date: dateText, narrative: whatsappText }, locale: language });
            whatsapp.push({ to: maskTarget(to), status: r.status });
          } catch {
            whatsapp.push({ to: maskTarget(to), status: "failed" });
          }
        }
      }

      if (settings.toOwner && owner?.email) {
        if (!deps.channels.email) skipped.push("email_not_configured");
        else {
          try {
            const body = [text.narrative, ...text.actions.map((a, i) => `${i + 1}) ${a}`)].join(" ");
            const r = await deps.notify.send({ tenantId, userId: owner.userId, channel: "email", to: owner.email, template: "daily.summary", vars: { shop, date: dateText, narrative: body }, locale: language });
            email.push({ to: maskTarget(owner.email), status: r.status });
          } catch {
            email.push({ to: maskTarget(owner.email), status: "failed" });
          }
        }
      }
      return { whatsapp, email, skipped };
    },
  };

  const insights = createAiInsights({
    db: deps.db,
    ai: deps.ai,
    daily,
    log: deps.log,
    now,
    ports: {
      reorder: (tenantId, opts) => gatherReorder(deps.db, deps.catalogue, tenantId, todayIST(now()), opts),
      segment: (tenantId, spec, today) => gatherSegment(deps.db, tenantId, spec, today),
      peakHour: (tenantId) => peakHour(deps.db, tenantId),
      shop: async (tenantId) => ({ name: await deps.shopName(tenantId), trade: await deps.shopTrade(tenantId) }),
      review: (tenantId, id) => loadReview(deps.db, tenantId, id),
      reviewTexts: (tenantId, days, productId) => loadReviewTexts(deps.db, tenantId, days, productId),
      today: () => todayIST(now()),
      now,
    },
  });
  return { ...insights, job: DAILY_JOB, resolveDailySummary };
}
