import type { Db } from "@srirealtime/db";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import {
  kycChecks,
  kycDocuments,
  kycSubjects,
  type CheckType,
  type KycCheckRow,
  type KycDocumentRow,
  type KycSubjectRow,
  type SubjectType,
} from "./schema";

export type NewCheck = Omit<typeof kycChecks.$inferInsert, "id" | "createdAt" | "updatedAt">;
export type CheckPatch = Partial<Omit<KycCheckRow, "id" | "tenantId" | "subjectId" | "createdAt">>;
export type SubjectPatch = Pick<KycSubjectRow, "status" | "verifiedName" | "badges">;
export type NewDocument = Omit<typeof kycDocuments.$inferInsert, "id" | "createdAt">;

/**
 * Persistence used by the service. Every tenant-scoped read takes `tenantId`; only the super-admin review queue reads
 * across tenants (`tenantId` null).
 */
export interface KycStore {
  findSubject(tenantId: string, type: SubjectType, subjectId: string): Promise<KycSubjectRow | null>;
  /** Creates the subject row when missing (status `none`) and returns it. */
  ensureSubject(tenantId: string, type: SubjectType, subjectId: string): Promise<KycSubjectRow>;
  subjectById(tenantId: string, id: string): Promise<KycSubjectRow | null>;
  updateSubject(tenantId: string, id: string, patch: SubjectPatch): Promise<KycSubjectRow>;

  insertCheck(values: NewCheck): Promise<KycCheckRow>;
  updateCheck(tenantId: string, id: string, patch: CheckPatch): Promise<KycCheckRow>;
  /** `tenantId` null = any tenant (super-admin review). */
  checkById(tenantId: string | null, id: string): Promise<KycCheckRow | null>;
  /** Newest first. */
  listChecks(tenantId: string, subjectRowId: string): Promise<KycCheckRow[]>;
  countChecksSince(tenantId: string, subjectRowId: string, type: CheckType, since: Date): Promise<number>;
  /** Checks in `manual_review`, oldest first. `tenantId` null = all tenants. */
  listReview(q: { tenantId: string | null; limit: number; offset: number }): Promise<{ items: { check: KycCheckRow; subject: KycSubjectRow }[]; total: number }>;

  insertDocument(values: NewDocument): Promise<KycDocumentRow>;
  listDocuments(tenantId: string, subjectRowId: string): Promise<KycDocumentRow[]>;
  documentById(tenantId: string, id: string): Promise<KycDocumentRow | null>;
  deleteDocument(tenantId: string, id: string): Promise<void>;
}

// ---------------------------------------------------------------- Postgres (Drizzle)

export class DrizzleKycStore implements KycStore {
  constructor(private readonly db: Db) {}

  async findSubject(tenantId: string, type: SubjectType, subjectId: string) {
    const [row] = await this.db
      .select()
      .from(kycSubjects)
      .where(and(eq(kycSubjects.tenantId, tenantId), eq(kycSubjects.subjectType, type), eq(kycSubjects.subjectId, subjectId)))
      .limit(1);
    return row ?? null;
  }

  async ensureSubject(tenantId: string, type: SubjectType, subjectId: string) {
    await this.db.insert(kycSubjects).values({ tenantId, subjectType: type, subjectId }).onConflictDoNothing();
    const row = await this.findSubject(tenantId, type, subjectId);
    if (!row) throw new Error("kyc: subject upsert failed");
    return row;
  }

  async subjectById(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(kycSubjects)
      .where(and(eq(kycSubjects.tenantId, tenantId), eq(kycSubjects.id, id)))
      .limit(1);
    return row ?? null;
  }

  async updateSubject(tenantId: string, id: string, patch: SubjectPatch) {
    const [row] = await this.db
      .update(kycSubjects)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(kycSubjects.tenantId, tenantId), eq(kycSubjects.id, id)))
      .returning();
    return row!;
  }

  async insertCheck(values: NewCheck) {
    const [row] = await this.db.insert(kycChecks).values(values).returning();
    return row!;
  }

  async updateCheck(tenantId: string, id: string, patch: CheckPatch) {
    const [row] = await this.db
      .update(kycChecks)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(kycChecks.tenantId, tenantId), eq(kycChecks.id, id)))
      .returning();
    return row!;
  }

  async checkById(tenantId: string | null, id: string) {
    const where = tenantId ? and(eq(kycChecks.tenantId, tenantId), eq(kycChecks.id, id)) : eq(kycChecks.id, id);
    const [row] = await this.db.select().from(kycChecks).where(where).limit(1);
    return row ?? null;
  }

  listChecks(tenantId: string, subjectRowId: string) {
    return this.db
      .select()
      .from(kycChecks)
      .where(and(eq(kycChecks.tenantId, tenantId), eq(kycChecks.subjectId, subjectRowId)))
      .orderBy(desc(kycChecks.createdAt));
  }

  async countChecksSince(tenantId: string, subjectRowId: string, type: CheckType, since: Date) {
    const [row] = await this.db
      .select({ n: count() })
      .from(kycChecks)
      .where(and(eq(kycChecks.tenantId, tenantId), eq(kycChecks.subjectId, subjectRowId), eq(kycChecks.type, type), gte(kycChecks.createdAt, since)));
    return Number(row?.n ?? 0);
  }

  async listReview(q: { tenantId: string | null; limit: number; offset: number }) {
    const where = q.tenantId
      ? and(eq(kycChecks.status, "manual_review"), eq(kycChecks.tenantId, q.tenantId))
      : eq(kycChecks.status, "manual_review");
    const rows = await this.db
      .select({ check: kycChecks, subject: kycSubjects })
      .from(kycChecks)
      .innerJoin(kycSubjects, eq(kycSubjects.id, kycChecks.subjectId))
      .where(where)
      .orderBy(kycChecks.createdAt)
      .limit(q.limit)
      .offset(q.offset);
    const [t] = await this.db.select({ n: sql<number>`count(*)::int` }).from(kycChecks).where(where);
    return { items: rows, total: Number(t?.n ?? 0) };
  }

  async insertDocument(values: NewDocument) {
    const [row] = await this.db.insert(kycDocuments).values(values).returning();
    return row!;
  }

  listDocuments(tenantId: string, subjectRowId: string) {
    return this.db
      .select()
      .from(kycDocuments)
      .where(and(eq(kycDocuments.tenantId, tenantId), eq(kycDocuments.subjectId, subjectRowId)))
      .orderBy(desc(kycDocuments.createdAt));
  }

  async documentById(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(kycDocuments)
      .where(and(eq(kycDocuments.tenantId, tenantId), eq(kycDocuments.id, id)))
      .limit(1);
    return row ?? null;
  }

  async deleteDocument(tenantId: string, id: string) {
    await this.db.delete(kycDocuments).where(and(eq(kycDocuments.tenantId, tenantId), eq(kycDocuments.id, id)));
  }
}

// ---------------------------------------------------------------- in-memory (tests, local tools)

/** Map-backed store with the same semantics; ids are random UUIDs, `now` drives timestamps. */
export class MemoryKycStore implements KycStore {
  readonly subjects: KycSubjectRow[] = [];
  readonly checks: KycCheckRow[] = [];
  readonly documents: KycDocumentRow[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}

  async findSubject(tenantId: string, type: SubjectType, subjectId: string) {
    return this.subjects.find((s) => s.tenantId === tenantId && s.subjectType === type && s.subjectId === subjectId) ?? null;
  }
  async ensureSubject(tenantId: string, type: SubjectType, subjectId: string) {
    const found = await this.findSubject(tenantId, type, subjectId);
    if (found) return found;
    const at = this.now();
    const row: KycSubjectRow = { id: crypto.randomUUID(), tenantId, subjectType: type, subjectId, status: "none", verifiedName: null, badges: [], createdAt: at, updatedAt: at };
    this.subjects.push(row);
    return row;
  }
  async subjectById(tenantId: string, id: string) {
    return this.subjects.find((s) => s.tenantId === tenantId && s.id === id) ?? null;
  }
  async updateSubject(tenantId: string, id: string, patch: SubjectPatch) {
    const row = this.subjects.find((s) => s.tenantId === tenantId && s.id === id);
    if (!row) throw new Error("subject not found");
    Object.assign(row, patch, { updatedAt: this.now() });
    return row;
  }
  async insertCheck(values: NewCheck) {
    const at = this.now();
    const row: KycCheckRow = {
      id: crypto.randomUUID(),
      providerRef: null,
      inputMasked: {},
      inputFingerprint: null,
      result: {},
      nameOnRecord: null,
      nameMatchScore: null,
      error: null,
      createdBy: null,
      reviewDecision: null,
      reviewReason: null,
      reviewedBy: null,
      reviewedAt: null,
      ...values,
      createdAt: at,
      updatedAt: at,
    } as KycCheckRow;
    this.checks.push(row);
    return row;
  }
  async updateCheck(tenantId: string, id: string, patch: CheckPatch) {
    const row = this.checks.find((c) => c.tenantId === tenantId && c.id === id);
    if (!row) throw new Error("check not found");
    Object.assign(row, patch, { updatedAt: this.now() });
    return row;
  }
  async checkById(tenantId: string | null, id: string) {
    return this.checks.find((c) => c.id === id && (tenantId == null || c.tenantId === tenantId)) ?? null;
  }
  async listChecks(tenantId: string, subjectRowId: string) {
    return this.checks
      .filter((c) => c.tenantId === tenantId && c.subjectId === subjectRowId)
      .reverse() // later inserts first on equal timestamps (stable sort)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async countChecksSince(tenantId: string, subjectRowId: string, type: CheckType, since: Date) {
    return this.checks.filter((c) => c.tenantId === tenantId && c.subjectId === subjectRowId && c.type === type && c.createdAt >= since).length;
  }
  async listReview(q: { tenantId: string | null; limit: number; offset: number }) {
    const all = this.checks
      .filter((c) => c.status === "manual_review" && (q.tenantId == null || c.tenantId === q.tenantId))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const items = all.slice(q.offset, q.offset + q.limit).map((check) => ({ check, subject: this.subjects.find((s) => s.id === check.subjectId)! }));
    return { items, total: all.length };
  }
  async insertDocument(values: NewDocument) {
    const row: KycDocumentRow = { id: crypto.randomUUID(), uploadedBy: null, ...values, createdAt: this.now() } as KycDocumentRow;
    this.documents.push(row);
    return row;
  }
  async listDocuments(tenantId: string, subjectRowId: string) {
    return this.documents.filter((d) => d.tenantId === tenantId && d.subjectId === subjectRowId).reverse();
  }
  async documentById(tenantId: string, id: string) {
    return this.documents.find((d) => d.tenantId === tenantId && d.id === id) ?? null;
  }
  async deleteDocument(tenantId: string, id: string) {
    const i = this.documents.findIndex((d) => d.tenantId === tenantId && d.id === id);
    if (i >= 0) this.documents.splice(i, 1);
  }
}
