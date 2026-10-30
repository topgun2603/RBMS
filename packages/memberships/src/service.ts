import { AppError, badRequest, conflict, defineSort, facetCounts, listFilter, listQuerySchema, notFound, searchAny, type ListPage, type TenantRef } from "@rbms/core";
import type { Db, Tx } from "@rbms/db";
import { isGstRate, isValidDate, todayIST } from "@rbms/gst";
import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  addDays,
  canFreeze,
  checkinDecision,
  currentSubscription,
  daysLeft,
  endDateFor,
  fillDays,
  formatMemberCode,
  freezeDaysLeft,
  istDayStart,
  MEMBER_STATUSES,
  MEMBERSHIPS_SETTINGS_SCHEMA,
  memberStatus,
  parseLookup,
  renewalStart,
  resolveMembershipsSettings,
  sessionsLeft,
  subscriptionState,
  toIndianE164,
  unfreezeResult,
  type CheckinRefusal,
  type MembershipsSettings,
  type MemberStatus,
  type SubscriptionState,
} from "./logic";
import {
  noopLogger,
  type BillingPort,
  type BillResult,
  type ExpiringMembership,
  type LoggerPort,
  type MembershipNotifyPort,
  type MembershipsSettingsPort,
  type ReminderPort,
} from "./ports";
import {
  membershipCheckins,
  membershipMembers,
  membershipPlans,
  membershipSubscriptions,
  type MembershipCheckinRow,
  type MembershipMemberRow,
  type MembershipPlanRow,
  type MembershipSubscriptionRow,
} from "./schema";

export interface MembershipsDeps {
  db: Db;
  /** Bills sold plans (invoices). Without it plans are sold unbilled and "bill now" is refused. */
  billing?: BillingPort;
  /** Expiry reminders (WhatsApp / SMS) for `remindExpiring`. Optional. */
  reminders?: ReminderPort;
  /** "Welcome" / "renewed" messages when a plan is sold. Optional. */
  notify?: MembershipNotifyPort;
  /** Settings namespace `memberships`. Without it the defaults apply and `PUT /settings` is refused. */
  settings?: MembershipsSettingsPort;
  log?: LoggerPort;
  now?: () => Date;
}

const M = membershipMembers;
const S = membershipSubscriptions;
const C = membershipCheckins;
const P = membershipPlans;

const MAX_PAISE = 2_000_000_000;
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const dateStr = z.string().refine(isValidDate, "Use a YYYY-MM-DD date");
const phoneInput = z
  .string()
  .trim()
  .max(20)
  .nullish()
  .transform((v, ctx) => {
    if (!v) return null;
    const e164 = toIndianE164(v);
    if (!e164) ctx.addIssue({ code: "custom", message: "Enter a 10-digit Indian mobile number" });
    return e164;
  });

export const planInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: optText(500),
    durationDays: z.number().int().min(1).max(3660),
    /** Visits included; null / absent = unlimited. */
    sessions: z.number().int().min(1).max(10_000).nullish(),
    price: z.number().int().min(0).max(MAX_PAISE),
    gstRate: z.number().refine(isGstRate, "Pick a GST rate").default(18),
    itemId: z.string().uuid().nullish(),
    freezeDaysAllowed: z.number().int().min(0).max(365).default(0),
    active: z.boolean().optional(),
    sort: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
export type PlanInput = z.input<typeof planInput>;
export const planPatch = planInput.partial().strict();

export const sellInput = z
  .object({
    planId: z.string().uuid(),
    /** Default today. */
    startDate: dateStr.optional(),
    /** Make the GST bill now (needs billing). */
    billNow: z.boolean().default(false),
    /** Paise; default the plan's price (a discount at the desk). */
    price: z.number().int().min(0).max(MAX_PAISE).optional(),
    tillSessionId: z.string().uuid().nullish(),
  })
  .strict();
export type SellInput = z.input<typeof sellInput>;

export const renewInput = z
  .object({
    /** Default the same plan. */
    planId: z.string().uuid().optional(),
    billNow: z.boolean().default(false),
    price: z.number().int().min(0).max(MAX_PAISE).optional(),
    tillSessionId: z.string().uuid().nullish(),
  })
  .strict();
export type RenewInput = z.input<typeof renewInput>;

export const memberFields = z.object({
  name: z.string().trim().min(1).max(120),
  phone: phoneInput,
  customerId: z.string().uuid().nullish(),
  notes: optText(1000),
  photoUrl: optText(2048),
});
export const memberInput = memberFields.extend({ plan: sellInput.optional() }).strict();
export type MemberInput = z.input<typeof memberInput>;
export const memberPatch = memberFields.partial().strict();

export const freezeInput = z.object({ from: dateStr.optional() }).strict();
export const cancelInput = z.object({ reason: z.string().trim().min(2).max(200) }).strict();
export const billLaterInput = z.object({ tillSessionId: z.string().uuid().nullish() }).strict();

export const checkinInput = z
  .object({
    memberId: z.string().uuid().optional(),
    /** Mobile number, member code ("M-0042") or member number (42). */
    code: z.string().trim().min(1).max(30).optional(),
    note: optText(200),
  })
  .strict()
  .refine((b) => b.memberId || b.code, { message: "Enter a mobile number or member code", path: ["code"] });
export type CheckinInput = z.input<typeof checkinInput>;

/** GET /members: `status` (active | expiring | expired | none, comma list), `within` days for "expiring" (default: settings). */
export const memberListQuery = listQuerySchema().extend({
  status: listFilter.oneOf(MEMBER_STATUSES),
  within: z.coerce.number().int().min(1).max(90).optional(),
});
export type MemberListQuery = z.input<typeof memberListQuery>;

export const withinQuery = z.object({ within: z.coerce.number().int().min(1).max(90).optional() });
export const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });
export const dateQuery = z.object({ date: dateStr.optional() });

/** The member's latest end date over plans not cancelled (null = never had one). */
/*
 * Correlated subqueries name their columns in full: in a single-table select drizzle prints columns bare, so
 * `${S.memberId} = ${M.id}` would become `member_id = id` and compare the subscription with itself.
 */
export const lastEndSql = sql`(select max(ls.end_date) from ${S} ls where ls.tenant_id = "membership_members"."tenant_id" and ls.member_id = "membership_members"."id" and ls.status <> 'cancelled')`;
const lastVisitSql = sql`(select max(lc.at) from ${C} lc where lc.tenant_id = "membership_members"."tenant_id" and lc.member_id = "membership_members"."id")`;

export const MEMBER_SORT = defineSort(
  { name: sql`lower(${M.name})`, code: M.memberNo, endsOn: lastEndSql, lastVisit: lastVisitSql, joined: M.createdAt },
  { default: "name", tieBreaker: [M.id] },
);

export interface SubscriptionView extends MembershipSubscriptionRow {
  state: SubscriptionState;
  daysLeft: number;
  sessionsLeft: number | null;
  freezeDaysLeft: number;
}

export interface MemberSummary extends MembershipMemberRow {
  status: MemberStatus;
  /** The plan that decides check-in: covering today (or frozen), else the next upcoming, else the last ended. */
  current: SubscriptionView | null;
  lastVisitAt: string | null;
}

export interface CheckinView extends MembershipCheckinRow {
  planName: string | null;
}

export interface TodayCheckin {
  id: string;
  at: Date;
  note: string | null;
  memberId: string;
  memberCode: string;
  name: string;
  phone: string | null;
  photoUrl: string | null;
  planName: string | null;
}

export interface MemberDetail extends MemberSummary {
  subscriptions: SubscriptionView[];
  checkins: CheckinView[];
}

export interface CheckinResult {
  ok: boolean;
  reason: CheckinRefusal | null;
  member: MembershipMemberRow;
  subscription: SubscriptionView | null;
  sessionsLeft: number | null;
  daysLeft: number | null;
  /** The visit just recorded (null when refused). */
  checkin: MembershipCheckinRow | null;
  /** Their latest visit before this one today, if any. */
  lastCheckinAt: Date | null;
}

export interface MembershipsSummary {
  within: number;
  /** Members with a plan covering today (frozen ones included). */
  activeMembers: number;
  frozenMembers: number;
  /** Members whose last plan ends within `within` days. */
  expiring: number;
  checkinsToday: number;
}

const REFUSAL_MESSAGES: Record<string, string> = {
  not_active: "Only a running plan can be frozen",
  no_freeze_days: "No freeze days left on this plan",
  already_frozen: "This plan is already frozen",
};

/** Raw `max(timestamptz)` from a subquery: Date or a Postgres text timestamp → ISO, or null. */
function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** Raw `max(date)` → "YYYY-MM-DD" or null. */
const toDateStr = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

function uniqueViolation(err: unknown): { constraint: string } | null {
  const e = err as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } } | null;
  if (e?.code === "23505") return { constraint: e.constraint_name ?? "" };
  if (e?.cause?.code === "23505") return { constraint: e.cause.constraint_name ?? "" };
  return null;
}

export class MembershipsService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: MembershipsDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  today() {
    return todayIST(this.now());
  }

  // ---------------------------------------------------------------- settings

  async getSettings(tenantId: string): Promise<MembershipsSettings> {
    if (!this.deps.settings) return resolveMembershipsSettings(null);
    try {
      return resolveMembershipsSettings(await this.deps.settings.get(tenantId));
    } catch (err) {
      this.log.warn({ err, tenantId }, "memberships: settings unavailable, using defaults");
      return resolveMembershipsSettings(null);
    }
  }

  /** Validates a patch (the merged result must be valid as a whole) and stores it on the tenant layer. */
  async updateSettings(tenantId: string, patch: unknown): Promise<MembershipsSettings> {
    const port = this.deps.settings;
    if (!port?.set) throw badRequest("Membership settings can't be changed here");
    const p = MEMBERSHIPS_SETTINGS_SCHEMA.partial().strict().parse(patch ?? {});
    const merged = MEMBERSHIPS_SETTINGS_SCHEMA.parse({ ...(await this.getSettings(tenantId)), ...p });
    await port.set(tenantId, p);
    return merged;
  }

  // ---------------------------------------------------------------- plans

  async plans(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<MembershipPlanRow[]> {
    return this.db
      .select()
      .from(P)
      .where(and(eq(P.tenantId, tenantId), opts.includeInactive ? undefined : eq(P.active, true)))
      .orderBy(asc(P.sort), asc(P.durationDays), asc(P.name));
  }

  private async plan(tenantId: string, id: string, tx: Db | Tx = this.db): Promise<MembershipPlanRow> {
    const [row] = await tx
      .select()
      .from(P)
      .where(and(eq(P.tenantId, tenantId), eq(P.id, id)))
      .limit(1);
    if (!row) throw notFound("Plan");
    return row;
  }

  async createPlan(tenantId: string, input: unknown): Promise<MembershipPlanRow> {
    const b = planInput.parse(input);
    try {
      const [row] = await this.db
        .insert(P)
        .values({ tenantId, ...b, sessions: b.sessions ?? null, itemId: b.itemId ?? null, active: b.active ?? true, sort: b.sort ?? 0 })
        .returning();
      return row!;
    } catch (err) {
      if (uniqueViolation(err)) throw conflict("A plan with that name exists");
      throw err;
    }
  }

  async updatePlan(tenantId: string, id: string, input: unknown): Promise<MembershipPlanRow> {
    const b = planPatch.parse(input);
    await this.plan(tenantId, id);
    const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    try {
      const [row] = await this.db
        .update(P)
        .set({ ...set, updatedAt: new Date() })
        .where(and(eq(P.tenantId, tenantId), eq(P.id, id)))
        .returning();
      return row!;
    } catch (err) {
      if (uniqueViolation(err)) throw conflict("A plan with that name exists");
      throw err;
    }
  }

  /** Deletes a plan nobody bought; a plan in use can only be switched off. */
  async deletePlan(tenantId: string, id: string): Promise<void> {
    await this.plan(tenantId, id);
    const [used] = await this.db
      .select({ id: S.id })
      .from(S)
      .where(and(eq(S.tenantId, tenantId), eq(S.planId, id)))
      .limit(1);
    if (used) throw new AppError(409, "plan_in_use", "Members have bought this plan: switch it off instead");
    await this.db.delete(P).where(and(eq(P.tenantId, tenantId), eq(P.id, id)));
  }

  // ---------------------------------------------------------------- members

  private subView(row: MembershipSubscriptionRow, today: string): SubscriptionView {
    return {
      ...row,
      state: subscriptionState(row, today),
      daysLeft: daysLeft(row.endDate, today),
      sessionsLeft: sessionsLeft(row.sessionsTotal, row.sessionsUsed),
      freezeDaysLeft: freezeDaysLeft(row.freezeDaysAllowed, row.freezeDaysUsed),
    };
  }

  /** WHERE of the member list; without `status` for the status facet counts. */
  listConditions(tenantId: string, q: z.output<typeof memberListQuery>, today: string, within: number, withStatus = true): SQL | undefined {
    const horizon = addDays(today, within);
    const statusSql = (s: MemberStatus): SQL =>
      s === "none"
        ? sql`${lastEndSql} is null`
        : s === "expired"
          ? sql`${lastEndSql} < ${today}`
          : s === "expiring"
            ? sql`${lastEndSql} between ${today} and ${horizon}`
            : sql`${lastEndSql} > ${horizon}`;
    const statuses = withStatus && q.status?.length ? q.status : null;
    return and(
      eq(M.tenantId, tenantId),
      statuses ? sql`(${sql.join(statuses.map(statusSql), sql` or `)})` : undefined,
      searchAny(q.q, [M.name, M.phone, M.memberCode]),
    );
  }

  /** Members with their current plan and last visit. `facets.status` counts each status under the other filters. */
  async listMembers(tenantId: string, query: MemberListQuery = {}): Promise<ListPage<MemberSummary>> {
    const q = memberListQuery.parse(query);
    const order = MEMBER_SORT.orderBy(q.sort);
    const today = this.today();
    const within = q.within ?? (await this.getSettings(tenantId)).expiringDays;
    const horizon = addDays(today, within);
    const where = this.listConditions(tenantId, q, today, within);
    const base = this.listConditions(tenantId, q, today, within, false);
    const [rows, [total], [facet]] = await Promise.all([
      this.db
        .select({ member: M, lastEnd: lastEndSql, lastVisit: lastVisitSql })
        .from(M)
        .where(where)
        .orderBy(...order)
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ n: count() }).from(M).where(where),
      this.db
        .select({
          active: sql<number>`count(*) filter (where ${lastEndSql} > ${horizon})::int`,
          expiring: sql<number>`count(*) filter (where ${lastEndSql} between ${today} and ${horizon})::int`,
          expired: sql<number>`count(*) filter (where ${lastEndSql} < ${today})::int`,
          none: sql<number>`count(*) filter (where ${lastEndSql} is null)::int`,
        })
        .from(M)
        .where(base),
    ]);
    const subs = await this.subsOf(tenantId, rows.map((r) => r.member.id));
    return {
      items: rows.map((r) => this.memberSummary(r.member, subs.get(r.member.id) ?? [], toDateStr(r.lastEnd), toIso(r.lastVisit), today, within)),
      total: total?.n ?? 0,
      limit: q.limit,
      offset: q.offset,
      facets: { status: facet ?? { active: 0, expiring: 0, expired: 0, none: 0 } },
    };
  }

  /** Subscriptions not cancelled, per member. */
  private async subsOf(tenantId: string, memberIds: string[]): Promise<Map<string, MembershipSubscriptionRow[]>> {
    const out = new Map<string, MembershipSubscriptionRow[]>();
    if (memberIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(S)
      .where(and(eq(S.tenantId, tenantId), inArray(S.memberId, memberIds), ne(S.status, "cancelled")));
    for (const r of rows) out.set(r.memberId, [...(out.get(r.memberId) ?? []), r]);
    return out;
  }

  private memberSummary(member: MembershipMemberRow, subs: MembershipSubscriptionRow[], lastEnd: string | null, lastVisitAt: string | null, today: string, within: number): MemberSummary {
    const cur = currentSubscription(subs, today);
    return { ...member, status: memberStatus(lastEnd, today, within), current: cur ? this.subView(cur, today) : null, lastVisitAt };
  }

  private async memberRow(tenantId: string, id: string, tx: Db | Tx = this.db): Promise<MembershipMemberRow> {
    const [row] = await tx
      .select()
      .from(M)
      .where(and(eq(M.tenantId, tenantId), eq(M.id, id)))
      .limit(1);
    if (!row) throw notFound("Member");
    return row;
  }

  /** Profile, current plan, every plan (newest first) and the last 30 visits. */
  async getMember(tenantId: string, id: string): Promise<MemberDetail> {
    const member = await this.memberRow(tenantId, id);
    const today = this.today();
    const [subs, checkins, settings] = await Promise.all([
      this.db
        .select()
        .from(S)
        .where(and(eq(S.tenantId, tenantId), eq(S.memberId, id)))
        .orderBy(desc(S.startDate), desc(S.createdAt)),
      this.db
        .select({ c: C, planName: S.planName })
        .from(C)
        .leftJoin(S, eq(S.id, C.subscriptionId))
        .where(and(eq(C.tenantId, tenantId), eq(C.memberId, id)))
        .orderBy(desc(C.at))
        .limit(30),
      this.getSettings(tenantId),
    ]);
    const live = subs.filter((s) => s.status !== "cancelled");
    const lastEnd = live.reduce<string | null>((m, s) => (!m || s.endDate > m ? s.endDate : m), null);
    return {
      ...this.memberSummary(member, live, lastEnd, checkins[0] ? checkins[0].c.at.toISOString() : null, today, settings.expiringDays),
      subscriptions: subs.map((s) => this.subView(s, today)),
      checkins: checkins.map((r) => ({ ...r.c, planName: r.planName })),
    };
  }

  private async phoneTaken(tenantId: string, phone: string | null, exceptId?: string) {
    if (!phone) return;
    const [other] = await this.db
      .select({ id: M.id })
      .from(M)
      .where(and(eq(M.tenantId, tenantId), eq(M.phone, phone), exceptId ? ne(M.id, exceptId) : undefined))
      .limit(1);
    if (other) throw new AppError(409, "phone_taken", "A member with this mobile number exists", { memberId: other.id });
  }

  /**
   * Adds a member with the next member code ("M-0042"). With `plan` the plan is sold straight away (and billed when
   * `billNow`); if that fails the member stays and the error is returned.
   */
  async createMember(tenant: TenantRef, input: unknown, opts: { branchId?: string | null; userId?: string | null } = {}): Promise<MemberDetail> {
    const b = memberInput.parse(input);
    const tenantId = tenant.id;
    await this.phoneTaken(tenantId, b.phone);
    if (b.plan) await this.plan(tenantId, b.plan.planId);
    const { memberCodePrefix } = await this.getSettings(tenantId);
    let member: MembershipMemberRow;
    try {
      member = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`memberships:member-no:${tenantId}`}))`);
        const [r] = await tx
          .select({ n: sql<number>`coalesce(max(${M.memberNo}), 0)::int` })
          .from(M)
          .where(eq(M.tenantId, tenantId));
        const memberNo = (r?.n ?? 0) + 1;
        const [row] = await tx
          .insert(M)
          .values({
            tenantId,
            memberNo,
            memberCode: formatMemberCode(memberCodePrefix, memberNo),
            name: b.name,
            phone: b.phone,
            customerId: b.customerId ?? null,
            notes: b.notes,
            photoUrl: b.photoUrl,
          })
          .returning();
        return row!;
      });
    } catch (err) {
      const u = uniqueViolation(err);
      if (u?.constraint.includes("phone")) throw new AppError(409, "phone_taken", "A member with this mobile number exists");
      if (u) throw conflict("That member code is taken: try again");
      throw err;
    }
    if (b.plan) await this.sell(tenant, member.id, b.plan, opts);
    return this.getMember(tenantId, member.id);
  }

  async updateMember(tenantId: string, id: string, input: unknown): Promise<MemberDetail> {
    const b = memberPatch.parse(input);
    await this.memberRow(tenantId, id);
    if (b.phone !== undefined) await this.phoneTaken(tenantId, b.phone, id);
    const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    try {
      await this.db
        .update(M)
        .set({ ...set, updatedAt: new Date() })
        .where(and(eq(M.tenantId, tenantId), eq(M.id, id)));
    } catch (err) {
      if (uniqueViolation(err)) throw new AppError(409, "phone_taken", "A member with this mobile number exists");
      throw err;
    }
    return this.getMember(tenantId, id);
  }

  /** Removes a member who never bought a plan (a mistake); members with history stay. */
  async deleteMember(tenantId: string, id: string): Promise<void> {
    await this.memberRow(tenantId, id);
    const [sub] = await this.db
      .select({ id: S.id })
      .from(S)
      .where(and(eq(S.tenantId, tenantId), eq(S.memberId, id)))
      .limit(1);
    if (sub) throw new AppError(409, "member_has_history", "This member has plans on record and can't be deleted");
    await this.db.delete(M).where(and(eq(M.tenantId, tenantId), eq(M.id, id)));
  }

  // ---------------------------------------------------------------- selling, renewals, freezes

  private async subRow(tenantId: string, id: string, tx: Db | Tx = this.db, lock = false): Promise<MembershipSubscriptionRow> {
    const q = tx
      .select()
      .from(S)
      .where(and(eq(S.tenantId, tenantId), eq(S.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Plan");
    return row;
  }

  private billLines(plan: Pick<MembershipPlanRow, "name" | "itemId" | "gstRate">, price: number, start: string, end: string, memberCode: string) {
    return [
      {
        description: `${plan.name} · ${memberCode} · ${start} to ${end}`,
        itemId: plan.itemId ?? null,
        qty: 1,
        rate: price,
        gstRate: plan.gstRate,
        hsn: null,
        unit: null,
      },
    ];
  }

  /**
   * Records a sold plan (one plan at a time: 409 `has_plan` when it would overlap another one not cancelled), then
   * bills it when asked. A failed bill removes the new plan again so the desk can retry.
   */
  private async createSubscription(
    tenant: TenantRef,
    member: MembershipMemberRow,
    plan: MembershipPlanRow,
    start: string,
    o: { price?: number; billNow: boolean; tillSessionId?: string | null; renewedFromId?: string | null; userId?: string | null; branchId?: string | null },
  ): Promise<SubscriptionView> {
    const tenantId = tenant.id;
    if (!plan.active) throw new AppError(409, "plan_inactive", "This plan is switched off");
    if (o.billNow && !this.deps.billing) throw new AppError(501, "billing_unavailable", "Billing is not available");
    const end = endDateFor(start, plan.durationDays);
    const price = o.price ?? plan.price;
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`memberships:member:${member.id}`}))`);
      const [overlap] = await tx
        .select({ id: S.id, endDate: S.endDate })
        .from(S)
        .where(and(eq(S.tenantId, tenantId), eq(S.memberId, member.id), ne(S.status, "cancelled"), gte(S.endDate, start), lte(S.startDate, end)))
        .limit(1);
      if (overlap) throw new AppError(409, "has_plan", `This member has a plan until ${overlap.endDate}: renew it instead`, { subscriptionId: overlap.id });
      const [r] = await tx
        .insert(S)
        .values({
          tenantId,
          memberId: member.id,
          planId: plan.id,
          planName: plan.name,
          startDate: start,
          endDate: end,
          sessionsTotal: plan.sessions,
          freezeDaysAllowed: plan.freezeDaysAllowed,
          price,
          renewedFromId: o.renewedFromId ?? null,
          soldBy: o.userId ?? null,
        })
        .returning();
      return r!;
    });
    if (!o.billNow) return this.subView(row, this.today());
    let bill: BillResult;
    try {
      bill = await this.deps.billing!.createBill(
        tenant,
        {
          lines: this.billLines(plan, price, start, end, member.memberCode),
          customer: { name: member.name, phone: member.phone },
          notes: `Membership ${member.memberCode}`,
          tillSessionId: o.tillSessionId ?? null,
        },
        { branchId: o.branchId ?? null },
      );
    } catch (err) {
      await this.db.delete(S).where(and(eq(S.tenantId, tenantId), eq(S.id, row.id)));
      this.log.error({ err, tenantId, memberId: member.id, planId: plan.id }, "memberships: billing failed, plan not sold");
      throw err;
    }
    const [billed] = await this.db
      .update(S)
      .set({ invoiceId: bill.id, updatedAt: new Date() })
      .where(eq(S.id, row.id))
      .returning();
    return this.subView(billed!, this.today());
  }

  /** Sells a plan to a member from `startDate` (default today), optionally billing it now. */
  async sell(tenant: TenantRef, memberId: string, input: unknown, opts: { branchId?: string | null; userId?: string | null } = {}): Promise<SubscriptionView> {
    const b = sellInput.parse(input);
    const [member, plan] = await Promise.all([this.memberRow(tenant.id, memberId), this.plan(tenant.id, b.planId)]);
    const sub = await this.createSubscription(tenant, member, plan, b.startDate ?? this.today(), { ...b, ...opts });
    this.notifySold(tenant.id, member, sub, false);
    return sub;
  }

  /** Tells the notify port about a sold / renewed plan. Never throws. */
  private notifySold(tenantId: string, member: MembershipMemberRow, sub: SubscriptionView, renewal: boolean) {
    const n = this.deps.notify;
    if (!n) return;
    const notice = {
      memberId: member.id,
      memberCode: member.memberCode,
      name: member.name,
      phone: member.phone,
      subscriptionId: sub.id,
      planName: sub.planName,
      startDate: sub.startDate,
      endDate: sub.endDate,
      renewal,
    };
    try {
      void Promise.resolve(n.sold(tenantId, notice)).catch((err: unknown) => this.log.warn({ err, tenantId, memberId: member.id }, "memberships: notify failed"));
    } catch (err) {
      this.log.warn({ err, tenantId, memberId: member.id }, "memberships: notify failed");
    }
  }

  /**
   * Renews: a new plan (same plan unless `planId`) continuing the day after this one ends, or from today once it has
   * ended. The latest plan only; a frozen one is unfrozen first.
   */
  async renew(tenant: TenantRef, id: string, input: unknown, opts: { branchId?: string | null; userId?: string | null } = {}): Promise<SubscriptionView> {
    const b = renewInput.parse(input);
    const tenantId = tenant.id;
    const prev = await this.subRow(tenantId, id);
    if (prev.status === "cancelled") throw new AppError(409, "cancelled", "This plan was cancelled: sell a new one instead");
    if (prev.status === "frozen") throw new AppError(409, "frozen", "This plan is frozen: unfreeze it first");
    const [later] = await this.db
      .select({ id: S.id })
      .from(S)
      .where(and(eq(S.tenantId, tenantId), eq(S.memberId, prev.memberId), ne(S.status, "cancelled"), gt(S.startDate, prev.endDate)))
      .limit(1);
    if (later) throw new AppError(409, "already_renewed", "This plan has already been renewed", { subscriptionId: later.id });
    const [member, plan] = await Promise.all([this.memberRow(tenantId, prev.memberId), this.plan(tenantId, b.planId ?? prev.planId)]);
    const sub = await this.createSubscription(tenant, member, plan, renewalStart(prev.endDate, this.today()), { ...b, ...opts, renewedFromId: prev.id });
    this.notifySold(tenantId, member, sub, true);
    return sub;
  }

  /** Bills a plan sold without a bill. */
  async billLater(tenant: TenantRef, id: string, input: unknown, opts: { branchId?: string | null } = {}): Promise<SubscriptionView> {
    const b = billLaterInput.parse(input ?? {});
    const billing = this.deps.billing;
    if (!billing) throw new AppError(501, "billing_unavailable", "Billing is not available");
    const tenantId = tenant.id;
    // The row stays locked while the bill is made so two devices can't bill it twice.
    const row = await this.db.transaction(async (tx) => {
      const sub = await this.subRow(tenantId, id, tx, true);
      if (sub.status === "cancelled") throw new AppError(409, "cancelled", "This plan was cancelled");
      if (sub.invoiceId) throw new AppError(409, "already_billed", "This plan is already billed", { invoiceId: sub.invoiceId });
      const [member, plan] = await Promise.all([this.memberRow(tenantId, sub.memberId, tx), this.plan(tenantId, sub.planId, tx).catch(() => null)]);
      const bill = await billing.createBill(
        tenant,
        {
          lines: this.billLines({ name: sub.planName, itemId: plan?.itemId ?? null, gstRate: plan?.gstRate ?? 18 }, sub.price, sub.startDate, sub.endDate, member.memberCode),
          customer: { name: member.name, phone: member.phone },
          notes: `Membership ${member.memberCode}`,
          tillSessionId: b.tillSessionId ?? null,
        },
        { branchId: opts.branchId ?? null },
      );
      const [u] = await tx.update(S).set({ invoiceId: bill.id, updatedAt: new Date() }).where(eq(S.id, id)).returning();
      return u!;
    });
    return this.subView(row, this.today());
  }

  /** Pauses a running plan from `from` (default today; not before it started, not in the future). */
  async freeze(tenantId: string, id: string, input: unknown): Promise<SubscriptionView> {
    const b = freezeInput.parse(input ?? {});
    const today = this.today();
    const from = b.from ?? today;
    const row = await this.db.transaction(async (tx) => {
      const sub = await this.subRow(tenantId, id, tx, true);
      const refusal = canFreeze(sub, today);
      if (refusal) throw new AppError(409, refusal, REFUSAL_MESSAGES[refusal]!);
      if (from > today || from < sub.startDate) throw badRequest("Freeze from a day between the plan's start and today");
      const [u] = await tx.update(S).set({ status: "frozen", frozenFrom: from, updatedAt: new Date() }).where(eq(S.id, id)).returning();
      return u!;
    });
    return this.subView(row, today);
  }

  /** Resumes a frozen plan: the end date moves out by the days frozen, capped at the freeze days left. */
  async unfreeze(tenantId: string, id: string): Promise<SubscriptionView & { credited: number; frozenDays: number }> {
    const today = this.today();
    const { row, r } = await this.db.transaction(async (tx) => {
      const sub = await this.subRow(tenantId, id, tx, true);
      if (sub.status !== "frozen" || !sub.frozenFrom) throw new AppError(409, "not_frozen", "This plan isn't frozen");
      const r = unfreezeResult({ ...sub, frozenFrom: sub.frozenFrom }, today);
      const [u] = await tx
        .update(S)
        .set({ status: "active", frozenFrom: null, endDate: r.endDate, freezeDaysUsed: r.freezeDaysUsed, updatedAt: new Date() })
        .where(eq(S.id, id))
        .returning();
      return { row: u!, r };
    });
    return { ...this.subView(row, today), credited: r.credited, frozenDays: r.frozenDays };
  }

  /** Cancels a plan (its bill, if any, is left as it is: issue a credit note there for a refund). */
  async cancel(tenantId: string, id: string, input: unknown): Promise<SubscriptionView> {
    const { reason } = cancelInput.parse(input);
    const row = await this.db.transaction(async (tx) => {
      const sub = await this.subRow(tenantId, id, tx, true);
      if (sub.status === "cancelled") return sub;
      const [u] = await tx
        .update(S)
        .set({ status: "cancelled", cancelReason: reason, cancelledAt: this.now(), frozenFrom: null, updatedAt: new Date() })
        .where(eq(S.id, id))
        .returning();
      return u!;
    });
    return this.subView(row, this.today());
  }

  // ---------------------------------------------------------------- check-in

  /** The member behind a front-desk lookup (mobile, code or number), or null. */
  async findMember(tenantId: string, code: string): Promise<MembershipMemberRow | null> {
    const l = parseLookup(code);
    if (!l) return null;
    const cond = l.kind === "phone" ? eq(M.phone, l.phone) : l.kind === "number" ? eq(M.memberNo, l.n) : sql`upper(${M.memberCode}) = ${l.code}`;
    const [row] = await this.db
      .select()
      .from(M)
      .where(and(eq(M.tenantId, tenantId), cond))
      .limit(1);
    return row ?? null;
  }

  /**
   * Checks a member in by id or by what the desk typed. Refusals are answers, not errors: `ok: false` with `reason`
   * (no_active_plan, frozen, no_sessions_left, already_checked_in) and the member's plan for the screen. A session pack
   * uses one session per visit. Unknown member: 404 `member_not_found`.
   */
  async checkIn(tenantId: string, input: unknown, userId: string | null = null): Promise<CheckinResult> {
    const b = checkinInput.parse(input);
    const member = b.memberId ? await this.memberRow(tenantId, b.memberId) : await this.findMember(tenantId, b.code!);
    if (!member) throw new AppError(404, "member_not_found", "No member with that mobile number or code");
    const settings = await this.getSettings(tenantId);
    const today = this.today();
    const dayFrom = istDayStart(today);
    const dayTo = istDayStart(addDays(today, 1));
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`memberships:checkin:${member.id}`}))`);
      const subs = await tx
        .select()
        .from(S)
        .where(and(eq(S.tenantId, tenantId), eq(S.memberId, member.id), ne(S.status, "cancelled")));
      const cur = currentSubscription(subs, today);
      const state = cur ? subscriptionState(cur, today) : null;
      const [last] = await tx
        .select({ at: C.at })
        .from(C)
        .where(and(eq(C.tenantId, tenantId), eq(C.memberId, member.id), gte(C.at, dayFrom), lt(C.at, dayTo)))
        .orderBy(desc(C.at))
        .limit(1);
      const decision = checkinDecision({
        state,
        sessionsTotal: cur?.sessionsTotal ?? null,
        sessionsUsed: cur?.sessionsUsed ?? 0,
        checkedInToday: !!last,
        allowMultiple: settings.allowMultipleCheckins,
      });
      const view = (s: MembershipSubscriptionRow | null) => (s ? this.subView(s, today) : null);
      if (!decision.ok || !cur) {
        const v = view(cur);
        return {
          ok: false,
          reason: decision.ok ? "no_active_plan" : decision.reason,
          member,
          subscription: v,
          sessionsLeft: v?.sessionsLeft ?? null,
          daysLeft: v?.daysLeft ?? null,
          checkin: null,
          lastCheckinAt: last?.at ?? null,
        };
      }
      const [checkin] = await tx.insert(C).values({ tenantId, memberId: member.id, subscriptionId: cur.id, at: this.now(), byUserId: userId, note: b.note }).returning();
      let sub = cur;
      if (cur.sessionsTotal !== null) {
        const [u] = await tx
          .update(S)
          .set({ sessionsUsed: sql`${S.sessionsUsed} + 1`, updatedAt: new Date() })
          .where(eq(S.id, cur.id))
          .returning();
        sub = u!;
      }
      const v = view(sub)!;
      return { ok: true, reason: null, member, subscription: v, sessionsLeft: v.sessionsLeft, daysLeft: v.daysLeft, checkin: checkin!, lastCheckinAt: last?.at ?? null };
    });
  }

  /** Undoes a check-in made by mistake (the session goes back on the pack). */
  async undoCheckin(tenantId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(C)
        .where(and(eq(C.tenantId, tenantId), eq(C.id, id)))
        .returning();
      if (!row) throw notFound("Check-in");
      await tx
        .update(S)
        .set({ sessionsUsed: sql`greatest(${S.sessionsUsed} - 1, 0)`, updatedAt: new Date() })
        .where(and(eq(S.tenantId, tenantId), eq(S.id, row.subscriptionId), sql`${S.sessionsTotal} is not null`));
    });
  }

  /** Visits on a day (default today), latest first. */
  async checkinsOn(tenantId: string, query: unknown = {}): Promise<{ date: string; items: TodayCheckin[] }> {
    const date = dateQuery.parse(query ?? {}).date ?? this.today();
    const rows = await this.db
      .select({
        id: C.id,
        at: C.at,
        note: C.note,
        memberId: C.memberId,
        memberCode: M.memberCode,
        name: M.name,
        phone: M.phone,
        photoUrl: M.photoUrl,
        planName: S.planName,
      })
      .from(C)
      .innerJoin(M, eq(M.id, C.memberId))
      .leftJoin(S, eq(S.id, C.subscriptionId))
      .where(and(eq(C.tenantId, tenantId), gte(C.at, istDayStart(date)), lt(C.at, istDayStart(addDays(date, 1)))))
      .orderBy(desc(C.at))
      .limit(500);
    return { date, items: rows };
  }

  // ---------------------------------------------------------------- reports & reminders

  async summary(tenantId: string, within?: number): Promise<MembershipsSummary> {
    const w = within ?? (await this.getSettings(tenantId)).expiringDays;
    const today = this.today();
    const horizon = addDays(today, w);
    const [[subs], [exp], [visits]] = await Promise.all([
      this.db
        .select({
          active: sql<number>`count(distinct ${S.memberId}) filter (where ${S.status} = 'frozen' or (${S.startDate} <= ${today} and ${S.endDate} >= ${today}))::int`,
          frozen: sql<number>`count(distinct ${S.memberId}) filter (where ${S.status} = 'frozen')::int`,
        })
        .from(S)
        .where(and(eq(S.tenantId, tenantId), ne(S.status, "cancelled"))),
      this.db
        .select({ n: count() })
        .from(M)
        .where(and(eq(M.tenantId, tenantId), sql`${lastEndSql} between ${today} and ${horizon}`)),
      this.db
        .select({ n: count() })
        .from(C)
        .where(and(eq(C.tenantId, tenantId), gte(C.at, istDayStart(today)), lt(C.at, istDayStart(addDays(today, 1))))),
    ]);
    return { within: w, activeMembers: subs?.active ?? 0, frozenMembers: subs?.frozen ?? 0, expiring: exp?.n ?? 0, checkinsToday: visits?.n ?? 0 };
  }

  /**
   * Members whose last plan (not renewed) ends between `from` and `to`, soonest first. Default: today to today +
   * the settings' expiring window.
   */
  async expiring(tenantId: string, opts: { within?: number; from?: string; to?: string } = {}): Promise<ExpiringMembership[]> {
    const today = this.today();
    const from = opts.from ?? today;
    const to = opts.to ?? addDays(today, opts.within ?? (await this.getSettings(tenantId)).expiringDays);
    const S2 = sql`membership_subscriptions s2`;
    const rows = await this.db
      .select({
        memberId: M.id,
        memberCode: M.memberCode,
        name: M.name,
        phone: M.phone,
        subscriptionId: S.id,
        planName: S.planName,
        endDate: S.endDate,
      })
      .from(S)
      .innerJoin(M, eq(M.id, S.memberId))
      .where(
        and(
          eq(S.tenantId, tenantId),
          ne(S.status, "cancelled"),
          gte(S.endDate, from),
          lte(S.endDate, to),
          sql`not exists (select 1 from ${S2} where s2.tenant_id = ${S.tenantId} and s2.member_id = ${S.memberId} and s2.status <> 'cancelled' and s2.end_date > ${S.endDate})`,
        ),
      )
      .orderBy(asc(S.endDate), asc(M.name))
      .limit(1000);
    return rows.map((r) => ({ ...r, daysLeft: daysLeft(r.endDate, today) }));
  }

  /** Visits per day for the last `days` days (today included), zeros filled in. */
  async checkinsPerDay(tenantId: string, query: unknown = {}): Promise<{ from: string; to: string; days: { date: string; count: number }[] }> {
    const { days } = daysQuery.parse(query ?? {});
    const to = this.today();
    const from = addDays(to, -(days - 1));
    const day = sql<string>`to_char(${C.at} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({ date: day, count: sql<number>`count(*)::int` })
      .from(C)
      .where(and(eq(C.tenantId, tenantId), gte(C.at, istDayStart(from)), lt(C.at, istDayStart(addDays(to, 1)))))
      .groupBy(day);
    return { from, to, days: fillDays(from, to, rows) };
  }

  /**
   * Sends reminders for plans ending exactly `days` days from today (0 = today), so a daily job reminds once per plan.
   * Returns how many were sent. Never throws (logged).
   */
  async remindExpiring(tenantId: string, days = 3): Promise<number> {
    try {
      if (!this.deps.reminders) return 0;
      const day = addDays(this.today(), Math.max(0, Math.round(days)));
      const list = await this.expiring(tenantId, { from: day, to: day });
      if (list.length) await this.deps.reminders.expiring(tenantId, list);
      return list.length;
    } catch (err) {
      this.log.error({ err, tenantId, days }, "memberships: expiry reminders failed");
      return 0;
    }
  }

  /** Shops with a (not cancelled) plan ending between `from` and `to` (YYYY-MM-DD), for the host's daily job. */
  async tenantsWithPlansEnding(from: string, to: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ tenantId: S.tenantId })
      .from(S)
      .where(and(gte(S.endDate, from), lte(S.endDate, to), ne(S.status, "cancelled")));
    return rows.map((r) => r.tenantId);
  }

  /** `remindExpiring` for every shop with a plan ending on that day (for the host's daily job). Never throws. */
  async remindAllExpiring(days = 3): Promise<{ tenants: number; reminded: number }> {
    try {
      if (!this.deps.reminders) return { tenants: 0, reminded: 0 };
      const day = addDays(this.today(), Math.max(0, Math.round(days)));
      const tenants = await this.db
        .selectDistinct({ tenantId: S.tenantId })
        .from(S)
        .where(and(eq(S.endDate, day), ne(S.status, "cancelled")));
      let reminded = 0;
      for (const t of tenants) reminded += await this.remindExpiring(t.tenantId, days);
      return { tenants: tenants.length, reminded };
    } catch (err) {
      this.log.error({ err, days }, "memberships: expiry reminder run failed");
      return { tenants: 0, reminded: 0 };
    }
  }
}
