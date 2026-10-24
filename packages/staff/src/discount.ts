import { badRequest, FULL_ACCESS_ROLES, type AuditPort } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { discountLimits, type DiscountLimitRow } from "./schema";
import { DEFAULT_ROLE_KEY, ROLE_KEY_RE, roleKeysOf } from "./templates";

/**
 * Per-role / per-user discount limits (gap-analysis #12). A limit is a max discount percent (of a bill line, in basis
 * points: 1000 = 10%) and/or a max total discount per bill in paise. No row = no limit (how every shop worked before).
 * Owners and admins are never limited. Above a limit the bill needs a manager's approval (their POS PIN).
 */

export const DISCOUNT_SCOPES = ["role", "user"] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

/** Permission of the people who may approve a discount above someone's limit (managers hold it through `invoices.*`). */
export const DISCOUNT_APPROVE_PERMISSION = "invoices.discount-approve";
/** Request header carrying the approving manager's PIN. */
export const APPROVAL_PIN_HEADER = "x-approval-pin";

export interface DiscountLimit {
  /** Basis points of a line's amount (1000 = 10%); null = no percent cap. */
  maxPercentBp: number | null;
  /** Paise of discount on one bill; null = no amount cap. */
  maxAmount: number | null;
}

export const discountLimitBody = z
  .object({
    scope: z.enum(DISCOUNT_SCOPES),
    /** A role key (`cashier`) or a user id. */
    subject: z.string().trim().min(1).max(64),
    /** Percent, up to two decimals (10 = 10%). null = no cap. */
    maxPercent: z.number().min(0).max(100).nullable(),
    /** Rupees-in-paise per bill. null = no cap. */
    maxAmount: z.number().int().min(0).max(1_000_000_000).nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "user" && !z.string().uuid().safeParse(v.subject).success) ctx.addIssue({ code: "custom", path: ["subject"], message: "Pick a team member" });
    if (v.scope === "role" && !ROLE_KEY_RE.test(v.subject)) ctx.addIssue({ code: "custom", path: ["subject"], message: "Invalid role key" });
    if (v.maxPercent === null && v.maxAmount === null) ctx.addIssue({ code: "custom", path: ["maxPercent"], message: "Set a percent or an amount limit (or remove the limit)" });
  });
export type DiscountLimitInput = z.infer<typeof discountLimitBody>;

export const toBp = (percent: number): number => Math.round(percent * 100);

// ---------------------------------------------------------------- pure evaluation

export interface DiscountLine {
  qty: number;
  /** Paise per unit. */
  rate: number;
  /** Paise off this line. */
  discount?: number | null;
}

export interface DiscountCheck {
  ok: boolean;
  /** Total discount on the bill, paise. */
  amount: number;
  /** The largest discount percent on any line (basis points). */
  percentBp: number;
  breached: Array<"percent" | "amount">;
}

const lineAmount = (qty: number, rate: number) => Math.round((Math.round(qty * 1000) * rate) / 1000);

/** Compares a bill's line discounts with a limit. A bill without discounts always passes. */
export function evaluateDiscount(lines: readonly DiscountLine[], limit: DiscountLimit | null): DiscountCheck {
  let amount = 0;
  let percentBp = 0;
  for (const l of lines) {
    const d = Math.max(0, Math.round(Number(l.discount ?? 0)));
    if (d <= 0) continue;
    amount += d;
    const gross = lineAmount(Number(l.qty) || 0, Number(l.rate) || 0);
    percentBp = Math.max(percentBp, gross > 0 ? Math.round((d * 10000) / gross) : 10000);
  }
  const breached: Array<"percent" | "amount"> = [];
  if (limit && amount > 0) {
    if (limit.maxPercentBp !== null && percentBp > limit.maxPercentBp) breached.push("percent");
    if (limit.maxAmount !== null && amount > limit.maxAmount) breached.push("amount");
  }
  return { ok: breached.length === 0, amount, percentBp, breached };
}

/**
 * The limit that applies to a member: their own row wins; otherwise the most generous of their roles' rows (a member
 * with two roles gets the higher cap on each measure; a role without a cap on a measure leaves that measure open).
 * null = unlimited (owners/admins, or no rows).
 */
export function resolveLimit(rows: readonly Pick<DiscountLimitRow, "scope" | "subject" | "maxPercentBp" | "maxAmount">[], userId: string, roles: readonly string[]): DiscountLimit | null {
  if (roles.some((r) => FULL_ACCESS_ROLES.includes(r))) return null;
  const own = rows.find((r) => r.scope === "user" && r.subject === userId);
  if (own) return { maxPercentBp: own.maxPercentBp, maxAmount: own.maxAmount };
  const keys = roleKeysOf(roles);
  const mine = rows.filter((r) => r.scope === "role" && (keys.length ? keys : [DEFAULT_ROLE_KEY]).includes(r.subject));
  if (mine.length === 0) return null;
  const best = (pick: (r: (typeof mine)[number]) => number | null): number | null => {
    const vals = mine.map(pick);
    return vals.some((v) => v === null) ? null : Math.max(...(vals as number[]));
  };
  return { maxPercentBp: best((r) => r.maxPercentBp), maxAmount: best((r) => r.maxAmount) };
}

// ---------------------------------------------------------------- service

export interface DiscountLimitView {
  id: string;
  scope: DiscountScope;
  subject: string;
  maxPercent: number | null;
  maxAmount: number | null;
  updatedAt: Date;
}
const view = (r: DiscountLimitRow): DiscountLimitView => ({
  id: r.id,
  scope: r.scope as DiscountScope,
  subject: r.subject,
  maxPercent: r.maxPercentBp === null ? null : r.maxPercentBp / 100,
  maxAmount: r.maxAmount,
  updatedAt: r.updatedAt,
});

export class DiscountLimitService {
  constructor(
    private readonly db: Db,
    private readonly audit?: AuditPort,
  ) {}

  private async rows(tenantId: string): Promise<DiscountLimitRow[]> {
    return this.db.select().from(discountLimits).where(eq(discountLimits.tenantId, tenantId)).orderBy(asc(discountLimits.scope), asc(discountLimits.subject));
  }

  async list(tenantId: string): Promise<{ items: DiscountLimitView[] }> {
    return { items: (await this.rows(tenantId)).map(view) };
  }

  /** The limit for a member (null = none). One small indexed query per discounted bill. */
  async limitFor(tenantId: string, userId: string, roles: readonly string[]): Promise<DiscountLimit | null> {
    if (roles.some((r) => FULL_ACCESS_ROLES.includes(r))) return null;
    return resolveLimit(await this.rows(tenantId), userId, roles);
  }

  async set(tenantId: string, input: unknown, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<DiscountLimitView> {
    const p = discountLimitBody.parse(input);
    const values = { maxPercentBp: p.maxPercent === null ? null : toBp(p.maxPercent), maxAmount: p.maxAmount };
    const [row] = await this.db
      .insert(discountLimits)
      .values({ tenantId, scope: p.scope, subject: p.subject, ...values, updatedBy: actor.userId })
      .onConflictDoUpdate({ target: [discountLimits.tenantId, discountLimits.scope, discountLimits.subject], set: { ...values, updatedBy: actor.userId, updatedAt: new Date() } })
      .returning();
    if (!row) throw badRequest("Could not save the limit");
    await this.record(tenantId, actor, "staff.discount_limit.set", row.id, `Discount limit for ${p.scope} ${p.subject}: ${p.maxPercent === null ? "no %" : `${p.maxPercent}%`}, ${p.maxAmount === null ? "no amount cap" : `max ${(p.maxAmount / 100).toFixed(2)} per bill`}`);
    return view(row);
  }

  async remove(tenantId: string, scope: DiscountScope, subject: string, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<void> {
    const gone = await this.db
      .delete(discountLimits)
      .where(and(eq(discountLimits.tenantId, tenantId), eq(discountLimits.scope, scope), eq(discountLimits.subject, subject)))
      .returning({ id: discountLimits.id });
    if (gone[0]) await this.record(tenantId, actor, "staff.discount_limit.remove", gone[0].id, `Removed the discount limit of ${scope} ${subject}`);
  }

  private async record(tenantId: string, actor: { userId: string; ip?: string | null; userAgent?: string | null }, action: string, entityId: string, summary: string) {
    await this.audit?.record({ tenantId, actorUserId: actor.userId, action, entityType: "discount_limit", entityId, summary, ip: actor.ip ?? null, userAgent: actor.userAgent ?? null }).catch(() => undefined);
  }
}
