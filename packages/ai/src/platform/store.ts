import type { Db } from "@srirealtime/db";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import {
  platformReleaseNotes,
  platformReleaseSeen,
  platformShopFollowups,
  platformTicketMessages,
  platformTickets,
  type FollowupEntry,
  type PlatformReleaseNoteRow,
  type PlatformShopFollowupRow,
  type PlatformTicketMessageRow,
  type PlatformTicketRow,
  type PlatformTicketStatus,
  type TicketCategory,
  type TicketUrgency,
} from "./schema";
import { ticketNumber } from "./tickets";

export interface NewTicket {
  tenantId: string;
  requesterUserId: string | null;
  requesterName: string | null;
  requesterRole: string | null;
  subject: string;
  body: string;
  source: "help" | "menu";
  screen: string | null;
  question: string | null;
  appId: string | null;
}

export interface TicketFilter {
  status?: PlatformTicketStatus | "active";
  category?: TicketCategory;
  urgency?: TicketUrgency;
  tenantId?: string;
  q?: string;
  limit?: number;
}

export type TicketPatch = Partial<Omit<PlatformTicketRow, "id" | "tenantId" | "number" | "seq" | "createdAt">>;
export type NotePatch = Partial<Omit<PlatformReleaseNoteRow, "id" | "createdAt">>;
export type NewMessage = Omit<PlatformTicketMessageRow, "id" | "createdAt"> & { createdAt?: Date };

/** Where the platform tools keep their rows. The DB implementation is below; tests use the memory one (memory-store.ts). */
export interface PlatformStorePort {
  createTicket(v: NewTicket, at: Date): Promise<PlatformTicketRow>;
  ticket(id: string): Promise<PlatformTicketRow | null>;
  updateTicket(id: string, patch: TicketPatch): Promise<PlatformTicketRow | null>;
  messages(ticketId: string): Promise<PlatformTicketMessageRow[]>;
  addMessage(m: NewMessage): Promise<PlatformTicketMessageRow>;
  /** A shop's tickets (one requester's when `userId` is given), newest activity first. */
  shopTickets(tenantId: string, userId: string | null, limit: number): Promise<PlatformTicketRow[]>;
  tickets(f: TicketFilter): Promise<PlatformTicketRow[]>;
  ticketsSince(since: Date): Promise<PlatformTicketRow[]>;
  /** Tickets waiting on RBMS (status open), per shop: how many and the oldest last message. */
  waiting(): Promise<Map<string, { waiting: number; oldest: Date }>>;
  followups(): Promise<Map<string, PlatformShopFollowupRow>>;
  saveFollowup(tenantId: string, patch: Partial<Omit<PlatformShopFollowupRow, "tenantId" | "notes" | "createdAt" | "updatedAt">>, entry: FollowupEntry): Promise<PlatformShopFollowupRow>;
  createNote(v: NotePatch): Promise<PlatformReleaseNoteRow>;
  note(id: string): Promise<PlatformReleaseNoteRow | null>;
  updateNote(id: string, patch: NotePatch): Promise<PlatformReleaseNoteRow | null>;
  notes(limit: number): Promise<PlatformReleaseNoteRow[]>;
  published(limit: number): Promise<PlatformReleaseNoteRow[]>;
  seenAt(userId: string): Promise<Date | null>;
  markSeen(userId: string, at: Date): Promise<void>;
}

/** A unique violation, also when the driver error is wrapped (drizzle puts the PostgresError in `cause`). */
const isUnique = (e: unknown): boolean => {
  const err = e as { code?: string; message?: string; cause?: unknown } | null;
  if (!err) return false;
  if (err.code === "23505" || /duplicate key/i.test(String(err.message ?? ""))) return true;
  return err.cause ? isUnique(err.cause) : false;
};

export class DbPlatformStore implements PlatformStorePort {
  constructor(private readonly db: Db) {}

  async createTicket(v: NewTicket, at: Date): Promise<PlatformTicketRow> {
    // One series for the platform: max + 1 taken under a transaction-scoped advisory lock (the unique index is the backstop;
    // a lost race is retried).
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_tickets_seq'))`);
          const [m] = await tx.select({ n: sql<number>`coalesce(max(${platformTickets.seq}), 0)::int` }).from(platformTickets);
          const seq = (m?.n ?? 0) + 1;
          const [row] = await tx
            .insert(platformTickets)
            .values({
              tenantId: v.tenantId,
              number: ticketNumber(seq),
              seq,
              requesterUserId: v.requesterUserId,
              requesterName: v.requesterName,
              requesterRole: v.requesterRole,
              subject: v.subject,
              source: v.source,
              screen: v.screen,
              question: v.question,
              appId: v.appId,
              lastMessageAt: at,
              createdAt: at,
            })
            .returning();
          await tx.insert(platformTicketMessages).values({ tenantId: v.tenantId, ticketId: row!.id, authorKind: "shop", authorId: v.requesterUserId, authorName: v.requesterName, kind: "reply", body: v.body, createdAt: at });
          return row!;
        });
      } catch (e) {
        if (!isUnique(e) || attempt === 3) throw e;
      }
    }
    throw new Error("unreachable");
  }

  async ticket(id: string) {
    const [r] = await this.db.select().from(platformTickets).where(eq(platformTickets.id, id)).limit(1);
    return r ?? null;
  }

  async updateTicket(id: string, patch: TicketPatch) {
    const [r] = await this.db.update(platformTickets).set(patch).where(eq(platformTickets.id, id)).returning();
    return r ?? null;
  }

  messages(ticketId: string) {
    return this.db.select().from(platformTicketMessages).where(eq(platformTicketMessages.ticketId, ticketId)).orderBy(asc(platformTicketMessages.createdAt));
  }

  async addMessage(m: NewMessage) {
    const [r] = await this.db.insert(platformTicketMessages).values(m).returning();
    return r!;
  }

  shopTickets(tenantId: string, userId: string | null, limit: number) {
    const where = userId ? and(eq(platformTickets.tenantId, tenantId), eq(platformTickets.requesterUserId, userId)) : eq(platformTickets.tenantId, tenantId);
    return this.db.select().from(platformTickets).where(where).orderBy(desc(platformTickets.lastMessageAt)).limit(limit);
  }

  tickets(f: TicketFilter) {
    const conds: SQL[] = [];
    if (f.status === "active") conds.push(inArray(platformTickets.status, ["open", "pending"]));
    else if (f.status) conds.push(eq(platformTickets.status, f.status));
    if (f.category) conds.push(eq(platformTickets.category, f.category));
    if (f.urgency) conds.push(eq(platformTickets.urgency, f.urgency));
    if (f.tenantId) conds.push(eq(platformTickets.tenantId, f.tenantId));
    if (f.q?.trim()) {
      const q = `%${f.q.trim().replace(/[%_\\]/g, "\\$&")}%`;
      conds.push(or(ilike(platformTickets.subject, q), ilike(platformTickets.number, q))!);
    }
    return this.db
      .select()
      .from(platformTickets)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(platformTickets.lastMessageAt))
      .limit(Math.min(Math.max(f.limit ?? 100, 1), 500));
  }

  ticketsSince(since: Date) {
    return this.db.select().from(platformTickets).where(gte(platformTickets.createdAt, since)).orderBy(asc(platformTickets.createdAt)).limit(5000);
  }

  async waiting() {
    const rows = await this.db
      .select({ tenantId: platformTickets.tenantId, n: sql<number>`count(*)::int`, oldest: sql<Date>`min(${platformTickets.lastMessageAt})` })
      .from(platformTickets)
      .where(eq(platformTickets.status, "open"))
      .groupBy(platformTickets.tenantId);
    return new Map(rows.map((r) => [r.tenantId, { waiting: r.n, oldest: new Date(r.oldest) }]));
  }

  async followups() {
    const rows = await this.db.select().from(platformShopFollowups);
    return new Map(rows.map((r) => [r.tenantId, r]));
  }

  async saveFollowup(tenantId: string, patch: Partial<Omit<PlatformShopFollowupRow, "tenantId" | "notes" | "createdAt" | "updatedAt">>, entry: FollowupEntry) {
    const entryJson = JSON.stringify([entry]);
    const [r] = await this.db
      .insert(platformShopFollowups)
      .values({ tenantId, ...patch, notes: [entry] })
      .onConflictDoUpdate({
        target: platformShopFollowups.tenantId,
        set: { ...patch, notes: sql`(${entryJson}::jsonb || ${platformShopFollowups.notes}) - 50`, updatedAt: new Date() },
      })
      .returning();
    // `jsonb - 50` removes the element at index 50, so the list stays at most 50 long.
    return r!;
  }

  async createNote(v: NotePatch) {
    const [r] = await this.db.insert(platformReleaseNotes).values(v).returning();
    return r!;
  }

  async note(id: string) {
    const [r] = await this.db.select().from(platformReleaseNotes).where(eq(platformReleaseNotes.id, id)).limit(1);
    return r ?? null;
  }

  async updateNote(id: string, patch: NotePatch) {
    const [r] = await this.db.update(platformReleaseNotes).set(patch).where(eq(platformReleaseNotes.id, id)).returning();
    return r ?? null;
  }

  notes(limit: number) {
    return this.db.select().from(platformReleaseNotes).orderBy(desc(platformReleaseNotes.createdAt)).limit(limit);
  }

  published(limit: number) {
    return this.db
      .select()
      .from(platformReleaseNotes)
      .where(and(eq(platformReleaseNotes.status, "published"), isNotNull(platformReleaseNotes.publishedAt)))
      .orderBy(desc(platformReleaseNotes.publishedAt))
      .limit(limit);
  }

  async seenAt(userId: string) {
    const [r] = await this.db.select().from(platformReleaseSeen).where(eq(platformReleaseSeen.userId, userId)).limit(1);
    return r?.seenAt ?? null;
  }

  async markSeen(userId: string, at: Date) {
    await this.db.insert(platformReleaseSeen).values({ userId, seenAt: at }).onConflictDoUpdate({ target: platformReleaseSeen.userId, set: { seenAt: at } });
  }
}
