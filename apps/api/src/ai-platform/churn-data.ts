import type { aiPlatform } from "@rbms/ai";
import { sql, type Db } from "@rbms/db";

/**
 * Read-only SQL behind Platform > Shops at risk (Phase 7 part B, docs/ai.md). One pass over every active shop: bills and
 * online orders per IST day (last 63 days), the latest sign-in or app use of anyone in the shop who is not a platform
 * super-admin or demo user, the subscription, the owner's contact and AI runs. Nothing is written.
 */

type Row = Record<string, unknown>;
const rows = <T = Row>(r: unknown) => r as unknown as T[];
const PLATFORM_TENANT = "00000000-0000-0000-0000-000000000000";

export interface ChurnDataDeps {
  db: Db;
  /** Slugs that are demo or test shops (DEMO_SHOPS, the seeded demo stores). */
  demoSlugs: ReadonlySet<string>;
  /** The `store` settings of a shop (for its trade). */
  trade(tenantId: string): Promise<string | null>;
}

/** True for a demo / test shop: listed slug, `metadata.demo`, an e2e shop, or a shop whose only members are platform staff or demo users. */
export function isDemoShop(t: { slug: string; metadata: Record<string, unknown> | null }, demoSlugs: ReadonlySet<string>, realMembers: number): boolean {
  return demoSlugs.has(t.slug) || t.metadata?.demo === true || t.metadata?.test === true || /^e2e[-_]/.test(t.slug) || realMembers === 0;
}

export async function churnSignals(d: ChurnDataDeps, now: Date): Promise<{ shop: aiPlatform.ShopInfo; signals: Omit<aiPlatform.ShopSignals, "tickets"> }[]> {
  const { db } = d;
  const sinceDay = new Date(now.getTime() - 63 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 64 * 86_400_000);
  const aiSince = new Date(now.getTime() - 42 * 86_400_000);
  const aiSplit = new Date(now.getTime() - 14 * 86_400_000);

  const [shops, bills, orders, seen, subs, owners, ai] = await Promise.all([
    db
      .execute(sql`select id::text as id, slug, name, app_id, plan_id, created_at, metadata from tenants where status = 'active' and id <> ${PLATFORM_TENANT}::uuid`)
      .then((r) => rows<{ id: string; slug: string; name: string; app_id: string | null; plan_id: string | null; created_at: Date | string; metadata: Record<string, unknown> | null }>(r)),
    db
      .execute(sql`select tenant_id::text as t, date::text as d, count(*)::int as n from invoices where status <> 'draft' and imported = false and date >= ${sinceDay}::date group by 1, 2`)
      .then((r) => rows<{ t: string; d: string; n: number }>(r)),
    db
      .execute(sql`select tenant_id::text as t, to_char((created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as d, count(*)::int as n from orders where created_at >= ${since}::timestamptz group by 1, 2`)
      .then((r) => rows<{ t: string; d: string; n: number }>(r))
      .catch(() => [] as { t: string; d: string; n: number }[]),
    db
      .execute(sql`
        select m.tenant_id::text as t,
               count(distinct u.id)::int as members,
               max(greatest(coalesce(s.last_seen_at, 'epoch'::timestamptz), coalesce(u.last_login_at, 'epoch'::timestamptz))) as seen
          from tenant_memberships m
          join users u on u.id = m.user_id
          left join auth_sessions s on s.user_id = u.id
         where m.status = 'active'
           and not ('superadmin' = any(u.platform_roles))
           and not ('demo' = any(u.platform_roles))
         group by 1`)
      .then((r) => rows<{ t: string; members: number; seen: Date | string | null }>(r)),
    db
      .execute(sql`select tenant_id::text as t, status, provider, provider_subscription_id, auth_url, trial_ends_at, cancel_at_period_end, current_period_end, grace_ends_at from subscriptions`)
      .then((r) =>
        rows<{ t: string; status: aiPlatform.ChurnSubscription["status"]; provider: string | null; provider_subscription_id: string | null; auth_url: string | null; trial_ends_at: Date | string | null; cancel_at_period_end: boolean; current_period_end: Date | string | null; grace_ends_at: Date | string | null }>(r),
      ),
    db
      .execute(sql`
        select distinct on (m.tenant_id) m.tenant_id::text as t, u.name, u.phone, u.email
          from tenant_memberships m join users u on u.id = m.user_id
         where m.status = 'active' and 'owner' = any(m.roles)
         order by m.tenant_id, m.created_at`)
      .then((r) => rows<{ t: string; name: string | null; phone: string | null; email: string | null }>(r)),
    db
      .execute(sql`
        select tenant_id::text as t,
               count(*) filter (where created_at >= ${aiSplit}::timestamptz)::int as recent,
               count(*) filter (where created_at < ${aiSplit}::timestamptz)::int as prior
          from ai_runs
         where status = 'ok' and created_at >= ${aiSince}::timestamptz and tenant_id <> ${PLATFORM_TENANT}::uuid
         group by 1`)
      .then((r) => rows<{ t: string; recent: number; prior: number }>(r))
      .catch(() => [] as { t: string; recent: number; prior: number }[]),
  ]);

  const daily = new Map<string, Record<string, number>>();
  for (const r of [...bills, ...orders]) {
    const m = daily.get(r.t) ?? {};
    m[r.d] = (m[r.d] ?? 0) + Number(r.n);
    daily.set(r.t, m);
  }
  const seenBy = new Map(seen.map((s) => [s.t, s]));
  const subBy = new Map(subs.map((s) => [s.t, s]));
  const ownerBy = new Map(owners.map((o) => [o.t, o]));
  const aiBy = new Map(ai.map((a) => [a.t, a]));
  const date = (v: Date | string | null | undefined) => (v ? new Date(v) : null);

  const out: { shop: aiPlatform.ShopInfo; signals: Omit<aiPlatform.ShopSignals, "tickets"> }[] = [];
  for (const t of shops) {
    const s = seenBy.get(t.id);
    const lastSeen = date(s?.seen);
    const sub = subBy.get(t.id);
    const o = ownerBy.get(t.id);
    const trade = await d.trade(t.id).catch(() => null);
    out.push({
      shop: {
        tenantId: t.id,
        slug: t.slug,
        name: t.name,
        appId: t.app_id,
        trade,
        planId: t.plan_id,
        createdAt: new Date(t.created_at),
        owner: o ? { name: o.name, phone: o.phone, email: o.email } : null,
      },
      signals: {
        tenantId: t.id,
        createdAt: new Date(t.created_at),
        demo: isDemoShop(t, d.demoSlugs, s?.members ?? 0),
        daily: daily.get(t.id) ?? {},
        lastSeenAt: lastSeen && lastSeen.getTime() > 0 ? lastSeen : null,
        subscription: sub
          ? {
              status: sub.status,
              hasPaymentMethod: !!sub.provider_subscription_id && !sub.auth_url && (sub.provider === "razorpay" || sub.provider === "mock"),
              trialEndsAt: date(sub.trial_ends_at),
              cancelAtPeriodEnd: !!sub.cancel_at_period_end,
              currentPeriodEnd: date(sub.current_period_end),
              graceEndsAt: date(sub.grace_ends_at),
            }
          : null,
        ai: { recent14: Number(aiBy.get(t.id)?.recent ?? 0), prior28: Number(aiBy.get(t.id)?.prior ?? 0) },
      },
    });
  }
  return out;
}
