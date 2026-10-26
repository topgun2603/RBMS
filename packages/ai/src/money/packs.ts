import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@srirealtime/db";
import type { CoverNote, LoanPackFacts } from "./loanpack";
import { aiMoneyPacks, type AiMoneyPackRow } from "./schema";

export interface PackView {
  id: string;
  createdAt: string;
  showNames: boolean;
  facts: LoanPackFacts;
  cover: CoverNote & { source: "ai" | "template" };
  credits: number;
  share: { active: boolean; expiresAt: string | null; token: string | null };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function packView(r: AiMoneyPackRow, now = new Date()): PackView {
  const active = !!r.shareToken && !r.revokedAt && !!r.shareExpiresAt && r.shareExpiresAt > now;
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    showNames: r.showNames,
    facts: r.facts,
    cover: r.cover,
    credits: r.credits,
    share: { active, expiresAt: active ? iso(r.shareExpiresAt) : null, token: active ? r.shareToken : null },
  };
}

/** Storage for prepared packs and their expiring share links. */
export class PackStore {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  async create(tenantId: string, v: { facts: LoanPackFacts; cover: PackView["cover"]; showNames: boolean; shopName: string; credits: number; userId: string | null }): Promise<AiMoneyPackRow> {
    const [row] = await this.db
      .insert(aiMoneyPacks)
      .values({ tenantId, kind: "loan-pack", facts: v.facts, cover: v.cover, showNames: v.showNames, shopName: v.shopName, credits: v.credits, createdBy: v.userId })
      .returning();
    return row!;
  }

  async get(tenantId: string, id: string): Promise<AiMoneyPackRow | null> {
    const [row] = await this.db.select().from(aiMoneyPacks).where(and(eq(aiMoneyPacks.tenantId, tenantId), eq(aiMoneyPacks.id, id))).limit(1);
    return row ?? null;
  }

  async list(tenantId: string, limit = 10): Promise<AiMoneyPackRow[]> {
    return this.db.select().from(aiMoneyPacks).where(eq(aiMoneyPacks.tenantId, tenantId)).orderBy(desc(aiMoneyPacks.createdAt)).limit(limit);
  }

  /** A new random link that expires in `days`. Replaces any earlier link of the pack. */
  async share(tenantId: string, id: string, days: number): Promise<AiMoneyPackRow | null> {
    const token = randomBytes(24).toString("base64url");
    const expires = new Date(this.now().getTime() + days * 86_400_000);
    const [row] = await this.db
      .update(aiMoneyPacks)
      .set({ shareToken: token, shareExpiresAt: expires, sharedAt: this.now(), revokedAt: null, updatedAt: this.now() })
      .where(and(eq(aiMoneyPacks.tenantId, tenantId), eq(aiMoneyPacks.id, id)))
      .returning();
    return row ?? null;
  }

  async revoke(tenantId: string, id: string): Promise<AiMoneyPackRow | null> {
    const [row] = await this.db
      .update(aiMoneyPacks)
      .set({ shareToken: null, revokedAt: this.now(), updatedAt: this.now() })
      .where(and(eq(aiMoneyPacks.tenantId, tenantId), eq(aiMoneyPacks.id, id)))
      .returning();
    return row ?? null;
  }

  /** The pack behind a live link: not revoked and not expired. */
  async byToken(token: string): Promise<AiMoneyPackRow | null> {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    const [row] = await this.db
      .select()
      .from(aiMoneyPacks)
      .where(and(eq(aiMoneyPacks.shareToken, token), isNull(aiMoneyPacks.revokedAt), gt(aiMoneyPacks.shareExpiresAt, this.now())))
      .limit(1);
    return row ?? null;
  }
}
