import type { Db } from "@rbms/db";
import { and, desc, eq, isNull, max } from "drizzle-orm";
import { buildNotice, noticeHash, noticeVersionLabel, type NoticeContact, type NoticeInput } from "./privacy-notice";
import { TAX_RECORD_YEARS, type PrivacyHostPort } from "./privacy-ports";
import type { RetentionService } from "./privacy-retention";
import { privacyNotices, type StoredNotice } from "./schema";

export interface NoticeView {
  /** Numeric version; `label` is what the consent log stores. */
  version: number;
  label: string;
  createdAt: string;
  content: StoredNotice;
  contact: NoticeContact;
  responseDays: number;
}

const isUnique = (err: unknown) => (err as { code?: string; cause?: { code?: string } } | null)?.code === "23505" || (err as { cause?: { code?: string } } | null)?.cause?.code === "23505";

/**
 * Generates a shop's privacy notice from its settings and enabled modules, and stores a new version whenever the
 * generated text changes. `tenantId` null = the platform's notice for shop owners.
 */
export class NoticeService {
  constructor(
    private readonly deps: { db: Db; host: PrivacyHostPort; retention: RetentionService },
  ) {}

  /** The notice input for a shop right now. */
  async input(tenantId: string | null): Promise<NoticeInput> {
    const [settings, facts, retention] = await Promise.all([this.deps.host.settings(tenantId), this.deps.host.facts(tenantId), this.deps.retention.effective(tenantId)]);
    const retentionDays: Record<string, number> = {};
    for (const r of retention) if (r.enabled) retentionDays[r.key] = r.days;
    return {
      audience: tenantId ? "shop" : "platform",
      shopName: facts.shopName,
      legalName: facts.legalName,
      address: facts.address,
      modules: facts.modules,
      contact: {
        name: settings.grievanceName,
        role: settings.grievanceRole,
        phone: settings.grievancePhone,
        email: settings.grievanceEmail,
        address: settings.grievanceAddress,
      },
      responseDays: settings.responseDays,
      retentionDays,
      taxYears: TAX_RECORD_YEARS,
      extra: settings.noticeExtra,
    };
  }

  /** What the notice would say now (not stored). The owner reviews this before relying on it. */
  async preview(tenantId: string | null): Promise<{ content: StoredNotice; contact: NoticeContact; responseDays: number }> {
    const input = await this.input(tenantId);
    return { content: buildNotice(input), contact: input.contact, responseDays: input.responseDays };
  }

  /**
   * The current notice. When the generated text differs from the latest stored version a new version is stored first,
   * so a person who accepts "notice-v3" accepted exactly that text.
   */
  async current(tenantId: string | null): Promise<NoticeView> {
    const input = await this.input(tenantId);
    const content = buildNotice(input);
    const hash = noticeHash(content);
    const scope = tenantId ? eq(privacyNotices.tenantId, tenantId) : isNull(privacyNotices.tenantId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const [latest] = await this.deps.db.select().from(privacyNotices).where(scope).orderBy(desc(privacyNotices.version)).limit(1);
      if (latest && latest.contentHash === hash) return this.view(latest.version, latest.createdAt, latest.content, input);
      try {
        const [row] = await this.deps.db
          .insert(privacyNotices)
          .values({ tenantId, version: (latest?.version ?? 0) + 1, contentHash: hash, content })
          .returning();
        return this.view(row!.version, row!.createdAt, row!.content, input);
      } catch (err) {
        if (!isUnique(err)) throw err; // someone else stored the next version at the same time: look again
      }
    }
    throw new Error("privacy: could not store the notice version");
  }

  /** Stored versions, newest first (the text a past consent referred to). */
  async versions(tenantId: string | null, limit = 20) {
    const rows = await this.deps.db
      .select({ version: privacyNotices.version, createdAt: privacyNotices.createdAt })
      .from(privacyNotices)
      .where(tenantId ? eq(privacyNotices.tenantId, tenantId) : isNull(privacyNotices.tenantId))
      .orderBy(desc(privacyNotices.version))
      .limit(limit);
    return rows.map((r) => ({ version: r.version, label: noticeVersionLabel(r.version), createdAt: r.createdAt.toISOString() }));
  }

  /** One stored version's text. */
  async version(tenantId: string | null, version: number) {
    const [row] = await this.deps.db
      .select()
      .from(privacyNotices)
      .where(and(tenantId ? eq(privacyNotices.tenantId, tenantId) : isNull(privacyNotices.tenantId), eq(privacyNotices.version, version)))
      .limit(1);
    return row ?? null;
  }

  async latestVersionNumber(tenantId: string | null): Promise<number> {
    const [r] = await this.deps.db
      .select({ v: max(privacyNotices.version) })
      .from(privacyNotices)
      .where(tenantId ? eq(privacyNotices.tenantId, tenantId) : isNull(privacyNotices.tenantId));
    return r?.v ?? 0;
  }

  private async view(version: number, createdAt: Date, content: StoredNotice, input: NoticeInput): Promise<NoticeView> {
    return { version, label: noticeVersionLabel(version), createdAt: createdAt.toISOString(), content, contact: input.contact, responseDays: input.responseDays };
  }
}
