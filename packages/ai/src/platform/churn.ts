import { addDays, daysBetween, PLAN_FESTIVALS } from "../insights/calendar";

/**
 * Churn signals (Phase 7 part B, no AI): which shops look like they are slipping away, so the RBMS team can call them
 * before they cancel. Everything is counted in code from data the platform already has; the reasons are plain sentences
 * built from the numbers (en + ta). Pure: the API gathers the signals (apps/api/src/ai-platform/churn-data.ts).
 *
 * Care taken against false alarms:
 *  - a shop is only compared with ITS OWN past: weekly totals of bills + online orders against the median of weeks 3 to 8
 *    (the last two weeks are what is judged, so a drop that started last week is not in its own baseline);
 *  - weekly totals absorb weekly closed days; one weak week alone is a mild signal (a holiday, a closure, a family event),
 *    and around a festival it is milder still; a strong drop needs two weak weeks or a whole week with nothing;
 *  - the median ignores one festival spike week in the baseline;
 *  - a brand-new shop (under 4 full weeks of history, or too little billing to judge) gets no drop signals at all, only
 *    "set-up not finished" when it has billed nothing for a while, and the subscription signals;
 *  - demo and test shops are never assessed (the API passes `demo`); shops already cancelled or expired are "left", not at risk.
 */

export type ChurnLevel = "high" | "watch" | "low";

export interface ChurnSubscription {
  status: "trialing" | "active" | "past_due" | "cancelled" | "expired";
  /** A payment method (authorised mandate) is in place. */
  hasPaymentMethod: boolean;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
}

export interface ShopSignals {
  tenantId: string;
  createdAt: Date;
  /** A demo or test shop (DEMO_SHOPS, seeded demo stores, `metadata.demo`, or "ignore" set by the team). */
  demo: boolean;
  /** Bills (issued, not imported) plus online orders per IST day "YYYY-MM-DD", at least the last 56 days. Missing = 0. */
  daily: Record<string, number>;
  /** The latest sign-in or app use by anyone in the shop (sessions, PIN sessions included). */
  lastSeenAt: Date | null;
  subscription: ChurnSubscription | null;
  /** AI helper runs (ok) in the last 14 days and in the 28 days before. */
  ai: { recent14: number; prior28: number };
  /** RBMS support tickets waiting for OUR reply. */
  tickets: { waiting: number; oldestWaitingAt: Date | null };
}

export interface ChurnReason {
  code:
    | "no_activity"
    | "drop_two_weeks"
    | "drop_one_week"
    | "drop_mild"
    | "setup_stalled"
    | "no_login"
    | "never_logged_in"
    | "past_due"
    | "cancel_requested"
    | "trial_no_payment"
    | "ai_drop"
    | "tickets_waiting";
  weight: number;
  en: string;
  ta: string;
}

export interface ChurnAssessment {
  tenantId: string;
  score: number;
  level: ChurnLevel;
  reasons: ChurnReason[];
  /** Usual bills + orders a week (median of weeks 3 to 8); null = not enough history to judge. */
  baseline: number | null;
  lastWeek: number;
  prevWeek: number;
  /** Weekly totals, oldest first (8 weeks ending yesterday), for a small chart. */
  weeks: number[];
  newShop: boolean;
  /** Already cancelled or expired: not "at risk", gone. */
  left: boolean;
  demo: boolean;
}

const DAY = 86_400_000;
const IST = 330 * 60_000;
/** IST calendar date of a moment. */
export const istDate = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

export const CHURN_WEIGHTS = {
  no_activity: 45,
  no_activity_first_week: 30,
  drop_two_weeks: 35,
  drop_one_week: 15,
  drop_one_week_festival: 5,
  drop_mild: 15,
  setup_stalled: 25,
  no_login_30: 30,
  no_login_14: 15,
  never_logged_in: 20,
  past_due: 30,
  cancel_requested: 35,
  trial_3d: 25,
  trial_7d: 15,
  ai_drop: 10,
  tickets_waiting: 15,
} as const;
export const LEVEL_AT = { high: 50, watch: 25 } as const;
/** Minimum usual weekly volume before a drop means anything. */
const MIN_BASELINE = 5;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? 0 : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pct = (r: number) => Math.round((1 - r) * 100);
const daysAgo = (now: Date, d: Date) => Math.floor((now.getTime() - d.getTime()) / DAY);

/** Weekly totals ending yesterday: index 0 = the last 7 days, 1 = the 7 before... Each with the oldest day it covers. */
export function weeklyTotals(daily: Record<string, number>, today: string, weeks = 8): { total: number; from: string; to: string; activeDays: number }[] {
  return Array.from({ length: weeks }, (_, k) => {
    let total = 0;
    let activeDays = 0;
    for (let i = 7 * k + 1; i <= 7 * k + 7; i++) {
      const n = daily[addDays(today, -i)] ?? 0;
      total += n;
      if (n > 0) activeDays++;
    }
    return { total, from: addDays(today, -(7 * k + 7)), to: addDays(today, -(7 * k + 1)), activeDays };
  });
}

/** A festival on a day in [from, to] (inclusive), for "one weak week around Deepavali" wording. */
export function festivalIn(from: string, to: string) {
  return PLAN_FESTIVALS.find((f) => daysBetween(from, f.date) >= 0 && daysBetween(f.date, to) >= 0) ?? null;
}

/** Scores one shop. `now` is injected so tests use a fixed clock. */
export function assessShop(s: ShopSignals, now: Date): ChurnAssessment {
  const today = istDate(now);
  const weeksRaw = weeklyTotals(s.daily, today, 8);
  const created = istDate(s.createdAt);
  const ageDays = daysBetween(created, today);
  const out: ChurnAssessment = {
    tenantId: s.tenantId,
    score: 0,
    level: "low",
    reasons: [],
    baseline: null,
    lastWeek: weeksRaw[0]!.total,
    prevWeek: weeksRaw[1]!.total,
    weeks: weeksRaw.map((w) => w.total).reverse(),
    newShop: false,
    left: s.subscription?.status === "cancelled" || s.subscription?.status === "expired",
    demo: s.demo,
  };
  if (s.demo || out.left) return out;
  const add = (code: ChurnReason["code"], weight: number, en: string, ta: string) => out.reasons.push({ code, weight, en, ta });

  // ---- activity against the shop's own usual week
  // Baseline weeks: 3 to 8, only weeks that start on or after the sign-up day (a half week would look like a drop).
  const base = weeksRaw.slice(2).filter((w) => daysBetween(created, w.from) >= 0);
  const baseActiveDays = base.reduce((n, w) => n + w.activeDays, 0);
  const usual = base.length >= 4 && baseActiveDays >= 8 ? median(base.map((w) => w.total)) : null;
  if (usual !== null && usual >= MIN_BASELINE) {
    out.baseline = usual;
    const r1 = out.lastWeek / usual;
    const r2 = out.prevWeek / usual;
    const usualText = Math.round(usual);
    if (out.lastWeek === 0) {
      const lastDay = Object.keys(s.daily)
        .filter((d) => (s.daily[d] ?? 0) > 0 && d < today)
        .sort()
        .at(-1);
      const since = lastDay ? daysBetween(lastDay, today) : null;
      // A first empty week after a normal one may be a closure: still worth a call, but not yet the strongest signal.
      add(
        "no_activity",
        r2 >= 0.7 ? CHURN_WEIGHTS.no_activity_first_week : CHURN_WEIGHTS.no_activity,
        `No bills or orders in the last 7 days${since ? ` (last one ${since} days ago)` : ""}; usually about ${usualText} a week.`,
        `கடந்த 7 நாட்களில் பில்லும் ஆர்டரும் இல்லை${since ? ` (கடைசியாக ${since} நாட்களுக்கு முன்)` : ""}; வழக்கமாக வாரத்துக்கு சுமார் ${usualText}.`,
      );
    } else if (r1 <= 0.5 && r2 <= 0.7) {
      add(
        "drop_two_weeks",
        CHURN_WEIGHTS.drop_two_weeks,
        `Bills and orders down for two weeks: ${out.lastWeek} last week and ${out.prevWeek} the week before, against about ${usualText} usually (${pct(r1)}% lower).`,
        `இரண்டு வாரங்களாக பில்களும் ஆர்டர்களும் குறைவு: கடந்த வாரம் ${out.lastWeek}, அதற்கு முந்தைய வாரம் ${out.prevWeek}; வழக்கமாக சுமார் ${usualText} (${pct(r1)}% குறைவு).`,
      );
    } else if (r1 <= 0.5) {
      const fest = festivalIn(weeksRaw[0]!.from, weeksRaw[0]!.to);
      if (fest)
        add(
          "drop_one_week",
          CHURN_WEIGHTS.drop_one_week_festival,
          `One quiet week around ${fest.name}: ${out.lastWeek} bills and orders against about ${usualText} usually. Probably the festival; check again next week.`,
          `${fest.nameTa} சமயத்தில் ஒரு அமைதியான வாரம்: வழக்கமான சுமார் ${usualText}-க்கு பதில் ${out.lastWeek} பில்கள்/ஆர்டர்கள். பண்டிகையாக இருக்கலாம்; அடுத்த வாரம் மீண்டும் பாருங்கள்.`,
        );
      else
        add(
          "drop_one_week",
          CHURN_WEIGHTS.drop_one_week,
          `Bills and orders ${pct(r1)}% lower last week (${out.lastWeek} against about ${usualText}). One week only: may be a holiday or a closure.`,
          `கடந்த வாரம் பில்களும் ஆர்டர்களும் ${pct(r1)}% குறைவு (சுமார் ${usualText}-க்கு பதில் ${out.lastWeek}). ஒரு வாரம் மட்டும்: விடுமுறை அல்லது கடை மூடியிருக்கலாம்.`,
        );
    } else if (r1 <= 0.7 && r2 <= 0.7) {
      add(
        "drop_mild",
        CHURN_WEIGHTS.drop_mild,
        `Bills and orders a little lower for two weeks: ${out.lastWeek} and ${out.prevWeek} against about ${usualText} usually.`,
        `இரண்டு வாரங்களாக பில்களும் ஆர்டர்களும் சற்றுக் குறைவு: வழக்கமான சுமார் ${usualText}-க்கு பதில் ${out.lastWeek}, ${out.prevWeek}.`,
      );
    }
  } else {
    // Brand-new or too little billing to judge: no drop signals. A shop that signed up a while ago and never billed is a set-up problem.
    out.newShop = true;
    const total = Object.values(s.daily).reduce((n, x) => n + x, 0);
    if (ageDays >= 7 && total === 0 && (s.lastSeenAt === null || daysAgo(now, s.lastSeenAt) >= 5))
      add(
        "setup_stalled",
        CHURN_WEIGHTS.setup_stalled,
        `Signed up ${ageDays} days ago and has not made a bill or taken an order yet.`,
        `${ageDays} நாட்களுக்கு முன் பதிவு செய்தது; இன்னும் ஒரு பில்லும் ஆர்டரும் இல்லை.`,
      );
  }

  // ---- nobody opening the app
  if (s.lastSeenAt) {
    const d = daysAgo(now, s.lastSeenAt);
    if (d >= 30) add("no_login", CHURN_WEIGHTS.no_login_30, `Nobody from the shop has opened RBMS for ${d} days.`, `${d} நாட்களாக கடையிலிருந்து யாரும் RBMS-ஐத் திறக்கவில்லை.`);
    else if (d >= 14) add("no_login", CHURN_WEIGHTS.no_login_14, `Nobody from the shop has opened RBMS for ${d} days.`, `${d} நாட்களாக கடையிலிருந்து யாரும் RBMS-ஐத் திறக்கவில்லை.`);
  } else if (ageDays >= 7) {
    add("never_logged_in", CHURN_WEIGHTS.never_logged_in, "Nobody has signed in since the shop was created.", "கடை உருவாக்கியதிலிருந்து யாரும் உள்நுழையவில்லை.");
  }

  // ---- subscription
  const sub = s.subscription;
  if (sub?.status === "past_due") {
    const grace = sub.graceEndsAt ? Math.max(0, Math.ceil((sub.graceEndsAt.getTime() - now.getTime()) / DAY)) : null;
    add(
      "past_due",
      CHURN_WEIGHTS.past_due,
      `The last payment failed (past due)${grace !== null ? `; ${grace} days of grace left` : ""}.`,
      `கடைசி கட்டணம் தோல்வியடைந்தது (நிலுவை)${grace !== null ? `; இன்னும் ${grace} நாள் சலுகைக் காலம்` : ""}.`,
    );
  }
  if (sub?.cancelAtPeriodEnd && (sub.status === "active" || sub.status === "past_due" || sub.status === "trialing")) {
    const end = sub.currentPeriodEnd ?? sub.trialEndsAt;
    add(
      "cancel_requested",
      CHURN_WEIGHTS.cancel_requested,
      `Asked to cancel${end ? ` at the end of the period (${istDate(end)})` : ""}.`,
      `ரத்து செய்யக் கேட்டுள்ளது${end ? ` (காலம் முடியும் போது, ${istDate(end)})` : ""}.`,
    );
  }
  if (sub?.status === "trialing" && sub.trialEndsAt && !sub.hasPaymentMethod) {
    const left = Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY);
    if (left >= 0 && left <= 7)
      add(
        "trial_no_payment",
        left <= 3 ? CHURN_WEIGHTS.trial_3d : CHURN_WEIGHTS.trial_7d,
        left === 0 ? "The trial ends today and no payment method is set up." : `The trial ends in ${left} days and no payment method is set up.`,
        left === 0 ? "சோதனைக் காலம் இன்று முடிகிறது; கட்டண முறை அமைக்கப்படவில்லை." : `சோதனைக் காலம் ${left} நாளில் முடிகிறது; கட்டண முறை அமைக்கப்படவில்லை.`,
      );
  }

  // ---- AI helpers used much less (a shop that relied on them)
  const usualAi = s.ai.prior28 / 2;
  if (s.ai.prior28 >= 10 && s.ai.recent14 <= usualAi * 0.25)
    add(
      "ai_drop",
      CHURN_WEIGHTS.ai_drop,
      `AI helpers used ${s.ai.recent14} times in the last 14 days; about ${Math.round(usualAi)} every 14 days before.`,
      `கடந்த 14 நாட்களில் AI உதவியாளர்கள் ${s.ai.recent14} முறை; முன்பு 14 நாளுக்கு சுமார் ${Math.round(usualAi)} முறை.`,
    );

  // ---- we kept them waiting
  if (s.tickets.waiting > 0 && s.tickets.oldestWaitingAt && now.getTime() - s.tickets.oldestWaitingAt.getTime() >= DAY) {
    const d = daysAgo(now, s.tickets.oldestWaitingAt);
    add(
      "tickets_waiting",
      CHURN_WEIGHTS.tickets_waiting,
      `${s.tickets.waiting} support ticket${s.tickets.waiting === 1 ? "" : "s"} waiting for our reply (oldest ${d} day${d === 1 ? "" : "s"}).`,
      `${s.tickets.waiting} ஆதரவுக் கோரிக்கை எங்கள் பதிலுக்காகக் காத்திருக்கிறது (பழையது ${d} நாள்).`,
    );
  }

  out.reasons.sort((a, b) => b.weight - a.weight);
  out.score = Math.min(100, out.reasons.reduce((n, r) => n + r.weight, 0));
  out.level = out.score >= LEVEL_AT.high ? "high" : out.score >= LEVEL_AT.watch ? "watch" : "low";
  return out;
}

export interface FollowupState {
  contactedAt: Date | null;
  snoozedUntil: Date | null;
  ignored: boolean;
}

export type ChurnFilter = "at-risk" | "snoozed" | "contacted" | "all";

/**
 * The list the team works through: at-risk shops (watch and high) not snoozed, worst first; shops contacted in the last
 * 14 days sink below the ones nobody has called yet. Ignored (test) shops are never listed.
 */
export function rankAtRisk<T extends { a: ChurnAssessment; f: FollowupState | null }>(rows: T[], now: Date, filter: ChurnFilter = "at-risk"): T[] {
  const recent = (d: Date | null) => !!d && now.getTime() - d.getTime() < 14 * DAY;
  const snoozed = (r: T) => !!r.f?.snoozedUntil && r.f.snoozedUntil.getTime() > now.getTime();
  return rows
    .filter((r) => !r.a.demo && !r.a.left && !r.f?.ignored)
    .filter((r) => {
      if (filter === "all") return true;
      if (filter === "snoozed") return snoozed(r);
      if (filter === "contacted") return recent(r.f?.contactedAt ?? null);
      return r.a.level !== "low" && !snoozed(r);
    })
    .sort((x, y) => Number(recent(x.f?.contactedAt ?? null)) - Number(recent(y.f?.contactedAt ?? null)) || y.a.score - x.a.score);
}
