import { randomUUID } from "node:crypto";
import { AppError, badRequest, notFound } from "@rbms/core";
import type { AiRunner } from "../assist/hsn";
import type { GuideIndex } from "../assist/help";
import { assessShop, rankAtRisk, type ChurnAssessment, type ChurnFilter, type ShopSignals } from "./churn";
import { checkItems, cleanCommits, draftReleaseNotes, notesForShop, NOTE_APPS, NOTE_TRADES, parseCommits } from "./release-notes";
import type { FollowupEntry, PlatformReleaseNoteRow, PlatformShopFollowupRow, PlatformTicketRow, PlatformTicketStatus, ReleaseCommit, ReleaseNoteItem, TicketCategory, TicketUrgency } from "./schema";
import type { PlatformStorePort } from "./store";
import { cleanText, clusterTickets, shopView, statusAfter, TICKET_LIMITS } from "./tickets";
import { INTERNAL_WORDS, triageTicket } from "./triage";

/** A shop as the RBMS team sees it on the "Shops at risk" card. The owner's phone is only ever shown to the super-admin. */
export interface ShopInfo {
  tenantId: string;
  slug: string;
  name: string;
  appId: string | null;
  trade: string | null;
  planId: string | null;
  createdAt: Date;
  owner: { name: string | null; phone: string | null; email: string | null } | null;
}

export interface PlatformPorts {
  /** Signals of every active shop (demo and test shops flagged), from data the platform already has. */
  churnSignals(now: Date): Promise<{ shop: ShopInfo; signals: Omit<ShopSignals, "tickets"> }[]>;
  /** The shop's trade (`store.businessType`), for filtering What's new. */
  trade(tenantId: string): Promise<string | null>;
  /** Shop names for the support inbox. */
  shops(ids: string[]): Promise<Map<string, { slug: string; name: string; appId: string | null }>>;
  /** Queue the triage of a new ticket (a background job). Missing = run it right away without waiting. */
  enqueueTriage?(ticketId: string): Promise<void>;
  log?: { warn(o: object, m?: string): void };
}

export interface ShopActor {
  userId: string;
  name: string | null;
  role: string | null;
  /** Owner or admin: sees every ticket of the shop, not only their own. */
  fullAccess: boolean;
  appId: string | null;
}

export interface TeamActor {
  userId: string;
  name: string | null;
}

export interface PlatformServiceDeps {
  store: PlatformStorePort;
  ai: AiRunner;
  guides: GuideIndex;
  ports: PlatformPorts;
  now?: () => Date;
}

const DAY = 86_400_000;

export class PlatformService {
  private readonly now: () => Date;
  constructor(private readonly d: PlatformServiceDeps) {
    this.now = d.now ?? (() => new Date());
  }

  // ------------------------------------------------------------------ tickets: the shop side

  async createTicket(tenantId: string, actor: ShopActor, input: { subject: string; body: string; screen?: string | null; question?: string | null; source?: "help" | "menu" }) {
    const subject = cleanText(input.subject, TICKET_LIMITS.subject);
    const body = cleanText(input.body, TICKET_LIMITS.body);
    if (subject.length < 3) throw badRequest("Add a short subject");
    if (body.length < 5) throw badRequest("Tell us what happened");
    const row = await this.d.store.createTicket(
      {
        tenantId,
        requesterUserId: actor.userId,
        requesterName: actor.name,
        requesterRole: actor.role,
        subject,
        body,
        source: input.source ?? "menu",
        screen: input.screen ? cleanText(input.screen, TICKET_LIMITS.screen) : null,
        question: input.question ? cleanText(input.question, TICKET_LIMITS.question) : null,
        appId: actor.appId,
      },
      this.now(),
    );
    await this.queueTriage(row.id);
    return shopView(row, await this.d.store.messages(row.id));
  }

  private async queueTriage(id: string) {
    try {
      if (this.d.ports.enqueueTriage) await this.d.ports.enqueueTriage(id);
      else void this.triage(id).catch((e) => this.d.ports.log?.warn({ err: (e as Error).message, ticketId: id }, "platform: triage failed"));
    } catch (e) {
      this.d.ports.log?.warn({ err: (e as Error).message, ticketId: id }, "platform: could not queue triage");
    }
  }

  private async shopTicket(tenantId: string, actor: ShopActor, id: string): Promise<PlatformTicketRow> {
    const t = await this.d.store.ticket(id);
    // Another shop's ticket, or (for plain staff) another person's: not found.
    if (!t || t.tenantId !== tenantId || (!actor.fullAccess && t.requesterUserId !== actor.userId)) throw notFound("Ticket");
    return t;
  }

  async shopList(tenantId: string, actor: ShopActor) {
    const rows = await this.d.store.shopTickets(tenantId, actor.fullAccess ? null : actor.userId, 50);
    return { items: rows.map((r) => shopView(r)) };
  }

  async shopGet(tenantId: string, actor: ShopActor, id: string) {
    let t = await this.shopTicket(tenantId, actor, id);
    if (t.shopUnread) t = (await this.d.store.updateTicket(id, { shopUnread: false })) ?? t;
    return shopView(t, await this.d.store.messages(id));
  }

  async shopReply(tenantId: string, actor: ShopActor, id: string, text: string) {
    const t = await this.shopTicket(tenantId, actor, id);
    const body = cleanText(text, TICKET_LIMITS.body);
    if (body.length < 1) throw badRequest("Write a message");
    const next = statusAfter(t.status, "shop", "reply");
    if (!next) throw new AppError(409, "ticket_closed", "This ticket is closed. Please raise a new one.");
    const at = this.now();
    await this.d.store.addMessage({ tenantId, ticketId: id, authorKind: "shop", authorId: actor.userId, authorName: actor.name, kind: "reply", body, fromDraft: null, createdAt: at });
    const row = await this.d.store.updateTicket(id, { status: next, lastMessageAt: at, resolvedAt: next === "open" ? null : t.resolvedAt });
    return shopView(row ?? t, await this.d.store.messages(id));
  }

  /** "My problem is solved": the shop closes its side (resolved; a later reply reopens it). */
  async shopResolve(tenantId: string, actor: ShopActor, id: string) {
    const t = await this.shopTicket(tenantId, actor, id);
    if (t.status === "closed" || t.status === "resolved") return shopView(t, await this.d.store.messages(id));
    const row = await this.d.store.updateTicket(id, { status: "resolved", resolvedAt: this.now() });
    return shopView(row ?? t, await this.d.store.messages(id));
  }

  /** Badges: RBMS replies not opened yet, and What's new notes published since the person last looked. */
  async shopBadges(tenantId: string, actor: ShopActor) {
    const [mine, news] = await Promise.all([this.d.store.shopTickets(tenantId, actor.fullAccess ? null : actor.userId, 50), this.whatsNew(tenantId, actor)]);
    return { support: mine.filter((t) => t.shopUnread).length, whatsNew: news.unseen };
  }

  // ------------------------------------------------------------------ tickets: the RBMS side

  async adminTickets(f: { status?: PlatformTicketStatus | "active"; category?: TicketCategory; urgency?: TicketUrgency; q?: string; limit?: number }) {
    const rows = await this.d.store.tickets(f);
    const names = await this.d.ports.shops([...new Set(rows.map((r) => r.tenantId))]);
    const now = this.now().getTime();
    return {
      items: rows.map((r) => ({
        id: r.id,
        number: r.number,
        subject: r.subject,
        status: r.status,
        category: r.category,
        urgency: r.urgency,
        language: r.language,
        summary: r.triage?.summary ?? null,
        triageStatus: r.triageStatus,
        shop: names.get(r.tenantId) ?? null,
        tenantId: r.tenantId,
        requesterName: r.requesterName,
        source: r.source,
        createdAt: r.createdAt,
        lastMessageAt: r.lastMessageAt,
        /** Hours the shop has been waiting for us (open tickets only). */
        waitingHours: r.status === "open" ? Math.floor((now - r.lastMessageAt.getTime()) / 3_600_000) : null,
      })),
    };
  }

  private async teamTicket(id: string) {
    const t = await this.d.store.ticket(id);
    if (!t) throw notFound("Ticket");
    return t;
  }

  async adminTicket(id: string) {
    const t = await this.teamTicket(id);
    const [messages, names] = await Promise.all([this.d.store.messages(id), this.d.ports.shops([t.tenantId])]);
    return { ticket: t, shop: names.get(t.tenantId) ?? null, messages };
  }

  async adminReply(id: string, actor: TeamActor, input: { body: string; fromDraft?: "as-drafted" | "edited" | null; status?: PlatformTicketStatus | null }) {
    const t = await this.teamTicket(id);
    const body = cleanText(input.body, TICKET_LIMITS.reply);
    if (body.length < 2) throw badRequest("Write a reply");
    // Even a person's reply must not name the internal product names to a shop.
    if (/\b(srikit|sri ?realtime|srirealtime)\b/i.test(body)) throw badRequest('Use "RBMS" for the product name in replies to shops');
    const next = statusAfter(t.status, "rbms", "reply", input.status ?? null);
    if (!next) throw new AppError(409, "ticket_closed", "This ticket is closed.");
    const at = this.now();
    await this.d.store.addMessage({ tenantId: t.tenantId, ticketId: id, authorKind: "rbms", authorId: actor.userId, authorName: actor.name, kind: "reply", body, fromDraft: input.fromDraft ?? null, createdAt: at });
    const row = await this.d.store.updateTicket(id, {
      status: next,
      lastMessageAt: at,
      shopUnread: true,
      firstResponseAt: t.firstResponseAt ?? at,
      ...(next === "resolved" ? { resolvedAt: at } : {}),
      ...(next === "closed" ? { closedAt: at } : {}),
    });
    return this.adminTicket((row ?? t).id);
  }

  async adminNote(id: string, actor: TeamActor, text: string) {
    const t = await this.teamTicket(id);
    const body = cleanText(text, TICKET_LIMITS.reply);
    if (body.length < 1) throw badRequest("Write a note");
    await this.d.store.addMessage({ tenantId: t.tenantId, ticketId: id, authorKind: "rbms", authorId: actor.userId, authorName: actor.name, kind: "note", body, fromDraft: null, createdAt: this.now() });
    return this.adminTicket(id);
  }

  async adminStatus(id: string, status: PlatformTicketStatus) {
    const t = await this.teamTicket(id);
    if (t.status === status) return this.adminTicket(id);
    if (t.status === "closed") throw new AppError(409, "ticket_closed", "This ticket is closed.");
    const at = this.now();
    await this.d.store.updateTicket(id, { status, ...(status === "resolved" ? { resolvedAt: at } : {}), ...(status === "closed" ? { closedAt: at } : {}), ...(status === "open" ? { resolvedAt: null } : {}) });
    return this.adminTicket(id);
  }

  /** Runs (or re-runs) the triage of one ticket and stores it. AI problems give the code's own triage, never an error. */
  async triage(id: string) {
    const t = await this.teamTicket(id);
    const first = (await this.d.store.messages(id)).find((m) => m.authorKind === "shop" && m.kind === "reply");
    try {
      const r = await triageTicket(this.d.ai, this.d.guides, { subject: t.subject, body: first?.body ?? "", screen: t.screen, question: t.question });
      await this.d.store.updateTicket(id, {
        category: r.triage.category,
        urgency: r.triage.urgency,
        language: r.triage.language,
        triage: r.triage,
        triageStatus: "done",
        triageRunId: r.runId,
        triagedAt: this.now(),
      });
      return { ...r.triage, runId: r.runId, credits: r.credits };
    } catch (e) {
      await this.d.store.updateTicket(id, { triageStatus: "failed" });
      throw e;
    }
  }

  /** "Common problems": tickets of the last `weeks` weeks grouped by week, category and topic words. */
  async commonProblems(weeks = 8) {
    const w = Math.min(Math.max(Math.floor(weeks) || 8, 1), 26);
    const rows = await this.d.store.ticketsSince(new Date(this.now().getTime() - w * 7 * DAY));
    const clusters = clusterTickets(rows.map((r) => ({ id: r.id, tenantId: r.tenantId, number: r.number, subject: r.subject, createdAt: r.createdAt, category: r.category, triage: r.triage })));
    return { weeks: w, total: rows.length, clusters };
  }

  // ------------------------------------------------------------------ churn signals

  async churn(filter: ChurnFilter = "at-risk") {
    const now = this.now();
    const [list, waiting, follow] = await Promise.all([this.d.ports.churnSignals(now), this.d.store.waiting(), this.d.store.followups()]);
    const rows = list.map(({ shop, signals }) => {
      const w = waiting.get(shop.tenantId);
      const f = follow.get(shop.tenantId) ?? null;
      const a: ChurnAssessment = assessShop({ ...signals, demo: signals.demo || !!f?.ignored, tickets: { waiting: w?.waiting ?? 0, oldestWaitingAt: w?.oldest ?? null } }, now);
      return { shop, a, f };
    });
    const ranked = rankAtRisk(rows, now, filter);
    const counts = {
      shops: rows.length,
      high: rows.filter((r) => !r.a.demo && !r.a.left && r.a.level === "high").length,
      watch: rows.filter((r) => !r.a.demo && !r.a.left && r.a.level === "watch").length,
      demo: rows.filter((r) => r.a.demo).length,
      left: rows.filter((r) => r.a.left).length,
      snoozed: rows.filter((r) => r.f?.snoozedUntil && r.f.snoozedUntil > now).length,
    };
    return {
      at: now,
      filter,
      counts,
      items: ranked.map(({ shop, a, f }) => ({ shop, ...a, followup: f ? followupView(f, now) : null })),
    };
  }

  async followup(tenantId: string, actor: TeamActor, action: { kind: "contacted" | "note"; text?: string } | { kind: "snooze"; days: number; text?: string } | { kind: "unsnooze" } | { kind: "ignore"; ignored: boolean; text?: string }) {
    const now = this.now();
    const text = "text" in action && action.text ? cleanText(action.text, 1000) : "";
    const entry = (kind: FollowupEntry["kind"], extra: Partial<FollowupEntry> = {}): FollowupEntry => ({ at: now.toISOString(), by: actor.userId, byName: actor.name, kind, text, ...extra });
    let row: PlatformShopFollowupRow;
    switch (action.kind) {
      case "contacted":
        row = await this.d.store.saveFollowup(tenantId, { contactedAt: now, contactedBy: actor.userId }, entry("contacted"));
        break;
      case "note":
        if (!text) throw badRequest("Write a note");
        row = await this.d.store.saveFollowup(tenantId, {}, entry("note"));
        break;
      case "snooze": {
        const days = Math.min(Math.max(Math.floor(action.days), 1), 90);
        const until = new Date(now.getTime() + days * DAY);
        row = await this.d.store.saveFollowup(tenantId, { snoozedUntil: until }, entry("snooze", { until: until.toISOString() }));
        break;
      }
      case "unsnooze":
        row = await this.d.store.saveFollowup(tenantId, { snoozedUntil: null }, entry("unsnooze"));
        break;
      case "ignore":
        row = await this.d.store.saveFollowup(tenantId, { ignored: action.ignored }, entry(action.ignored ? "ignore" : "unignore"));
        break;
    }
    return followupView(row, now);
  }

  // ------------------------------------------------------------------ What's new

  /** A new draft from a commit list (pasted text or the script's list). No AI yet. */
  async createNote(actor: TeamActor | null, input: { text?: string; commits?: ReleaseCommit[]; source: "paste" | "script"; sinceRef?: string | null }) {
    const commits = input.commits?.length ? parseCommits(input.commits.map((c) => [c.sha, c.date ?? "", c.subject].join("\t")).join("\n")) : parseCommits(input.text ?? "");
    if (commits.length === 0) throw badRequest("No changes found in the list (merges and housekeeping commits are left out)");
    return noteView(await this.d.store.createNote({ commits, source: input.source, sinceRef: input.sinceRef?.slice(0, 80) ?? null, createdBy: actor?.userId ?? null }));
  }

  private async noteRow(id: string) {
    const n = await this.d.store.note(id);
    if (!n) throw notFound("Note");
    return n;
  }

  async draftNote(id: string, actor: TeamActor) {
    const n = await this.noteRow(id);
    if (n.status !== "draft") throw new AppError(409, "note_published", "Only a draft can be written again.");
    const r = await draftReleaseNotes(this.d.ai, n.commits, { userId: actor.userId });
    const row = await this.d.store.updateNote(id, { titleEn: r.titleEn, titleTa: r.titleTa, items: r.items, removed: r.removed, runId: r.runId });
    return { ...noteView(row ?? n), credits: r.credits };
  }

  async saveNote(id: string, input: { titleEn: string; titleTa: string; items: { id?: string; en: string; ta: string; apps: string[]; trades: string[] }[] }) {
    const n = await this.noteRow(id);
    if (n.status === "archived") throw new AppError(409, "note_archived", "This note is archived.");
    const items: ReleaseNoteItem[] = input.items.map((i) => ({
      id: i.id && /^[0-9a-f-]{36}$/i.test(i.id) ? i.id : randomUUID(),
      en: cleanText(i.en, 300),
      ta: cleanText(i.ta, 500),
      apps: [...new Set(i.apps.filter((a) => a in NOTE_APPS))],
      trades: [...new Set(i.trades.filter((t) => (NOTE_TRADES as readonly string[]).includes(t)))],
    }));
    const row = await this.d.store.updateNote(id, { titleEn: cleanText(input.titleEn, 120), titleTa: cleanText(input.titleTa, 200), items });
    return noteView(row ?? n);
  }

  /** Publishing re-checks every line; a line with an internal name or a missing language blocks it, other findings are warnings. */
  async publishNote(id: string, actor: TeamActor) {
    const n = await this.noteRow(id);
    if (n.status !== "draft") throw new AppError(409, "note_published", "This note is already published or archived.");
    if (n.items.length === 0) throw badRequest("Add at least one line");
    if (!n.titleEn.trim() || !n.titleTa.trim()) throw badRequest("Add the title in English and Tamil");
    const blocking = n.items.filter((i) => !i.en.trim() || !i.ta.trim() || INTERNAL_WORDS.test(`${i.en}\n${i.ta}\n${n.titleEn}\n${n.titleTa}`));
    if (blocking.length) throw new AppError(400, "note_not_ready", `Fix these lines first (both languages, no internal names): ${blocking.map((b) => b.en || b.ta).join(" | ")}`);
    const row = await this.d.store.updateNote(id, { status: "published", publishedAt: this.now(), publishedBy: actor.userId });
    return noteView(row ?? n);
  }

  async archiveNote(id: string) {
    const n = await this.noteRow(id);
    return noteView((await this.d.store.updateNote(id, { status: "archived" })) ?? n);
  }

  /** Warnings on the current lines (the same checks as the AI draft), shown while the team edits. */
  async noteChecks(id: string) {
    const n = await this.noteRow(id);
    return checkItems(n.items, n.commits).removed;
  }

  async notes() {
    return { items: (await this.d.store.notes(50)).map(noteView) };
  }

  async note(id: string) {
    const n = await this.noteRow(id);
    return { ...noteView(n), warnings: checkItems(n.items, n.commits).removed };
  }

  /** The published notes for this shop's app and trade, newest first, with how many are new to this person. */
  async whatsNew(tenantId: string, actor: Pick<ShopActor, "userId" | "appId">) {
    const [published, trade, seen] = await Promise.all([this.d.store.published(20), this.d.ports.trade(tenantId), this.d.store.seenAt(actor.userId)]);
    const notes = notesForShop(
      published.map((p) => ({ id: p.id, titleEn: p.titleEn, titleTa: p.titleTa, items: p.items, publishedAt: p.publishedAt })),
      { appId: actor.appId, trade },
    );
    return { items: notes, unseen: notes.filter((n) => n.publishedAt && (!seen || n.publishedAt > seen)).length, seenAt: seen };
  }

  async markWhatsNewSeen(userId: string) {
    await this.d.store.markSeen(userId, this.now());
    return { ok: true as const };
  }
}

function followupView(f: PlatformShopFollowupRow, now: Date) {
  return {
    contactedAt: f.contactedAt,
    snoozedUntil: f.snoozedUntil && f.snoozedUntil > now ? f.snoozedUntil : null,
    ignored: f.ignored,
    notes: f.notes.slice(0, 10),
  };
}

export function noteView(n: PlatformReleaseNoteRow) {
  return {
    id: n.id,
    status: n.status,
    titleEn: n.titleEn,
    titleTa: n.titleTa,
    items: n.items,
    commits: n.commits,
    source: n.source,
    sinceRef: n.sinceRef,
    removed: n.removed,
    drafted: !!n.runId,
    createdAt: n.createdAt,
    publishedAt: n.publishedAt,
  };
}
