/**
 * Daily prep forecast for a kitchen. All maths is code: for each dish, the last 8 same weekdays' sales (days the shop was
 * closed are skipped, outliers dropped), the trend, an optional festival uplift (the shop's own last-year ratio when it
 * has the data, else the owner's number) and an optional rain setting the owner chose. The light tier only writes the
 * kitchen note, and every number in it must be in the facts sheet.
 */
import { z } from "zod";
import type { AiRunner } from "../../assist/hsn";
import { DATA_RULES, dataBlock } from "../../assist/safety";
import { PLAN_FESTIVALS, type PlanFestival } from "../../insights/calendar";
import { allowedNumbers, checkNumbers } from "../../insights/numbers";
import { addDays, round2, weekdayOf } from "../common";
import { convertQty, unitFamily } from "./cost";

export const PREP_FEATURE = "prep-forecast";
export const WEEKS = 8;
/** Extra portions prepared over the expected number, so a good evening does not run out. */
export const BUFFER = 0.1;

export interface DishHistory {
  itemId: string;
  name: string;
  /** Portions sold per date (IST) for the weeks looked at; a missing date means none sold. */
  byDate: Record<string, number>;
}

export interface ForecastInput {
  /** IST today. */
  today: string;
  /** The day to prepare for (tomorrow, or today before opening). */
  forDate: string;
  dishes: DishHistory[];
  /** Dates the shop billed anything: a same-weekday with no bills at all (closed) is skipped. */
  openDates: ReadonlySet<string>;
  /** Owner's festival uplift in percent, used when the shop has no last-year data for the festival. */
  festivalPct?: number;
  /** Whole-shop daily totals around last year's festival: baseline same-weekday average and the festival day's total (portions). */
  festivalHistory?: { baseline: number; onDay: number } | null;
  rain?: boolean;
  /** Owner's rain setting in percent (negative = fewer). Default -10. */
  rainPct?: number;
  calendar?: readonly PlanFestival[];
}

export interface Festival {
  id: string;
  name: string;
  nameTa: string;
  date: string;
  /** "day" = the festival is the day being prepared for; "eve" = it is the next day. */
  when: "day" | "eve";
}

/** The festival on `forDate` or the day after it (the eve: people prepare and eat out). */
export function festivalAround(forDate: string, calendar: readonly PlanFestival[] = PLAN_FESTIVALS): Festival | null {
  for (const f of calendar) {
    if (f.date === forDate) return { id: f.id, name: f.name, nameTa: f.nameTa, date: f.date, when: "day" };
    if (f.date === addDays(forDate, 1)) return { id: f.id, name: f.name, nameTa: f.nameTa, date: f.date, when: "eve" };
  }
  return null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Drops values far from the median (more than 3 scaled MADs, at least 3 portions away). Needs 5 values to judge. */
export function dropOutliers(xs: number[]): { kept: number[]; dropped: number[] } {
  if (xs.length < 5) return { kept: xs, dropped: [] };
  const med = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - med))) * 1.4826;
  const limit = Math.max(3 * mad, 3);
  const kept: number[] = [];
  const dropped: number[] = [];
  for (const x of xs) (Math.abs(x - med) > limit ? dropped : kept).push(x);
  return kept.length >= 3 ? { kept, dropped } : { kept: xs, dropped: [] };
}

export interface DishForecast {
  itemId: string;
  name: string;
  /** Weekdays used (open days among the last 8 same weekdays). */
  samples: number;
  kept: number;
  dropped: number;
  /** Mean of the kept values. */
  base: number;
  /** Recent weeks against older weeks, limited to 0.85..1.2; 1 with under 6 samples. */
  trend: number;
  festival: number;
  rain: number;
  expected: number;
  /** Portions to prepare (expected plus the buffer, rounded up). */
  prep: number;
  lastWeek: number | null;
  low: boolean;
}

export interface Forecast {
  today: string;
  forDate: string;
  weekday: number;
  weeksChecked: string[];
  festival: Festival | null;
  /** The multiplier applied for the festival and where it came from. */
  festivalFactor: number;
  festivalSource: "shop" | "owner" | "none";
  rainFactor: number;
  dishes: DishForecast[];
  /** Dishes with no history on those weekdays (nothing to forecast). */
  skipped: string[];
}

export function forecast(input: ForecastInput): Forecast {
  const weekday = weekdayOf(input.forDate);
  const dates: string[] = [];
  for (let k = 1; k <= WEEKS; k++) {
    const d = addDays(input.forDate, -7 * k);
    if (d < input.today || d === input.today) dates.push(d);
  }
  // Days the shop was open, newest first. A closed day (no bills at all) says nothing about demand.
  const used = dates.filter((d) => input.openDates.has(d));
  const fest = festivalAround(input.forDate, input.calendar);
  let festivalFactor = 1;
  let festivalSource: Forecast["festivalSource"] = "none";
  if (fest) {
    const h = input.festivalHistory;
    if (h && h.baseline >= 10 && h.onDay > 0) {
      festivalFactor = Math.min(2, Math.max(1, round2(h.onDay / h.baseline)));
      festivalSource = "shop";
    } else if (input.festivalPct && input.festivalPct > 0) {
      festivalFactor = 1 + Math.min(100, input.festivalPct) / 100;
      festivalSource = "owner";
    }
  }
  const rainFactor = input.rain ? 1 + Math.max(-50, Math.min(50, input.rainPct ?? -10)) / 100 : 1;

  const dishes: DishForecast[] = [];
  const skipped: string[] = [];
  for (const d of input.dishes) {
    const values = used.map((date) => d.byDate[date] ?? 0);
    if (values.every((v) => v === 0)) {
      skipped.push(d.name);
      continue;
    }
    const { kept, dropped } = dropOutliers(values);
    const base = mean(kept);
    // `used` is newest first: the first half is recent, the second older.
    let trend = 1;
    if (values.length >= 6) {
      const half = Math.floor(values.length / 2);
      const recent = mean(values.slice(0, half));
      const older = mean(values.slice(half));
      if (older > 0 && recent > 0) trend = Math.min(1.2, Math.max(0.85, round2(recent / older)));
    }
    const expected = base * trend * festivalFactor * rainFactor;
    dishes.push({
      itemId: d.itemId,
      name: d.name,
      samples: values.length,
      kept: kept.length,
      dropped: dropped.length,
      base: round2(base),
      trend,
      festival: festivalFactor,
      rain: rainFactor,
      expected: round2(expected),
      prep: Math.max(1, Math.ceil(expected * (1 + BUFFER) - 1e-9)),
      lastWeek: used[0] === addDays(input.forDate, -7) ? (d.byDate[used[0]!] ?? 0) : null,
      low: values.length < 3,
    });
  }
  dishes.sort((a, b) => b.prep - a.prep || a.name.localeCompare(b.name));
  return { today: input.today, forDate: input.forDate, weekday, weeksChecked: used, festival: fest, festivalFactor, festivalSource, rainFactor, dishes, skipped };
}

// ------------------------------------------------------------------ ingredient totals

export interface RecipeForPrep {
  itemId: string;
  lines: { ingredient: string; qty: number; unit: string }[];
}

export interface IngredientTotal {
  ingredient: string;
  /** Total in a readable unit: kg / l / pcs. */
  qty: number;
  unit: "kg" | "l" | "pcs";
  /** Dishes that use it. */
  dishes: number;
}

/** Ingredients to take out for the forecast: prep portions x recipe quantity, summed per ingredient in kg / l / pcs. */
export function ingredientTotals(f: Forecast, recipes: RecipeForPrep[]): { totals: IngredientTotal[]; withoutRecipe: string[] } {
  const byItem = new Map(recipes.map((r) => [r.itemId, r]));
  const sums = new Map<string, { name: string; base: number; family: "mass" | "volume" | "count"; dishes: Set<string> }>();
  const withoutRecipe: string[] = [];
  for (const d of f.dishes) {
    const r = byItem.get(d.itemId);
    if (!r || r.lines.length === 0) {
      withoutRecipe.push(d.name);
      continue;
    }
    for (const l of r.lines) {
      const fam = unitFamily(l.unit);
      if (!fam) continue;
      const base = convertQty(l.qty * d.prep, l.unit, fam === "mass" ? "g" : fam === "volume" ? "ml" : "pcs");
      if (base === null) continue;
      const key = `${l.ingredient.trim().toLowerCase()}|${fam}`;
      const cur = sums.get(key) ?? { name: l.ingredient.trim(), base: 0, family: fam, dishes: new Set<string>() };
      cur.base += base;
      cur.dishes.add(d.itemId);
      sums.set(key, cur);
    }
  }
  const totals: IngredientTotal[] = [...sums.values()].map((s) => ({
    ingredient: s.name,
    qty: s.family === "count" ? Math.ceil(s.base) : round2(s.base / 1000),
    unit: s.family === "mass" ? "kg" : s.family === "volume" ? "l" : "pcs",
    dishes: s.dishes.size,
  }));
  totals.sort((a, b) => a.ingredient.localeCompare(b.ingredient));
  return { totals, withoutRecipe };
}

// ------------------------------------------------------------------ kitchen note (light tier)

export type PrepLang = "en" | "ta";
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_TA = ["ஞாயிறு", "திங்கள்", "செவ்வாய்", "புதன்", "வியாழன்", "வெள்ளி", "சனி"];

export function prepSheet(f: Forecast, totals: IngredientTotal[], top = 8): string {
  const lines = [
    `date: ${f.forDate} (${WEEKDAYS_EN[f.weekday]}), which is ${f.forDate === f.today ? "today" : f.forDate === addDays(f.today, 1) ? "tomorrow" : "a later day"}`,
    `same weekdays checked: ${f.weeksChecked.length}`,
    f.festival ? `festival: ${f.festival.name} ${f.festival.when === "day" ? "on this day" : "tomorrow"}; uplift ${Math.round((f.festivalFactor - 1) * 100)}% (${f.festivalSource})` : "festival: none",
    f.rainFactor !== 1 ? `rain expected: change ${Math.round((f.rainFactor - 1) * 100)}% (owner setting)` : "rain: not set",
    ...f.dishes.slice(0, top).map((d) => `${d.name}: prepare ${d.prep} portions (usually ${Math.round(d.base)}${d.lastWeek !== null ? `, last week ${d.lastWeek}` : ""})`),
    ...totals.slice(0, 8).map((t) => `${t.ingredient}: ${t.qty} ${t.unit}`),
  ];
  return lines.join("\n");
}

export function templateNote(f: Forecast, lang: PrepLang): string {
  const day = lang === "ta" ? WEEKDAYS_TA[f.weekday] : WEEKDAYS_EN[f.weekday];
  if (f.dishes.length === 0) return lang === "ta" ? `${day}: முன்னறிவிப்புக்கு போதிய விற்பனை பதிவு இல்லை.` : `${day}: not enough past sales to forecast.`;
  const top = f.dishes.slice(0, 5).map((d) => `${d.name} ${d.prep}`).join(", ");
  const fest = f.festival ? (lang === "ta" ? ` ${f.festival.nameTa} ${f.festival.when === "day" ? "இன்று" : "நாளை"}.` : ` ${f.festival.name} ${f.festival.when === "day" ? "today" : "tomorrow"}.`) : "";
  return lang === "ta" ? `${day} தயாரிப்பு: ${top}.${fest}` : `Prep for ${day}: ${top}.${fest}`;
}

export const PREP_SYSTEM = [
  "You write a short note for the kitchen staff of a restaurant in Tamil Nadu about what to prepare, in the language asked (en = English, ta = Tamil; Tamil in simple spoken-style words a cook understands).",
  "Use only the dishes, numbers and ingredient totals in the facts sheet. Mention the biggest preparations, any festival or rain setting, and the main ingredient quantities. At most 60 words, plain text, no markdown.",
  "Never calculate, round or invent a number, and do not add dishes, ingredients or advice that are not in the sheet.",
  DATA_RULES,
].join("\n");
const Out = z.object({ note: z.string() });
const OUT_JSON = { type: "object", properties: { note: { type: "string" } }, required: ["note"], additionalProperties: false } as const;

export async function writeKitchenNote(ai: AiRunner, req: { tenantId: string; userId?: string | null; forecast: Forecast; totals: IngredientTotal[]; lang: PrepLang }) {
  const template = templateNote(req.forecast, req.lang);
  if (req.forecast.dishes.length === 0) return { note: template, source: "template" as const, runId: null as string | null, credits: 0, aiNote: null as string | null };
  const sheet = prepSheet(req.forecast, req.totals);
  try {
    const r = await ai.run<z.infer<typeof Out>>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: PREP_FEATURE,
      tier: "light",
      system: PREP_SYSTEM,
      input: { text: `Language: ${req.lang}\n${dataBlock("facts sheet", sheet)}` },
      schema: { name: "kitchen_note", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: Out },
      maxTokens: 1500,
    });
    const got = r.output.note.replace(/\s+/g, " ").trim();
    const ok = got.length > 0 && got.length <= 600 && checkNumbers(got, allowedNumbers(sheet)).ok && (req.lang !== "ta" || /[஀-௿]/.test(got));
    return { note: ok ? got : template, source: ok ? ("ai" as const) : ("template" as const), runId: r.runId as string | null, credits: r.credits, aiNote: ok ? null : "numbers" };
  } catch (e) {
    return { note: template, source: "template" as const, runId: null as string | null, credits: 0, aiNote: (e as { code?: string }).code ?? "ai_failed" };
  }
}
