import { addDays } from "../insights/calendar";
import { rupees } from "../insights/numbers";
import { percentile, spike, sum, usualText } from "./stats";

/**
 * Unusual-activity alerts (feature `activity-alerts`, no model). Everything is counted in code from the shop's own bills, till
 * closes and counter events, per staff member against that person's OWN last 60 days (or the shop's pooled days when the person
 * is new), with minimum volumes so a quiet day never alerts. The wording says "worth a look": these are prompts to check a
 * screen, not findings about a person.
 *
 * "Staff" is the person who owns the till session the bill was rung on (bills carry no creator of their own). Bills rung with
 * no till open are not counted against anyone.
 */

export interface StaffRef {
  key: string;
  name: string;
}

/** What one person did on one IST day, counted from the database (see apps/api kit-ai-counter.ts). */
export interface StaffDay {
  staff: string;
  name: string;
  date: string;
  /** Issued bills (cancelled ones included, they were rung). */
  bills: number;
  voids: number;
  returns: number;
  /** Paise. */
  returnAmount: number;
  discountedBills: number;
  /** Paise: money given off, and the bills' value before the discount. */
  discountAmount: number;
  grossAmount: number;
  /** Discounted bills issued at or after 21:00 IST. */
  lateDiscounts: number;
  /** Drawer opens without a sale. */
  noSales: number;
  /** Lines sold at a price other than the catalogue's. */
  priceEdits: number;
}

export interface TillClose {
  sessionId: string;
  staff: string;
  name: string;
  register: string;
  /** IST date of the till day. */
  date: string;
  /** Paise: counted minus expected (negative = short). */
  difference: number;
}

export type AlertType = "voids" | "returns" | "returns_concentration" | "discounts" | "late_discounts" | "price_edits" | "no_sale" | "till_variance" | "till_pattern";
export type AlertSeverity = "info" | "watch" | "high";

export interface DrillRef {
  kind: "voids" | "returns" | "discounts" | "late_discounts" | "price_edits" | "no_sale" | "till";
  staff: string;
  date: string;
  /** Last 30 days instead of one day (concentration). */
  days?: number;
  sessionId?: string;
}

export interface UnusualAlert {
  /** Stable: the same finding on the same day gets the same key, so "reviewed" sticks. */
  key: string;
  type: AlertType;
  severity: AlertSeverity;
  date: string;
  staff: StaffRef | null;
  title: { en: string; ta: string };
  detail: { en: string; ta: string };
  facts: Record<string, number | string>;
  drill: DrillRef | null;
}

export interface CounterFacts {
  /** IST today. */
  today: string;
  /** One row per person per day with activity, for at least the last 67 days. */
  days: StaffDay[];
  /** Closed till sessions of the last 67 days. */
  tills: TillClose[];
}

export const BASELINE_DAYS = 60;
const WORTH = { en: "Worth a look.", ta: "ஒரு முறை பார்க்கலாம்." };
const wd = (d: string) => d.slice(5).replace("-", "/");

const sev = (z: number, big: number): AlertSeverity => (z >= big ? "high" : "watch");

interface Series {
  by: (d: StaffDay) => number;
  /** Days that count as a normal day for the baseline (enough bills to mean something). */
  active: (d: StaffDay) => boolean;
}

function baselineFor(all: StaffDay[], staff: string, date: string, s: Series): number[] {
  const from = addDays(date, -BASELINE_DAYS);
  const inWin = (d: StaffDay) => d.date >= from && d.date < date && s.active(d);
  const own = all.filter((d) => d.staff === staff && inWin(d)).map(s.by);
  if (own.length >= 14) return own;
  // a new person: the shop's own pooled days (other people), never a fixed number
  const pooled = all.filter(inWin).map(s.by);
  return pooled.length >= 14 ? pooled : own;
}

const SERIES = {
  voids: { by: (d) => d.voids, active: (d) => d.bills >= 3 } as Series,
  returns: { by: (d) => d.returns, active: (d) => d.bills >= 3 } as Series,
  late: { by: (d) => d.lateDiscounts, active: (d) => d.bills >= 3 } as Series,
  edits: { by: (d) => d.priceEdits, active: (d) => d.bills >= 3 } as Series,
  noSale: { by: (d) => d.noSales, active: (d) => d.bills >= 3 } as Series,
  share: { by: (d) => (d.grossAmount > 0 ? (d.discountAmount / d.grossAmount) * 100 : 0), active: (d) => d.bills >= 10 } as Series,
};

/** All alerts for the dates in `[from, to]` (IST). Newest first. */
export function detectAlerts(facts: CounterFacts, range: { from: string; to: string }): UnusualAlert[] {
  const out: UnusualAlert[] = [];
  const dates = facts.days.filter((d) => d.date >= range.from && d.date <= range.to);

  for (const day of dates) {
    const who: StaffRef = { key: day.staff, name: day.name };
    const name = day.name;
    const d = day.date;

    // ---- cancelled bills
    if (day.voids > 0) {
      const sp = spike(baselineFor(facts.days, day.staff, d, SERIES.voids), day.voids, { minToday: 3 });
      if (sp.fires) {
        out.push({
          key: `voids:${day.staff}:${d}`,
          type: "voids",
          severity: sev(sp.z, 8),
          date: d,
          staff: who,
          title: { en: `${name}: ${day.voids} cancelled bills on ${wd(d)} (usual ${usualText(sp)})`, ta: `${name}: ${wd(d)} அன்று ${day.voids} பில்கள் ரத்து (வழக்கமாக ${usualText(sp, "ta")})` },
          detail: { en: `${WORTH.en} Open the cancelled bills and check the reasons.`, ta: `${WORTH.ta} ரத்தான பில்களையும் காரணங்களையும் பாருங்கள்.` },
          facts: { count: day.voids, usualLow: sp.usualLow, usualHigh: sp.usualHigh, bills: day.bills },
          drill: { kind: "voids", staff: day.staff, date: d },
        });
      }
    }

    // ---- returns (credit notes)
    if (day.returns > 0) {
      const sp = spike(baselineFor(facts.days, day.staff, d, SERIES.returns), day.returns, { minToday: 3 });
      if (sp.fires) {
        out.push({
          key: `returns:${day.staff}:${d}`,
          type: "returns",
          severity: sev(sp.z, 8),
          date: d,
          staff: who,
          title: { en: `${name}: ${day.returns} returns on ${wd(d)} worth ${rupees(day.returnAmount)} (usual ${usualText(sp)})`, ta: `${name}: ${wd(d)} அன்று ${day.returns} திருப்பங்கள், ${rupees(day.returnAmount)} (வழக்கமாக ${usualText(sp, "ta")})` },
          detail: { en: `${WORTH.en} Look at the credit notes and what was returned.`, ta: `${WORTH.ta} கிரெடிட் நோட்டுகளையும் திருப்பிய பொருட்களையும் பாருங்கள்.` },
          facts: { count: day.returns, amount: day.returnAmount, usualLow: sp.usualLow, usualHigh: sp.usualHigh },
          drill: { kind: "returns", staff: day.staff, date: d },
        });
      }
    }

    // ---- heavy discounts (share of the day's sales) and discounts late at night
    if (day.bills >= 10 && day.grossAmount > 0 && day.discountedBills >= 3) {
      const share = (day.discountAmount / day.grossAmount) * 100;
      const sp = spike(baselineFor(facts.days, day.staff, d, SERIES.share), share, { minToday: 4, floorDelta: 2.5, z: 4 });
      if (sp.fires) {
        const pct = Math.round(share * 10) / 10;
        out.push({
          key: `discounts:${day.staff}:${d}`,
          type: "discounts",
          severity: sev(sp.z, 9),
          date: d,
          staff: who,
          title: {
            en: `${name}: discounts were ${pct}% of sales on ${wd(d)} (usual about ${Math.round(sp.median * 10) / 10}%)`,
            ta: `${name}: ${wd(d)} அன்று விற்பனையில் ${pct}% தள்ளுபடி (வழக்கமாக சுமார் ${Math.round(sp.median * 10) / 10}%)`,
          },
          detail: { en: `${WORTH.en} ${day.discountedBills} bills had a discount, ${rupees(day.discountAmount)} in all.`, ta: `${WORTH.ta} ${day.discountedBills} பில்களில் தள்ளுபடி, மொத்தம் ${rupees(day.discountAmount)}.` },
          facts: { percent: pct, usualPercent: Math.round(sp.median * 10) / 10, discountedBills: day.discountedBills, amount: day.discountAmount },
          drill: { kind: "discounts", staff: day.staff, date: d },
        });
      }
    }
    if (day.lateDiscounts > 0) {
      const sp = spike(baselineFor(facts.days, day.staff, d, SERIES.late), day.lateDiscounts, { minToday: 3, floorDelta: 2 });
      if (sp.fires) {
        out.push({
          key: `late_discounts:${day.staff}:${d}`,
          type: "late_discounts",
          severity: "watch",
          date: d,
          staff: who,
          title: { en: `${name}: ${day.lateDiscounts} discounted bills after 9 pm on ${wd(d)} (usual ${usualText(sp)})`, ta: `${name}: ${wd(d)} அன்று இரவு 9 மணிக்குப் பின் ${day.lateDiscounts} தள்ளுபடி பில்கள் (வழக்கமாக ${usualText(sp, "ta")})` },
          detail: { en: `${WORTH.en} Check who was billed and the discount reasons.`, ta: `${WORTH.ta} யாருக்கு பில் போடப்பட்டது, தள்ளுபடி காரணம் என்ன என்று பாருங்கள்.` },
          facts: { count: day.lateDiscounts, usualLow: sp.usualLow, usualHigh: sp.usualHigh },
          drill: { kind: "late_discounts", staff: day.staff, date: d },
        });
      }
    }

    // ---- prices changed at the counter
    if (day.priceEdits > 0) {
      const sp = spike(baselineFor(facts.days, day.staff, d, SERIES.edits), day.priceEdits, { minToday: 5, floorDelta: 4 });
      if (sp.fires) {
        out.push({
          key: `price_edits:${day.staff}:${d}`,
          type: "price_edits",
          severity: "info",
          date: d,
          staff: who,
          title: { en: `${name}: ${day.priceEdits} items sold at a changed price on ${wd(d)} (usual ${usualText(sp)})`, ta: `${name}: ${wd(d)} அன்று ${day.priceEdits} பொருட்கள் மாற்றிய விலையில் (வழக்கமாக ${usualText(sp, "ta")})` },
          detail: { en: `${WORTH.en} If you changed prices recently this may be expected.`, ta: `${WORTH.ta} சமீபத்தில் விலை மாற்றியிருந்தால் இது இயல்பாக இருக்கலாம்.` },
          facts: { count: day.priceEdits, usualLow: sp.usualLow, usualHigh: sp.usualHigh },
          drill: { kind: "price_edits", staff: day.staff, date: d },
        });
      }
    }

    // ---- drawer opened without a sale
    if (day.noSales > 0) {
      const hist = baselineFor(facts.days, day.staff, d, SERIES.noSale);
      // counter events are new: with a short history only a plainly large number counts
      const sp = spike(hist, day.noSales, { minToday: 4, minHistory: 7, floorDelta: 3 });
      if (sp.fires || (hist.length < 7 && day.noSales >= 8)) {
        out.push({
          key: `no_sale:${day.staff}:${d}`,
          type: "no_sale",
          severity: "watch",
          date: d,
          staff: who,
          title: { en: `${name}: drawer opened ${day.noSales} times without a sale on ${wd(d)}${hist.length >= 7 ? ` (usual ${usualText(sp)})` : ""}`, ta: `${name}: ${wd(d)} அன்று விற்பனை இல்லாமல் ${day.noSales} முறை டிராயர் திறக்கப்பட்டது${hist.length >= 7 ? ` (வழக்கமாக ${usualText(sp, "ta")})` : ""}` },
          detail: { en: `${WORTH.en} "No sale" opens are logged with the time.`, ta: `${WORTH.ta} "விற்பனை இல்லை" திறப்புகள் நேரத்துடன் பதிவாகும்.` },
          facts: { count: day.noSales, usualLow: sp.usualLow, usualHigh: sp.usualHigh },
          drill: { kind: "no_sale", staff: day.staff, date: d },
        });
      }
    }
  }

  // ---- cash count at close
  for (const t of facts.tills) {
    if (t.date < range.from || t.date > range.to || t.difference === 0) continue;
    const prior = facts.tills.filter((x) => x.date < t.date && x.date >= addDays(t.date, -BASELINE_DAYS));
    const own = prior.filter((x) => x.staff === t.staff).map((x) => Math.abs(x.difference));
    const hist = own.length >= 10 ? own : prior.map((x) => Math.abs(x.difference));
    // far above the usual gap: more than half again the 95th percentile (and at least ₹20 over it), never under ₹50
    const p95 = hist.length >= 10 ? percentile(hist, 95) : 0;
    const limit = Math.max(5000, p95 * 1.5, p95 + 2000);
    const abs = Math.abs(t.difference);
    const fires = abs >= limit && abs >= 5000 && (hist.length >= 10 || abs >= 20000);
    if (!fires) continue;
    const short = t.difference < 0;
    out.push({
      key: `till_variance:${t.sessionId}`,
      type: "till_variance",
      severity: abs >= 50000 ? "high" : "watch",
      date: t.date,
      staff: { key: t.staff, name: t.name },
      title: {
        en: `${t.register}: ${short ? "short" : "over"} ${rupees(abs)} at close on ${wd(t.date)} (${t.name})`,
        ta: `${t.register}: ${wd(t.date)} அன்று மூடும்போது ${rupees(abs)} ${short ? "குறைவு" : "அதிகம்"} (${t.name})`,
      },
      detail: {
        en: `${WORTH.en} Recount the drawer or check cash in and out for that day.${hist.length >= 10 ? ` The usual gap is under ${rupees(Math.max(5000, Math.round(percentile(hist, 90))))}.` : ""}`,
        ta: `${WORTH.ta} அன்றைய ரொக்க உள்/வெளி பதிவுகளைப் பாருங்கள்.${hist.length >= 10 ? ` வழக்கமான வேறுபாடு ${rupees(Math.max(5000, Math.round(percentile(hist, 90))))}க்குக் கீழ்.` : ""}`,
      },
      facts: { difference: t.difference, amount: abs, register: t.register },
      drill: { kind: "till", staff: t.staff, date: t.date, sessionId: t.sessionId },
    });
  }

  // ---- short in several of the last closes (per person, once a day)
  const byStaff = new Map<string, TillClose[]>();
  for (const t of facts.tills) byStaff.set(t.staff, [...(byStaff.get(t.staff) ?? []), t]);
  for (const [staff, list] of byStaff) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 4; i < sorted.length; i++) {
      const last = sorted[i]!;
      if (last.date < range.from || last.date > range.to) continue;
      const five = sorted.slice(i - 4, i + 1);
      const shortOnes = five.filter((t) => t.difference <= -2000);
      if (shortOnes.length >= 3 && last.difference <= -2000) {
        const total = sum(shortOnes.map((t) => -t.difference));
        out.push({
          key: `till_pattern:${staff}:${last.date}`,
          type: "till_pattern",
          severity: "watch",
          date: last.date,
          staff: { key: staff, name: last.name },
          title: { en: `${last.name}: till short in ${shortOnes.length} of the last 5 closes (${rupees(total)} in all)`, ta: `${last.name}: கடைசி 5 மூடல்களில் ${shortOnes.length} முறை கல்லா குறைவு (மொத்தம் ${rupees(total)})` },
          detail: { en: `${WORTH.en} A repeated small gap is usually change given or a missed entry.`, ta: `${WORTH.ta} மீண்டும் மீண்டும் வரும் சிறு வேறுபாடு பொதுவாக சில்லறை அல்லது விடுபட்ட பதிவு.` },
          facts: { shortCloses: shortOnes.length, of: 5, amount: total },
          drill: { kind: "till", staff, date: last.date, sessionId: last.sessionId },
        });
      }
    }
  }

  // ---- all returns handled by one person (last 30 days, once a week)
  const since = addDays(range.to, -29);
  const recent = facts.days.filter((d) => d.date >= since && d.date <= range.to);
  const retTotal = sum(recent.map((d) => d.returns));
  if (retTotal >= 6) {
    const perStaff = new Map<string, { name: string; returns: number; bills: number }>();
    for (const d of recent) {
      const p = perStaff.get(d.staff) ?? { name: d.name, returns: 0, bills: 0 };
      p.returns += d.returns;
      p.bills += d.bills;
      perStaff.set(d.staff, p);
    }
    const billTotal = sum([...perStaff.values()].map((p) => p.bills));
    const real = [...perStaff.values()].filter((p) => p.bills >= Math.max(30, billTotal * 0.15));
    const top = [...perStaff.entries()].sort((a, b) => b[1].returns - a[1].returns)[0];
    if (top && real.length >= 2 && top[1].returns / retTotal >= 0.85) {
      const week = addDays(range.to, -((new Date(`${range.to}T00:00:00Z`).getUTCDay() + 6) % 7));
      out.push({
        key: `returns_concentration:${top[0]}:${week}`,
        type: "returns_concentration",
        severity: "info",
        date: range.to,
        staff: { key: top[0], name: top[1].name },
        title: { en: `${top[1].returns} of the last ${retTotal} returns were handled by ${top[1].name}`, ta: `கடைசி ${retTotal} திருப்பங்களில் ${top[1].returns} ஐ ${top[1].name} கையாண்டார்` },
        detail: { en: `${WORTH.en} Other cashiers also bill, so you may want returns checked or shared.`, ta: `${WORTH.ta} மற்ற காசாளர்களும் பில் போடுகிறார்கள்; திருப்பங்களை சரிபார்க்கலாம்.` },
        facts: { count: top[1].returns, of: retTotal },
        drill: { kind: "returns", staff: top[0], date: range.to, days: 30 },
      });
    }
  }

  const rank = { high: 0, watch: 1, info: 2 } as const;
  return out.sort((a, b) => b.date.localeCompare(a.date) || rank[a.severity] - rank[b.severity] || a.key.localeCompare(b.key));
}

/** One short English line per alert for the daily summary's facts (titles only; staff names are the owner's own). */
export const summaryLines = (alerts: UnusualAlert[], max = 3): string[] => alerts.slice(0, max).map((a) => a.title.en);
