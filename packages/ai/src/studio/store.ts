import type { Db } from "@srirealtime/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { studioChanges, studioFeatureRequests, type StudioChangeRow, type StudioFeatureRequestRow } from "./schema";

export type NewChange = Omit<typeof studioChanges.$inferInsert, "id" | "createdAt" | "updatedAt">;
export type ChangePatch = Partial<Omit<StudioChangeRow, "id" | "tenantId" | "createdAt" | "updatedAt">>;
export type NewFeatureRequest = Omit<typeof studioFeatureRequests.$inferInsert, "id" | "createdAt" | "updatedAt">;

/** Where Studio keeps its change sets and feature requests. The database in the API, memory in tests. */
export interface StudioStore {
  insertChange(v: NewChange): Promise<StudioChangeRow>;
  getChange(tenantId: string, id: string): Promise<StudioChangeRow | null>;
  listChanges(tenantId: string, limit: number): Promise<StudioChangeRow[]>;
  updateChange(id: string, patch: ChangePatch): Promise<StudioChangeRow>;
  insertFeatureRequests(v: NewFeatureRequest[]): Promise<void>;
  featureRequests(since: Date, limit: number): Promise<{ byTheme: { theme: string; count: number; shops: number }[]; rows: StudioFeatureRequestRow[] }>;
}

export class DbStudioStore implements StudioStore {
  constructor(private readonly db: Db) {}

  async insertChange(v: NewChange) {
    const [r] = await this.db.insert(studioChanges).values(v).returning();
    return r!;
  }
  async getChange(tenantId: string, id: string) {
    const [r] = await this.db.select().from(studioChanges).where(and(eq(studioChanges.tenantId, tenantId), eq(studioChanges.id, id))).limit(1);
    return r ?? null;
  }
  async listChanges(tenantId: string, limit: number) {
    return this.db.select().from(studioChanges).where(eq(studioChanges.tenantId, tenantId)).orderBy(desc(studioChanges.createdAt)).limit(limit);
  }
  async updateChange(id: string, patch: ChangePatch) {
    const [r] = await this.db.update(studioChanges).set(patch).where(eq(studioChanges.id, id)).returning();
    return r!;
  }
  async insertFeatureRequests(v: NewFeatureRequest[]) {
    if (v.length) await this.db.insert(studioFeatureRequests).values(v);
  }
  async featureRequests(since: Date, limit: number) {
    const byTheme = await this.db
      .select({ theme: studioFeatureRequests.theme, count: sql<number>`count(*)::int`, shops: sql<number>`count(distinct ${studioFeatureRequests.tenantId})::int` })
      .from(studioFeatureRequests)
      .where(gte(studioFeatureRequests.createdAt, since))
      .groupBy(studioFeatureRequests.theme)
      .orderBy(desc(sql`count(*)`));
    const rows = await this.db.select().from(studioFeatureRequests).where(gte(studioFeatureRequests.createdAt, since)).orderBy(desc(studioFeatureRequests.createdAt)).limit(limit);
    return { byTheme, rows };
  }
}

/** In-memory store for tests and evals. */
export class MemoryStudioStore implements StudioStore {
  changes: StudioChangeRow[] = [];
  requests: StudioFeatureRequestRow[] = [];
  private tick = 0;
  async insertChange(v: NewChange) {
    const now = new Date(Date.now() + this.tick++);
    const r = { id: randomUUID(), createdAt: now, updatedAt: now, error: null, runId: null, credits: 0, appliedAt: null, appliedBy: null, undoneAt: null, undoneBy: null, ...v } as unknown as StudioChangeRow;
    this.changes.push(r);
    return r;
  }
  async getChange(tenantId: string, id: string) {
    return this.changes.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
  }
  async listChanges(tenantId: string, limit: number) {
    return this.changes.filter((c) => c.tenantId === tenantId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }
  async updateChange(id: string, patch: ChangePatch) {
    const r = this.changes.find((c) => c.id === id)!;
    Object.assign(r, patch, { updatedAt: new Date() });
    return r;
  }
  async insertFeatureRequests(v: NewFeatureRequest[]) {
    for (const x of v) this.requests.push({ id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), changeId: null, trade: "", language: "en", theme: "other", ...x } as StudioFeatureRequestRow);
  }
  async featureRequests(since: Date, limit: number) {
    const rows = this.requests.filter((r) => r.createdAt >= since).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const map = new Map<string, { count: number; shops: Set<string> }>();
    for (const r of rows) {
      const m = map.get(r.theme) ?? { count: 0, shops: new Set<string>() };
      m.count++;
      m.shops.add(r.tenantId);
      map.set(r.theme, m);
    }
    return { byTheme: [...map].map(([theme, m]) => ({ theme, count: m.count, shops: m.shops.size })).sort((a, b) => b.count - a.count), rows: rows.slice(0, limit) };
  }
}
