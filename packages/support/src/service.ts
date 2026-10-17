import {
  AppError,
  badRequest,
  conflict,
  defineSort,
  facetCounts,
  forbidden,
  notFound,
  runList,
  searchAny,
  unauthorized,
  type FeatureGatePort,
  type ListPage,
} from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { and, arrayContains, asc, count, desc, eq, getTableColumns, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import {
  FAQ_NO_CATEGORY,
  faqArticleInputSchema,
  faqArticlePatchSchema,
  faqArticleQuerySchema,
  faqCategoryInputSchema,
  faqCategoryPatchSchema,
  faqSearchQuerySchema,
  groupFaq,
  helpfulInputSchema,
  rankArticles,
  slugify,
  slugProblem,
  toFaqArticle,
  toFaqCategory,
  toSummary,
  uniqueSlug,
  type FaqArticle,
  type FaqArticleInput,
  type FaqArticleListItem,
  type FaqArticlePatch,
  type FaqArticleQuery,
  type FaqArticleSummary,
  type FaqCategory,
  type FaqCategoryInput,
  type FaqCategoryPatch,
} from "./faq";
import { SUPPORT_FEATURE_KEYS } from "./features";
import {
  assignInputSchema,
  canTransition,
  formatTicketNumber,
  istMidnight,
  mergeInputSchema,
  messagePreview,
  parseTicketNumber,
  priorityInputSchema,
  publicMessages,
  publicTicketInputSchema,
  requesterMessageInputSchema,
  staffMessageInputSchema,
  staffTicketInputSchema,
  statusAfterMessage,
  statusCounts,
  statusInputSchema,
  statusTimestamps,
  tagsInputSchema,
  ticketListQuerySchema,
  toIndianE164,
  toMessage,
  toPublicTicket,
  toTicket,
  type Message,
  type PublicMessage,
  type PublicTicket,
  type PublicTicketInput,
  type RequesterMessageInput,
  type StaffMessageInput,
  type StaffTicketInput,
  type Ticket,
  type TicketListParams,
  type TicketListQuery,
} from "./logic";
import {
  noopLogger,
  SUPPORT_TEMPLATES,
  type GuestVerifierPort,
  type LoggerPort,
  type NotifierPort,
  type NotifierSendInput,
  type RequesterProfilePort,
  type StaffContact,
  type StaffDirectoryPort,
  type SupportLinksPort,
  type SupportSettingsPort,
  type SupportTemplate,
} from "./ports";
import {
  faqArticles,
  faqCategories,
  supportMessages,
  supportTickets,
  supportTicketSeries,
  type AuthorKind,
  type MessageKind,
  type TicketChannel,
  type TicketPriority,
  type TicketRow,
  type TicketStatus,
} from "./schema";
import { missedSla, resolveSupportSettings, slaDueAt, SLA_ACTIVE_STATUSES, type SupportSettings } from "./sla";

export interface SupportDeps {
  db: Db;
  /** Guests (no account) raise tickets with an OTP-verified phone token. Without it only signed-in users can. */
  guestVerifier?: GuestVerifierPort;
  notifier?: NotifierPort;
  staff?: StaffDirectoryPort;
  requesters?: RequesterProfilePort;
  /** Settings namespace `support`. Without it the defaults apply (TKT, 24×7, 72/24/8/2 h). */
  settings?: SupportSettingsPort;
  links?: SupportLinksPort;
  /** The overdue job skips shops with `support` off. */
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
  now?: () => Date;
}

/** Who is calling a `/public/tickets*` route: a signed-in user, or a guest token (header `x-guest-token`). */
export type RequesterIdentity = { userId: string; guestToken?: undefined } | { userId?: undefined; guestToken: string };

/** A resolved requester. */
export type Requester = { kind: "user"; userId: string } | { kind: "guest"; phone: string; name: string | null };

/** Can this requester see the ticket? Users by account; guests by their verified phone. */
export function ownsTicket(t: Pick<TicketRow, "requesterUserId" | "requesterPhone">, r: Requester): boolean {
  if (r.kind === "user") return t.requesterUserId === r.userId;
  return Boolean(t.requesterPhone) && t.requesterPhone === r.phone;
}

/** Two tickets are from the same customer (same account, phone or email): only those may be merged. */
export function sameRequester(
  a: Pick<TicketRow, "requesterUserId" | "requesterPhone" | "requesterEmail">,
  b: Pick<TicketRow, "requesterUserId" | "requesterPhone" | "requesterEmail">,
): boolean {
  return (
    (Boolean(a.requesterUserId) && a.requesterUserId === b.requesterUserId) ||
    (Boolean(a.requesterPhone) && a.requesterPhone === b.requesterPhone) ||
    (Boolean(a.requesterEmail) && a.requesterEmail?.toLowerCase() === b.requesterEmail?.toLowerCase())
  );
}

/** WhatsApp to an Indian mobile, email to an address. */
export function contactTargets(c: { phone?: string | null; email?: string | null }): { channel: NotifierSendInput["channel"]; to: string }[] {
  const out: { channel: NotifierSendInput["channel"]; to: string }[] = [];
  const ph = toIndianE164(c.phone ?? null);
  if (ph) out.push({ channel: "whatsapp", to: ph });
  if (c.email) out.push({ channel: "email", to: c.email });
  return out;
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface TicketList extends ListPage<Ticket> {
  /** Per status, over the other filters (the status filter itself is ignored). Same numbers as `facets.status`. */
  counts: Record<TicketStatus, number>;
  /** Overdue tickets over the other filters (the status filter itself is ignored). */
  overdue: number;
}

/** Severity rank for sorting by priority: `-priority` puts urgent first. */
export const PRIORITY_RANK_SQL = sql`(case ${supportTickets.priority} when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 when 'low' then 1 else 0 end)`;

/**
 * Sort keys of `GET /tickets`. `updated` is the latest activity (last message), the desk's default (`-updated`);
 * `due` is the first-response deadline (nulls last either way); `number` follows the ticket sequence.
 */
export const TICKET_SORT = defineSort(
  {
    number: supportTickets.seq,
    subject: sql`lower(${supportTickets.subject})`,
    updated: supportTickets.lastMessageAt,
    created: supportTickets.createdAt,
    priority: PRIORITY_RANK_SQL,
    due: supportTickets.slaDueAt,
    // Workflow order (open → pending → resolved → closed), not alphabetical.
    status: sql`(case ${supportTickets.status} when 'open' then 1 when 'pending' then 2 when 'resolved' then 3 when 'closed' then 4 else 5 end)`,
  },
  { default: "-updated", tieBreaker: supportTickets.id },
);

/** Sort keys of `GET /faq/articles`. `order` is the manual order (then title), the default. `helpful` = yes − no votes. */
export const FAQ_ARTICLE_SORT = defineSort(
  {
    order: faqArticles.sort,
    title: sql`lower(${faqArticles.title})`,
    updated: faqArticles.updatedAt,
    helpful: sql`(${faqArticles.helpfulYes} - ${faqArticles.helpfulNo})`,
    status: faqArticles.status,
  },
  { default: "order", tieBreaker: [sql`lower(${faqArticles.title})`, faqArticles.id] },
);

export interface TicketThread {
  ticket: Ticket;
  /** Everything, notes and system lines included (staff view). */
  messages: Message[];
}

export interface PublicThread {
  ticket: PublicTicket;
  /** Replies only — notes are never included. */
  items: PublicMessage[];
}

const conflictOnUnique = (err: unknown, message: string): never => {
  const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (code === "23505") throw conflict(message);
  throw err;
};

/**
 * Hands out the next ticket sequence of a tenant. The row lock taken by the upsert serialises concurrent creates until
 * the surrounding transaction ends; a rollback leaves no gap (same pattern as invoices' `allocateSeqStatement`).
 */
export function allocateTicketSeq(db: DbOrTx, tenantId: string) {
  const current = sql`${sql.identifier("support_ticket_series")}.${sql.identifier("next_seq")}`;
  return db
    .insert(supportTicketSeries)
    .values({ tenantId, nextSeq: 1 })
    .onConflictDoUpdate({ target: supportTicketSeries.tenantId, set: { nextSeq: sql`${current} + 1`, updatedAt: sql`now()` } })
    .returning({ seq: supportTicketSeries.nextSeq });
}

interface NewTicket {
  subject: string;
  body: string;
  attachments: string[];
  requesterUserId: string | null;
  requesterName: string | null;
  requesterPhone: string | null;
  requesterEmail: string | null;
  priority: TicketPriority;
  channel: TicketChannel;
  assigneeId: string | null;
  tags: string[];
  related: { type: "order" | "invoice"; id: string } | null;
  /** Who wrote the first message. */
  author: { id: string | null; kind: AuthorKind };
}

/**
 * Help desk + FAQ (docs/batch3.md §A3): tickets numbered per shop, statuses with allowed transitions, first-response
 * SLA with an overdue job, replies vs internal notes, merge, CSV, and an FAQ with categories, search and helpful votes.
 */
export class SupportService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: SupportDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  async settings(tenantId: string): Promise<SupportSettings> {
    if (!this.deps.settings) return resolveSupportSettings(null);
    try {
      return resolveSupportSettings(await this.deps.settings.get(tenantId));
    } catch (err) {
      this.log.warn({ err, tenantId }, "support: settings unavailable, using defaults");
      return resolveSupportSettings(null);
    }
  }

  // ================================================================ requester identity

  /** 401 without an identity or with a bad guest token; 403 when the shop doesn't take guest tickets. */
  async resolveRequester(tenantId: string, identity: RequesterIdentity | null): Promise<Requester> {
    if (identity?.userId) return { kind: "user", userId: identity.userId };
    const token = identity?.guestToken;
    if (!token) throw unauthorized("Sign in or verify your phone number");
    if (!this.deps.guestVerifier) throw unauthorized("Sign in to contact support");
    if (token.length > 2048) throw unauthorized("Your phone verification has expired, verify again");
    let verified: Awaited<ReturnType<GuestVerifierPort["verify"]>> = null;
    try {
      verified = await this.deps.guestVerifier.verify(tenantId, token);
    } catch (err) {
      this.log.warn({ err, tenantId }, "support: guest verification failed");
    }
    const phone = toIndianE164(verified?.phone);
    if (!verified || !phone) throw unauthorized("Your phone verification has expired, verify again");
    if (!(await this.settings(tenantId)).allowGuests) throw forbidden("Sign in to contact support");
    return { kind: "guest", phone, name: verified.name?.trim() || null };
  }

  private requesterWhere(tenantId: string, r: Requester): SQL {
    return and(
      eq(supportTickets.tenantId, tenantId),
      r.kind === "user" ? eq(supportTickets.requesterUserId, r.userId) : eq(supportTickets.requesterPhone, r.phone),
    )!;
  }

  // ================================================================ rows

  private async row(tenantId: string, id: string, db: DbOrTx = this.db, lock = false): Promise<TicketRow> {
    const q = db
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Ticket");
    return row;
  }

  private async messagesOf(tenantId: string, ticketId: string): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(supportMessages)
      .where(and(eq(supportMessages.tenantId, tenantId), eq(supportMessages.ticketId, ticketId)))
      .orderBy(asc(supportMessages.createdAt), asc(supportMessages.id));
    return rows.map(toMessage);
  }

  private async numberOf(tenantId: string, id: string | null): Promise<string | null> {
    if (!id) return null;
    const [r] = await this.db
      .select({ number: supportTickets.number })
      .from(supportTickets)
      .where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.id, id)))
      .limit(1);
    return r?.number ?? null;
  }

  private async insertTicket(tenantId: string, t: NewTicket, settings: SupportSettings): Promise<{ row: TicketRow; message: Message }> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [series] = await allocateTicketSeq(tx, tenantId);
      const seq = series!.seq;
      const [row] = await tx
        .insert(supportTickets)
        .values({
          tenantId,
          number: formatTicketNumber(settings.prefix, seq),
          seq,
          requesterUserId: t.requesterUserId,
          requesterName: t.requesterName,
          requesterPhone: t.requesterPhone,
          requesterEmail: t.requesterEmail,
          subject: t.subject,
          status: "open",
          priority: t.priority,
          channel: t.channel,
          assigneeId: t.assigneeId,
          tags: t.tags,
          relatedType: t.related?.type ?? null,
          relatedId: t.related?.id ?? null,
          slaDueAt: slaDueAt(now, t.priority, settings),
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const [msg] = await tx
        .insert(supportMessages)
        .values({ tenantId, ticketId: row!.id, authorId: t.author.id, authorKind: t.author.kind, kind: "reply", body: t.body, attachments: t.attachments, createdAt: now })
        .returning();
      return { row: row!, message: toMessage(msg!) };
    });
  }

  /** After a ticket is created: confirm to the requester, tell the assignee (or the support team). Never throws. */
  private async afterCreate(row: TicketRow, firstMessage: Message): Promise<void> {
    const ticket = toTicket(row, this.now());
    await this.notifyRequester(row.tenantId, ticket, SUPPORT_TEMPLATES.created, firstMessage.body);
    if (row.assigneeId) await this.notifyStaff(row.tenantId, ticket, [row.assigneeId], SUPPORT_TEMPLATES.new, firstMessage.body);
    else await this.notifyTeam(row.tenantId, ticket, SUPPORT_TEMPLATES.new, firstMessage.body);
  }

  // ================================================================ public: tickets

  /** `POST /public/tickets`: a signed-in user or a verified guest raises a ticket (channel web, priority normal). */
  async createPublicTicket(tenantId: string, identity: RequesterIdentity | null, input: PublicTicketInput): Promise<PublicThread> {
    const b = publicTicketInputSchema.parse(input);
    const requester = await this.resolveRequester(tenantId, identity);
    const settings = await this.settings(tenantId);
    let name = b.name ?? null;
    let phone: string | null = null;
    let email = b.email ?? null;
    if (requester.kind === "guest") {
      phone = requester.phone;
      name = name ?? requester.name;
      if (!name) throw badRequest("Tell us your name", { field: "name" });
    } else if (this.deps.requesters) {
      try {
        const p = await this.deps.requesters.profile(tenantId, requester.userId);
        name = name ?? p?.name?.trim() ?? null;
        phone = toIndianE164(p?.phone);
        email = email ?? p?.email?.trim().toLowerCase() ?? null;
      } catch (err) {
        this.log.warn({ err, tenantId }, "support: requester profile unavailable");
      }
    }
    const { row, message } = await this.insertTicket(
      tenantId,
      {
        subject: b.subject,
        body: b.body,
        attachments: b.attachments,
        requesterUserId: requester.kind === "user" ? requester.userId : null,
        requesterName: name,
        requesterPhone: phone,
        requesterEmail: email,
        priority: "normal",
        channel: "web",
        assigneeId: settings.defaultAssigneeId,
        tags: [],
        related: b.related ?? null,
        author: { id: requester.kind === "user" ? requester.userId : null, kind: "requester" },
      },
      settings,
    );
    await this.afterCreate(row, message);
    return { ticket: toPublicTicket(toTicket(row, this.now())), items: publicMessages([message]) };
  }

  /** `GET /public/tickets`: the requester's own tickets, latest activity first. */
  async listOwn(tenantId: string, identity: RequesterIdentity | null, query: { limit?: unknown; offset?: unknown } = {}): Promise<ListResult<PublicTicket>> {
    const requester = await this.resolveRequester(tenantId, identity);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const where = this.requesterWhere(tenantId, requester);
    const [rows, [counted]] = await Promise.all([
      this.db.select().from(supportTickets).where(where).orderBy(desc(supportTickets.lastMessageAt), asc(supportTickets.id)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(supportTickets).where(where),
    ]);
    const now = this.now();
    const mergedIds = [...new Set(rows.map((r) => r.mergedIntoId).filter((x): x is string => Boolean(x)))];
    const numbers = new Map<string, string>();
    if (mergedIds.length) {
      for (const r of await this.db
        .select({ id: supportTickets.id, number: supportTickets.number })
        .from(supportTickets)
        .where(and(eq(supportTickets.tenantId, tenantId), inArray(supportTickets.id, mergedIds)))) {
        numbers.set(r.id, r.number);
      }
    }
    return {
      items: rows.map((r) => toPublicTicket(toTicket(r, now), r.mergedIntoId ? (numbers.get(r.mergedIntoId) ?? null) : null)),
      total: counted?.total ?? 0,
    };
  }

  private async ownedRow(tenantId: string, requester: Requester, ticketId: string): Promise<TicketRow> {
    const row = await this.row(tenantId, ticketId);
    // Someone else's ticket looks like a missing one.
    if (!ownsTicket(row, requester)) throw notFound("Ticket");
    return row;
  }

  /** `GET /public/tickets/:id/messages`: the ticket and its replies (notes never). */
  async publicThread(tenantId: string, identity: RequesterIdentity | null, ticketId: string): Promise<PublicThread> {
    const requester = await this.resolveRequester(tenantId, identity);
    const row = await this.ownedRow(tenantId, requester, ticketId);
    const [messages, mergedInto] = await Promise.all([this.messagesOf(tenantId, row.id), this.numberOf(tenantId, row.mergedIntoId)]);
    return { ticket: toPublicTicket(toTicket(row, this.now()), mergedInto), items: publicMessages(messages) };
  }

  /** `POST /public/tickets/:id/messages`: the requester replies; a pending or resolved ticket reopens. 409 when closed. */
  async replyAsRequester(tenantId: string, identity: RequesterIdentity | null, ticketId: string, input: RequesterMessageInput): Promise<PublicThread> {
    const b = requesterMessageInputSchema.parse(input);
    const requester = await this.resolveRequester(tenantId, identity);
    await this.ownedRow(tenantId, requester, ticketId);
    const now = this.now();
    const row = await this.db.transaction(async (tx) => {
      const current = await this.row(tenantId, ticketId, tx, true);
      const next = statusAfterMessage(current.status, "requester", "reply");
      if (!next || current.mergedIntoId) throw conflict("This ticket is closed. Please raise a new ticket.");
      await tx.insert(supportMessages).values({
        tenantId,
        ticketId,
        authorId: requester.kind === "user" ? requester.userId : null,
        authorKind: "requester",
        kind: "reply",
        body: b.body,
        attachments: b.attachments,
        createdAt: now,
      });
      const [updated] = await tx
        .update(supportTickets)
        .set({ status: next, ...(next !== current.status ? statusTimestamps(next, now) : {}), lastMessageAt: now })
        .where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.id, ticketId)))
        .returning();
      return updated!;
    });
    const ticket = toTicket(row, now);
    if (row.assigneeId) await this.notifyStaff(row.tenantId, ticket, [row.assigneeId], SUPPORT_TEMPLATES.customerReply, b.body);
    else await this.notifyTeam(row.tenantId, ticket, SUPPORT_TEMPLATES.customerReply, b.body);
    const [messages, mergedInto] = await Promise.all([this.messagesOf(tenantId, ticketId), this.numberOf(tenantId, row.mergedIntoId)]);
    return { ticket: toPublicTicket(ticket, mergedInto), items: publicMessages(messages) };
  }

  // ================================================================ staff: tickets

  /**
   * WHERE of the staff list. `skip` leaves one filter out (for its facet counts). `assignee` values are ORed (`me` is
   * the viewer, `none` unassigned).
   */
  listConditions(tenantId: string, q: TicketListParams, viewerId: string | null, skip?: "status" | "priority"): SQL {
    const now = this.now();
    const seq = q.q ? parseTicketNumber(q.q) : null;
    const assignees = (q.assignee ?? []).map((a) =>
      a === "none" ? isNull(supportTickets.assigneeId) : a === "me" ? (viewerId ? eq(supportTickets.assigneeId, viewerId) : sql`false`) : eq(supportTickets.assigneeId, a),
    );
    const search = searchAny(q.q, [supportTickets.number, supportTickets.subject, supportTickets.requesterName, supportTickets.requesterPhone, supportTickets.requesterEmail]);
    return and(
      eq(supportTickets.tenantId, tenantId),
      skip !== "status" && q.status?.length ? inArray(supportTickets.status, q.status) : undefined,
      skip !== "priority" && q.priority?.length ? inArray(supportTickets.priority, q.priority) : undefined,
      q.channel?.length ? inArray(supportTickets.channel, q.channel) : undefined,
      assignees.length ? or(...assignees) : undefined,
      q.tag ? arrayContains(supportTickets.tags, [q.tag]) : undefined,
      q.overdue === true ? this.overdueSql(now) : undefined,
      q.overdue === false ? sql`not (${this.overdueSql(now)})` : undefined,
      q.from ? gte(supportTickets.createdAt, istMidnight(q.from)) : undefined,
      q.to ? lt(supportTickets.createdAt, new Date(istMidnight(q.to).getTime() + 86_400_000)) : undefined,
      search && seq ? or(search, eq(supportTickets.seq, seq)) : search,
    )!;
  }

  /** SQL twin of `isOverdue`. */
  private overdueSql(now: Date): SQL {
    return and(
      isNull(supportTickets.firstResponseAt),
      isNull(supportTickets.mergedIntoId),
      inArray(supportTickets.status, [...SLA_ACTIVE_STATUSES]),
      lt(supportTickets.slaDueAt, now),
    )!;
  }

  /**
   * `GET /tickets`: one page with `total`, per-status `counts` (= `facets.status`, over the other filters),
   * `facets.priority` and `overdue` (tickets past due over the other filters, status included). `assignee=me` uses
   * `viewerId`. Unknown `sort` → 400.
   */
  async list(tenantId: string, query: TicketListQuery = {}, viewerId: string | null = null): Promise<TicketList> {
    const q = ticketListQuerySchema.parse(query);
    const order = TICKET_SORT.orderBy(q.sort);
    const where = this.listConditions(tenantId, q, viewerId);
    const noStatus = this.listConditions(tenantId, q, viewerId, "status");
    const noPriority = this.listConditions(tenantId, q, viewerId, "priority");
    const now = this.now();
    const [page, grouped, byPriority, [overdue]] = await Promise.all([
      runList(q, {
        rows: () => this.db.select().from(supportTickets).where(where).orderBy(...order).limit(q.limit).offset(q.offset),
        count: () => this.db.select({ total: count() }).from(supportTickets).where(where),
        map: (r) => toTicket(r, now),
      }),
      this.db.select({ status: supportTickets.status, count: count() }).from(supportTickets).where(noStatus).groupBy(supportTickets.status),
      this.db.select({ key: supportTickets.priority, n: count() }).from(supportTickets).where(noPriority).groupBy(supportTickets.priority),
      this.db.select({ total: count() }).from(supportTickets).where(and(noStatus, this.overdueSql(now))),
    ]);
    const counts = statusCounts(grouped);
    return { ...page, facets: { status: { ...counts }, priority: facetCounts(byPriority) }, counts, overdue: overdue?.total ?? 0 };
  }

  /** `GET /tickets/:id`: the ticket and the whole thread (notes included). */
  async get(tenantId: string, id: string): Promise<TicketThread> {
    const row = await this.row(tenantId, id);
    return { ticket: toTicket(row, this.now()), messages: await this.messagesOf(tenantId, id) };
  }

  private async assertAssignable(tenantId: string, userId: string | null): Promise<void> {
    if (!userId || !this.deps.staff) return;
    if (!(await this.deps.staff.contact(tenantId, userId))) throw badRequest("Assign the ticket to a staff member of this shop", { field: "assigneeId" });
  }

  /** `POST /tickets`: staff log a ticket for a customer (phone call, walk-in, email). */
  async createStaffTicket(tenantId: string, staffId: string, input: StaffTicketInput): Promise<TicketThread> {
    const b = staffTicketInputSchema.parse(input);
    const settings = await this.settings(tenantId);
    const assigneeId = b.assigneeId === undefined ? settings.defaultAssigneeId : b.assigneeId;
    await this.assertAssignable(tenantId, assigneeId);
    const phone = b.phone ? toIndianE164(b.phone) : null;
    if (b.phone && !phone) throw badRequest("Enter a valid mobile number", { field: "phone" });
    const { row, message } = await this.insertTicket(
      tenantId,
      {
        subject: b.subject,
        body: b.body,
        attachments: b.attachments,
        requesterUserId: b.requesterUserId ?? null,
        requesterName: b.name ?? null,
        requesterPhone: phone,
        requesterEmail: b.email ?? null,
        priority: b.priority,
        channel: b.channel,
        assigneeId,
        tags: b.tags,
        related: b.related ?? null,
        // Written on the customer's behalf: it is their message.
        author: { id: null, kind: "requester" },
      },
      settings,
    );
    void staffId;
    await this.afterCreate(row, message);
    return { ticket: toTicket(row, this.now()), messages: [message] };
  }

  private async update(tenantId: string, id: string, set: Partial<typeof supportTickets.$inferInsert>): Promise<TicketRow> {
    const [row] = await this.db
      .update(supportTickets)
      .set(set)
      .where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.id, id)))
      .returning();
    if (!row) throw notFound("Ticket");
    return row;
  }

  /** `POST /tickets/:id/assign` `{ assigneeId | null }`; the new assignee is told (not when assigning yourself). */
  async assign(tenantId: string, id: string, input: { assigneeId: string | null }, actorId: string | null = null): Promise<Ticket> {
    const { assigneeId } = assignInputSchema.parse(input);
    const before = await this.row(tenantId, id);
    await this.assertAssignable(tenantId, assigneeId);
    const row = await this.update(tenantId, id, { assigneeId });
    const ticket = toTicket(row, this.now());
    if (assigneeId && assigneeId !== before.assigneeId && assigneeId !== actorId) {
      await this.notifyStaff(row.tenantId, ticket, [assigneeId], SUPPORT_TEMPLATES.assigned, null);
    }
    return ticket;
  }

  /** `POST /tickets/:id/status`; 409 for a move `TICKET_TRANSITIONS` doesn't allow. */
  async setStatus(tenantId: string, id: string, input: { status: TicketStatus }): Promise<Ticket> {
    const { status } = statusInputSchema.parse(input);
    const now = this.now();
    const row = await this.db.transaction(async (tx) => {
      const current = await this.row(tenantId, id, tx, true);
      if (current.status === status) return current;
      if (current.mergedIntoId || !canTransition(current.status, status)) {
        throw new AppError(409, "invalid_transition", `A ${current.status} ticket can't be marked ${status}`, { from: current.status, to: status });
      }
      const [updated] = await tx
        .update(supportTickets)
        .set({ status, ...statusTimestamps(status, now) })
        .where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.id, id)))
        .returning();
      return updated!;
    });
    return toTicket(row, now);
  }

  /** `POST /tickets/:id/priority`; the SLA deadline is recomputed from creation while there is no first response. */
  async setPriority(tenantId: string, id: string, input: { priority: TicketPriority }): Promise<Ticket> {
    const { priority } = priorityInputSchema.parse(input);
    const current = await this.row(tenantId, id);
    const set: Partial<typeof supportTickets.$inferInsert> = { priority };
    if (!current.firstResponseAt) set.slaDueAt = slaDueAt(current.createdAt, priority, await this.settings(tenantId));
    return toTicket(await this.update(tenantId, id, set), this.now());
  }

  /** `PUT /tickets/:id/tags` (replaces the list). */
  async setTags(tenantId: string, id: string, input: { tags: string[] }): Promise<Ticket> {
    const { tags } = tagsInputSchema.parse(input);
    return toTicket(await this.update(tenantId, id, { tags }), this.now());
  }

  /**
   * `POST /tickets/:id/messages` `{ kind: reply|note, body, status? }`. A reply goes to the requester (notify port), sets
   * the first response time and, by default, moves an open ticket to pending. A note is internal: never shown to or sent
   * to the requester. Replies on closed tickets are refused (notes are fine).
   */
  async addStaffMessage(tenantId: string, id: string, staffId: string, input: StaffMessageInput): Promise<{ ticket: Ticket; message: Message }> {
    const b = staffMessageInputSchema.parse(input);
    const kind: MessageKind = b.kind;
    const now = this.now();
    const { row, msg } = await this.db.transaction(async (tx) => {
      const current = await this.row(tenantId, id, tx, true);
      const next = statusAfterMessage(current.status, "staff", kind, b.status ?? null);
      if (!next) {
        throw current.status === "closed"
          ? conflict("This ticket is closed; add a note or ask the customer to raise a new ticket")
          : new AppError(409, "invalid_transition", `A ${current.status} ticket can't be marked ${b.status}`, { from: current.status, to: b.status });
      }
      const [inserted] = await tx
        .insert(supportMessages)
        .values({ tenantId, ticketId: id, authorId: staffId, authorKind: "staff", kind, body: b.body, attachments: b.attachments, createdAt: now })
        .returning();
      const set: Partial<typeof supportTickets.$inferInsert> = {};
      if (next !== current.status) Object.assign(set, { status: next }, statusTimestamps(next, now));
      if (kind === "reply") {
        set.lastMessageAt = now;
        if (!current.firstResponseAt) {
          set.firstResponseAt = now;
          if (missedSla(current.slaDueAt, now)) set.slaBreached = true;
        }
      }
      let updated = current;
      if (Object.keys(set).length) {
        [updated] = (await tx
          .update(supportTickets)
          .set(set)
          .where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.id, id)))
          .returning()) as [TicketRow];
      }
      return { row: updated, msg: toMessage(inserted!) };
    });
    const ticket = toTicket(row, now);
    if (kind === "reply") await this.notifyRequester(row.tenantId, ticket, SUPPORT_TEMPLATES.reply, msg.body);
    return { ticket, message: msg };
  }

  /**
   * `POST /tickets/:id/merge` `{ intoId }`: moves this ticket's messages into `intoId` (same customer only), unions the
   * tags, keeps the earliest first response, notes the merge on the target and closes this ticket (`mergedIntoId`).
   */
  async merge(tenantId: string, sourceId: string, input: { intoId: string }, actorId: string | null = null): Promise<TicketThread> {
    const { intoId } = mergeInputSchema.parse(input);
    if (intoId === sourceId) throw badRequest("Pick a different ticket to merge into");
    const now = this.now();
    await this.db.transaction(async (tx) => {
      // Lock in a stable order so two opposite merges can't deadlock.
      const [first, second] = [sourceId, intoId].sort();
      const a = await this.row(tenantId, first!, tx, true);
      const b = await this.row(tenantId, second!, tx, true);
      const source = a.id === sourceId ? a : b;
      const target = a.id === sourceId ? b : a;
      if (source.mergedIntoId) throw conflict(`${source.number} was already merged`);
      if (target.mergedIntoId) throw conflict(`${target.number} was merged into another ticket; merge into that one`);
      if (target.status === "closed") throw conflict(`${target.number} is closed`);
      if (!sameRequester(source, target)) throw conflict("Only tickets from the same customer can be merged");
      await tx
        .update(supportMessages)
        .set({ ticketId: target.id })
        .where(and(eq(supportMessages.tenantId, tenantId), eq(supportMessages.ticketId, source.id)));
      await tx.insert(supportMessages).values({
        tenantId,
        ticketId: target.id,
        authorId: actorId,
        authorKind: "system",
        kind: "note",
        body: `Merged ${source.number} (“${source.subject}”) into this ticket.`,
        attachments: [],
        createdAt: now,
      });
      const firstResponse = [source.firstResponseAt, target.firstResponseAt].filter((d): d is Date => Boolean(d)).sort((x, y) => x.getTime() - y.getTime())[0] ?? null;
      const last = source.lastMessageAt > target.lastMessageAt ? source.lastMessageAt : target.lastMessageAt;
      await tx
        .update(supportTickets)
        .set({
          tags: [...new Set([...(target.tags ?? []), ...(source.tags ?? [])])],
          firstResponseAt: firstResponse,
          lastMessageAt: last,
          slaBreached: target.slaBreached || source.slaBreached,
          relatedType: target.relatedType ?? source.relatedType,
          relatedId: target.relatedId ?? source.relatedId,
          requesterUserId: target.requesterUserId ?? source.requesterUserId,
          requesterPhone: target.requesterPhone ?? source.requesterPhone,
          requesterEmail: target.requesterEmail ?? source.requesterEmail,
        })
        .where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.id, target.id)));
      await tx
        .update(supportTickets)
        .set({ status: "closed", closedAt: now, mergedIntoId: target.id })
        .where(and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.id, source.id)));
    });
    return this.get(tenantId, intoId);
  }

  // ================================================================ job

  /**
   * Overdue job (run every few minutes from apps/api jobs): flags tickets past their first-response deadline
   * (`sla_breached`) and tells the assignee, or the team when unassigned. Each ticket is flagged once. Shops with
   * `support` off are skipped (via the feature gate). Returns how many were flagged.
   */
  async markOverdue(now: Date = this.now(), batch = 500): Promise<{ marked: number }> {
    const rows = await this.db
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.slaBreached, false), this.overdueSql(now)))
      .orderBy(asc(supportTickets.slaDueAt))
      .limit(batch);
    const enabled = new Map<string, boolean>();
    let marked = 0;
    for (const r of rows) {
      if (!enabled.has(r.tenantId)) {
        let on = true;
        if (this.deps.featureGate) {
          try {
            on = await this.deps.featureGate.isEnabled(r.tenantId, SUPPORT_FEATURE_KEYS.base);
          } catch (err) {
            this.log.warn({ err, tenantId: r.tenantId }, "support: feature gate failed in overdue job");
            on = false;
          }
        }
        enabled.set(r.tenantId, on);
      }
      if (!enabled.get(r.tenantId)) continue;
      const [updated] = await this.db
        .update(supportTickets)
        .set({ slaBreached: true, updatedAt: sql`${supportTickets.updatedAt}` })
        .where(and(eq(supportTickets.tenantId, r.tenantId), eq(supportTickets.id, r.id), eq(supportTickets.slaBreached, false), isNull(supportTickets.firstResponseAt)))
        .returning();
      if (!updated) continue;
      marked++;
      const ticket = toTicket(updated, now);
      if (updated.assigneeId) await this.notifyStaff(r.tenantId, ticket, [updated.assigneeId], SUPPORT_TEMPLATES.overdue, null);
      else await this.notifyTeam(r.tenantId, ticket, SUPPORT_TEMPLATES.overdue, null);
    }
    if (marked) this.log.info({ marked }, "support: tickets past their first-response SLA");
    return { marked };
  }

  // ================================================================ notifications

  private async vars(tenantId: string, ticket: Ticket, audience: "requester" | "staff", message: string | null, channel: NotifierSendInput["channel"]): Promise<Record<string, string>> {
    const links = this.deps.links;
    const safe = async (f: (() => Promise<string> | string) | undefined) => {
      if (!f) return "";
      try {
        return (await f()) ?? "";
      } catch (err) {
        this.log.warn({ err, tenantId, ticketId: ticket.id }, "support: link builder failed");
        return "";
      }
    };
    const linkFn = audience === "requester" ? links?.requester?.bind(links) : links?.staff?.bind(links);
    const [shop, link] = await Promise.all([
      safe(links?.shopName ? () => links.shopName!(tenantId) : undefined),
      safe(linkFn ? () => linkFn(tenantId, ticket) : undefined),
    ]);
    return {
      shop,
      number: ticket.number,
      subject: ticket.subject,
      message: message ? messagePreview(message, channel === "email" ? 2000 : 300) : "",
      link,
      status: ticket.status,
      priority: ticket.priority,
      customer: ticket.requester.name ?? ticket.requester.phone ?? ticket.requester.email ?? "",
    };
  }

  private async send(
    tenantId: string,
    ticket: Ticket,
    template: SupportTemplate,
    targets: { channel: NotifierSendInput["channel"]; to: string }[],
    audience: "requester" | "staff",
    message: string | null,
  ) {
    if (!this.deps.notifier) return;
    for (const t of targets) {
      try {
        const vars = await this.vars(tenantId, ticket, audience, message, t.channel);
        await this.deps.notifier.send({ tenantId, channel: t.channel, to: t.to, template, vars });
      } catch (err) {
        this.log.error({ err, tenantId, ticketId: ticket.id, template, channel: t.channel }, "support: notification failed");
      }
    }
  }

  /** Requester messages (never for notes). Never throws. */
  private async notifyRequester(tenantId: string, ticket: Ticket, template: SupportTemplate, message: string | null) {
    await this.send(tenantId, ticket, template, contactTargets(ticket.requester), "requester", message);
  }

  /** Staff messages to the given members. Never throws. */
  private async notifyStaff(tenantId: string, ticket: Ticket, userIds: string[], template: SupportTemplate, message: string | null) {
    if (!this.deps.notifier || !this.deps.staff) return;
    const contacts: StaffContact[] = [];
    for (const id of new Set(userIds)) {
      try {
        const c = await this.deps.staff.contact(tenantId, id);
        if (c) contacts.push(c);
      } catch (err) {
        this.log.warn({ err, tenantId, ticketId: ticket.id }, "support: staff contact unavailable");
      }
    }
    await this.send(tenantId, ticket, template, contacts.flatMap(contactTargets), "staff", message);
  }

  /** The support team (unassigned tickets). Never throws. */
  private async notifyTeam(tenantId: string, ticket: Ticket, template: SupportTemplate, message: string | null) {
    if (!this.deps.notifier || !this.deps.staff?.team) return;
    let team: StaffContact[] = [];
    try {
      team = await this.deps.staff.team(tenantId);
    } catch (err) {
      this.log.warn({ err, tenantId, ticketId: ticket.id }, "support: support team unavailable");
    }
    await this.send(tenantId, ticket, template, team.flatMap(contactTargets), "staff", message);
  }

  // ================================================================ FAQ: public

  private async publishedArticles(tenantId: string) {
    const rows = await this.db
      .select()
      .from(faqArticles)
      .where(and(eq(faqArticles.tenantId, tenantId), eq(faqArticles.status, "published")))
      .orderBy(asc(faqArticles.sort), asc(faqArticles.title))
      .limit(1000);
    return rows.map(toFaqArticle);
  }

  private async categories(tenantId: string): Promise<FaqCategory[]> {
    const rows = await this.db.select().from(faqCategories).where(eq(faqCategories.tenantId, tenantId)).orderBy(asc(faqCategories.sort), asc(faqCategories.name));
    return rows.map(toFaqCategory);
  }

  /** `GET /public/faq`: categories with their published articles (title + excerpt). */
  async faqIndex(tenantId: string) {
    const [categories, articles] = await Promise.all([this.categories(tenantId), this.publishedArticles(tenantId)]);
    return { items: groupFaq(categories, articles), total: articles.length };
  }

  /** `GET /public/faq/:slug`: one published article (404 for drafts). */
  async faqArticle(tenantId: string, slug: string) {
    const [row] = await this.db
      .select()
      .from(faqArticles)
      .where(and(eq(faqArticles.tenantId, tenantId), eq(faqArticles.slug, slug), eq(faqArticles.status, "published")))
      .limit(1);
    if (!row) throw notFound("Article");
    const a = toFaqArticle(row);
    const category = a.categoryId ? ((await this.categories(tenantId)).find((c) => c.id === a.categoryId) ?? null) : null;
    const { status: _s, createdAt: _c, ...pub } = a;
    return { article: pub, category };
  }

  /** `GET /public/faq/search?q=`: published articles ranked by title/body word matches. */
  async faqSearch(tenantId: string, query: { q?: unknown; limit?: unknown }): Promise<{ items: (FaqArticleSummary & { score: number })[]; total: number }> {
    const q = faqSearchQuerySchema.parse(query);
    if (!q.q) return { items: [], total: 0 };
    const ranked = rankArticles(q.q, await this.publishedArticles(tenantId), q.limit);
    return { items: ranked.map((r) => ({ ...toSummary(r.article), score: r.score })), total: ranked.length };
  }

  /** `POST /public/faq/:slug/helpful` `{ helpful }`. (Not deduplicated server-side; the storefront remembers votes.) */
  async faqHelpful(tenantId: string, slug: string, input: { helpful: boolean }) {
    const { helpful } = helpfulInputSchema.parse(input);
    const [row] = await this.db
      .update(faqArticles)
      .set(
        helpful
          ? { helpfulYes: sql`${faqArticles.helpfulYes} + 1`, updatedAt: sql`${faqArticles.updatedAt}` }
          : { helpfulNo: sql`${faqArticles.helpfulNo} + 1`, updatedAt: sql`${faqArticles.updatedAt}` },
      )
      .where(and(eq(faqArticles.tenantId, tenantId), eq(faqArticles.slug, slug), eq(faqArticles.status, "published")))
      .returning({ helpfulYes: faqArticles.helpfulYes, helpfulNo: faqArticles.helpfulNo });
    if (!row) throw notFound("Article");
    return row;
  }

  // ================================================================ FAQ: staff

  async listCategories(tenantId: string): Promise<{ items: FaqCategory[] }> {
    return { items: await this.categories(tenantId) };
  }

  private async takenSlugs(table: typeof faqArticles | typeof faqCategories, tenantId: string, exceptId?: string): Promise<Set<string>> {
    const rows = await this.db.select({ id: table.id, slug: table.slug }).from(table).where(eq(table.tenantId, tenantId));
    return new Set(rows.filter((r) => r.id !== exceptId).map((r) => r.slug));
  }

  private chooseSlug(wanted: string | null | undefined, from: string, taken: Set<string>, prefix: string): string {
    if (wanted) {
      const problem = slugProblem(wanted, taken);
      if (problem === "taken") throw conflict(`The address "${wanted}" is already used`);
      if (problem) throw badRequest(problem === "reserved" ? `"${wanted}" can't be used as an address` : "Use lower-case letters, digits and hyphens", { field: "slug", problem });
      return wanted;
    }
    return uniqueSlug(slugify(from, prefix), taken);
  }

  async createCategory(tenantId: string, input: FaqCategoryInput): Promise<FaqCategory> {
    const b = faqCategoryInputSchema.parse(input);
    const slug = this.chooseSlug(b.slug, b.name, await this.takenSlugs(faqCategories, tenantId), "topic");
    try {
      const [row] = await this.db.insert(faqCategories).values({ tenantId, name: b.name, slug, description: b.description ?? null, sort: b.sort }).returning();
      return toFaqCategory(row!);
    } catch (err) {
      return conflictOnUnique(err, `The address "${slug}" is already used`);
    }
  }

  async updateCategory(tenantId: string, id: string, input: FaqCategoryPatch): Promise<FaqCategory> {
    const b = faqCategoryPatchSchema.parse(input);
    const set: Partial<typeof faqCategories.$inferInsert> = {};
    if (b.name !== undefined) set.name = b.name;
    if (b.description !== undefined) set.description = b.description ?? null;
    if (b.sort !== undefined) set.sort = b.sort;
    if (b.slug) set.slug = this.chooseSlug(b.slug, "", await this.takenSlugs(faqCategories, tenantId, id), "topic");
    try {
      const [row] = await this.db
        .update(faqCategories)
        .set(set)
        .where(and(eq(faqCategories.tenantId, tenantId), eq(faqCategories.id, id)))
        .returning();
      if (!row) throw notFound("Category");
      return toFaqCategory(row);
    } catch (err) {
      return conflictOnUnique(err, "That address is already used");
    }
  }

  /** Deletes the category; its articles become uncategorised. */
  async deleteCategory(tenantId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(faqCategories)
      .where(and(eq(faqCategories.tenantId, tenantId), eq(faqCategories.id, id)))
      .returning({ id: faqCategories.id });
    if (rows.length === 0) throw notFound("Category");
  }

  /** WHERE of the staff article list; `skip` leaves one filter out (for its facet counts). */
  articleConditions(tenantId: string, q: z.output<typeof faqArticleQuerySchema>, skip?: "status" | "category"): SQL {
    const cats = q.categoryId ?? [];
    const ids = cats.filter((c) => c !== FAQ_NO_CATEGORY);
    const byCategory = [ids.length ? inArray(faqArticles.categoryId, ids) : undefined, cats.includes(FAQ_NO_CATEGORY) ? isNull(faqArticles.categoryId) : undefined].filter(
      (c): c is SQL => c !== undefined,
    );
    return and(
      eq(faqArticles.tenantId, tenantId),
      skip !== "status" && q.status?.length ? inArray(faqArticles.status, q.status) : undefined,
      skip !== "category" && byCategory.length ? or(...byCategory) : undefined,
      searchAny(q.q, [faqArticles.title, faqArticles.body]),
    )!;
  }

  /**
   * Staff `GET /faq/articles`: one page of articles (no body/SEO) with `total` and `facets.status` / `facets.category`
   * (category id, or `none`, → count). Unknown `sort` → 400.
   */
  async listArticles(tenantId: string, query: FaqArticleQuery = {}): Promise<ListPage<FaqArticleListItem>> {
    const q = faqArticleQuerySchema.parse(query);
    const order = FAQ_ARTICLE_SORT.orderBy(q.sort);
    const where = this.articleConditions(tenantId, q);
    const { body: _b, seo: _s, ...columns } = getTableColumns(faqArticles);
    const [page, byStatus, byCategory] = await Promise.all([
      runList(q, {
        rows: () => this.db.select(columns).from(faqArticles).where(where).orderBy(...order).limit(q.limit).offset(q.offset),
        count: () => this.db.select({ total: count() }).from(faqArticles).where(where),
        map: (r): FaqArticleListItem => {
          const { tenantId: _t, ...a } = r;
          return a;
        },
      }),
      this.db.select({ key: faqArticles.status, n: count() }).from(faqArticles).where(this.articleConditions(tenantId, q, "status")).groupBy(faqArticles.status),
      this.db
        .select({ key: sql<string>`coalesce(${faqArticles.categoryId}::text, ${FAQ_NO_CATEGORY})`, n: count() })
        .from(faqArticles)
        .where(this.articleConditions(tenantId, q, "category"))
        .groupBy(faqArticles.categoryId),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus), category: facetCounts(byCategory) } };
  }

  async getArticle(tenantId: string, id: string): Promise<FaqArticle> {
    const [row] = await this.db
      .select()
      .from(faqArticles)
      .where(and(eq(faqArticles.tenantId, tenantId), eq(faqArticles.id, id)))
      .limit(1);
    if (!row) throw notFound("Article");
    return toFaqArticle(row);
  }

  private async assertCategory(tenantId: string, categoryId: string | null | undefined) {
    if (!categoryId) return;
    const [c] = await this.db
      .select({ id: faqCategories.id })
      .from(faqCategories)
      .where(and(eq(faqCategories.tenantId, tenantId), eq(faqCategories.id, categoryId)))
      .limit(1);
    if (!c) throw badRequest("Unknown category", { field: "categoryId" });
  }

  async createArticle(tenantId: string, input: FaqArticleInput): Promise<FaqArticle> {
    const b = faqArticleInputSchema.parse(input);
    await this.assertCategory(tenantId, b.categoryId);
    const slug = this.chooseSlug(b.slug, b.title, await this.takenSlugs(faqArticles, tenantId), "faq");
    try {
      const [row] = await this.db
        .insert(faqArticles)
        .values({
          tenantId,
          categoryId: b.categoryId ?? null,
          slug,
          title: b.title,
          body: b.body,
          status: b.status,
          sort: b.sort,
          seo: b.seo ?? null,
          publishedAt: b.status === "published" ? this.now() : null,
        })
        .returning();
      return toFaqArticle(row!);
    } catch (err) {
      return conflictOnUnique(err, `The address "${slug}" is already used`);
    }
  }

  async updateArticle(tenantId: string, id: string, input: FaqArticlePatch): Promise<FaqArticle> {
    const b = faqArticlePatchSchema.parse(input);
    const current = await this.getArticle(tenantId, id);
    if (b.categoryId !== undefined) await this.assertCategory(tenantId, b.categoryId);
    const set: Partial<typeof faqArticles.$inferInsert> = {};
    if (b.title !== undefined) set.title = b.title;
    if (b.body !== undefined) set.body = b.body;
    if (b.categoryId !== undefined) set.categoryId = b.categoryId ?? null;
    if (b.sort !== undefined) set.sort = b.sort;
    if (b.seo !== undefined) set.seo = b.seo ?? null;
    if (b.slug && b.slug !== current.slug) set.slug = this.chooseSlug(b.slug, "", await this.takenSlugs(faqArticles, tenantId, id), "faq");
    if (b.status !== undefined && b.status !== current.status) {
      set.status = b.status;
      if (b.status === "published") set.publishedAt = current.publishedAt ?? this.now();
    }
    if (Object.keys(set).length === 0) return current;
    try {
      const [row] = await this.db
        .update(faqArticles)
        .set(set)
        .where(and(eq(faqArticles.tenantId, tenantId), eq(faqArticles.id, id)))
        .returning();
      if (!row) throw notFound("Article");
      return toFaqArticle(row);
    } catch (err) {
      return conflictOnUnique(err, "That address is already used");
    }
  }

  /** Publishing needs a body. The first publish sets `publishedAt`. */
  async publishArticle(tenantId: string, id: string): Promise<FaqArticle> {
    const a = await this.getArticle(tenantId, id);
    if (!a.body.trim()) throw badRequest("Write the answer before publishing", { field: "body" });
    return this.updateArticle(tenantId, id, { status: "published" });
  }

  async unpublishArticle(tenantId: string, id: string): Promise<FaqArticle> {
    return this.updateArticle(tenantId, id, { status: "draft" });
  }

  async deleteArticle(tenantId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(faqArticles)
      .where(and(eq(faqArticles.tenantId, tenantId), eq(faqArticles.id, id)))
      .returning({ id: faqArticles.id });
    if (rows.length === 0) throw notFound("Article");
  }
}

