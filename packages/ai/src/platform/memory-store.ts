import { randomUUID } from "node:crypto";
import type { PlatformReleaseNoteRow, PlatformShopFollowupRow, PlatformTicketMessageRow, PlatformTicketRow } from "./schema";
import type { NewMessage, NewTicket, NotePatch, PlatformStorePort, TicketFilter, TicketPatch } from "./store";
import { ticketNumber } from "./tickets";

/** An in-memory PlatformStorePort for tests and local tries (the database one is DbPlatformStore). */
export class MemoryPlatformStore implements PlatformStorePort {
  readonly ticketRows: PlatformTicketRow[] = [];
  readonly messageRows: PlatformTicketMessageRow[] = [];
  readonly followupRows = new Map<string, PlatformShopFollowupRow>();
  readonly noteRows: PlatformReleaseNoteRow[] = [];
  readonly seen = new Map<string, Date>();

  async createTicket(v: NewTicket, at: Date) {
    const seq = this.ticketRows.length + 1;
    const row: PlatformTicketRow = {
      id: randomUUID(),
      tenantId: v.tenantId,
      number: ticketNumber(seq),
      seq,
      requesterUserId: v.requesterUserId,
      requesterName: v.requesterName,
      requesterRole: v.requesterRole,
      subject: v.subject,
      status: "open",
      source: v.source,
      screen: v.screen,
      question: v.question,
      appId: v.appId,
      category: null,
      urgency: null,
      language: null,
      triage: null,
      triageStatus: "queued",
      triageRunId: null,
      triagedAt: null,
      shopUnread: false,
      firstResponseAt: null,
      resolvedAt: null,
      closedAt: null,
      lastMessageAt: at,
      createdAt: at,
      updatedAt: at,
    };
    this.ticketRows.push(row);
    await this.addMessage({ tenantId: v.tenantId, ticketId: row.id, authorKind: "shop", authorId: v.requesterUserId, authorName: v.requesterName, kind: "reply", body: v.body, fromDraft: null, createdAt: at });
    return row;
  }
  async ticket(id: string) {
    return this.ticketRows.find((t) => t.id === id) ?? null;
  }
  async updateTicket(id: string, patch: TicketPatch) {
    const t = this.ticketRows.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: new Date() });
    return t;
  }
  async messages(ticketId: string) {
    return this.messageRows.filter((m) => m.ticketId === ticketId);
  }
  async addMessage(m: NewMessage) {
    const row: PlatformTicketMessageRow = { id: randomUUID(), createdAt: m.createdAt ?? new Date(), ...m, fromDraft: m.fromDraft ?? null };
    this.messageRows.push(row);
    return row;
  }
  async shopTickets(tenantId: string, userId: string | null, limit: number) {
    return this.ticketRows
      .filter((t) => t.tenantId === tenantId && (!userId || t.requesterUserId === userId))
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
      .slice(0, limit);
  }
  async tickets(f: TicketFilter) {
    return this.ticketRows
      .filter((t) => (f.status === "active" ? t.status === "open" || t.status === "pending" : !f.status || t.status === f.status))
      .filter((t) => (!f.category || t.category === f.category) && (!f.urgency || t.urgency === f.urgency) && (!f.tenantId || t.tenantId === f.tenantId))
      .filter((t) => !f.q || `${t.subject} ${t.number}`.toLowerCase().includes(f.q.toLowerCase()))
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
      .slice(0, f.limit ?? 100);
  }
  async ticketsSince(since: Date) {
    return this.ticketRows.filter((t) => t.createdAt >= since);
  }
  async waiting() {
    const out = new Map<string, { waiting: number; oldest: Date }>();
    for (const t of this.ticketRows.filter((x) => x.status === "open")) {
      const w = out.get(t.tenantId);
      out.set(t.tenantId, { waiting: (w?.waiting ?? 0) + 1, oldest: !w || t.lastMessageAt < w.oldest ? t.lastMessageAt : w.oldest });
    }
    return out;
  }
  async followups() {
    return new Map(this.followupRows);
  }
  async saveFollowup(tenantId: string, patch: Parameters<PlatformStorePort["saveFollowup"]>[1], entry: Parameters<PlatformStorePort["saveFollowup"]>[2]) {
    const cur = this.followupRows.get(tenantId) ?? { tenantId, contactedAt: null, contactedBy: null, snoozedUntil: null, ignored: false, notes: [], createdAt: new Date(), updatedAt: new Date() };
    const next = { ...cur, ...patch, notes: [entry, ...cur.notes].slice(0, 50), updatedAt: new Date() };
    this.followupRows.set(tenantId, next);
    return next;
  }
  async createNote(v: NotePatch) {
    const now = new Date();
    const row: PlatformReleaseNoteRow = {
      id: randomUUID(),
      status: "draft",
      titleEn: "",
      titleTa: "",
      items: [],
      commits: [],
      source: "paste",
      sinceRef: null,
      removed: [],
      runId: null,
      createdBy: null,
      publishedAt: null,
      publishedBy: null,
      createdAt: now,
      updatedAt: now,
      ...v,
    };
    this.noteRows.push(row);
    return row;
  }
  async note(id: string) {
    return this.noteRows.find((n) => n.id === id) ?? null;
  }
  async updateNote(id: string, patch: NotePatch) {
    const n = this.noteRows.find((x) => x.id === id);
    if (!n) return null;
    Object.assign(n, patch, { updatedAt: new Date() });
    return n;
  }
  async notes(limit: number) {
    return [...this.noteRows].reverse().slice(0, limit);
  }
  async published(limit: number) {
    return this.noteRows
      .filter((n) => n.status === "published" && n.publishedAt)
      .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())
      .slice(0, limit);
  }
  async seenAt(userId: string) {
    return this.seen.get(userId) ?? null;
  }
  async markSeen(userId: string, at: Date) {
    this.seen.set(userId, at);
  }
}
