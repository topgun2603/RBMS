/**
 * Tamil Nadu festival calendar for shop planning (2025 to 2027). Dates are the day of the festival as celebrated in
 * Tamil Nadu; lunar festivals (Vinayagar Chathurthi, Karthigai Deepam, Ramzan, Bakrid) can differ by a day with the moon
 * sighting, and 2027 dates are the published almanac dates at the time of writing, so treat them as plan dates, not
 * ritual dates. A shop's own "last year" sales decide how much a festival matters; the calendar only says when.
 */

export interface PlanFestival {
  /** Same id every year ("deepavali"), so last year's window can be found. */
  id: string;
  year: number;
  name: string;
  nameTa: string;
  /** IST date, YYYY-MM-DD. */
  date: string;
  /** Days before the festival when shoppers stock up. */
  leadDays: number;
}

const f = (id: string, year: number, name: string, nameTa: string, date: string, leadDays: number): PlanFestival => ({ id, year, name, nameTa, date, leadDays });

export const PLAN_FESTIVALS: readonly PlanFestival[] = [
  f("pongal", 2025, "Pongal", "பொங்கல்", "2025-01-14", 7),
  f("ramzan", 2025, "Ramzan", "ரம்ஜான்", "2025-03-31", 7),
  f("tamil-new-year", 2025, "Tamil New Year", "தமிழ்ப் புத்தாண்டு", "2025-04-14", 5),
  f("bakrid", 2025, "Bakrid", "பக்ரீத்", "2025-06-07", 5),
  f("aadi", 2025, "Aadi Perukku", "ஆடிப்பெருக்கு", "2025-08-03", 3),
  f("vinayagar", 2025, "Vinayagar Chathurthi", "விநாயகர் சதுர்த்தி", "2025-08-27", 5),
  f("ayudha-pooja", 2025, "Navaratri / Ayudha Pooja", "நவராத்திரி / ஆயுத பூஜை", "2025-10-01", 8),
  f("deepavali", 2025, "Deepavali", "தீபாவளி", "2025-10-20", 14),
  f("karthigai", 2025, "Karthigai Deepam", "கார்த்திகை தீபம்", "2025-12-03", 3),
  f("christmas", 2025, "Christmas", "கிறிஸ்துமஸ்", "2025-12-25", 7),

  f("pongal", 2026, "Pongal", "பொங்கல்", "2026-01-14", 7),
  f("ramzan", 2026, "Ramzan", "ரம்ஜான்", "2026-03-20", 7),
  f("tamil-new-year", 2026, "Tamil New Year", "தமிழ்ப் புத்தாண்டு", "2026-04-14", 5),
  f("bakrid", 2026, "Bakrid", "பக்ரீத்", "2026-05-27", 5),
  f("aadi", 2026, "Aadi Perukku", "ஆடிப்பெருக்கு", "2026-08-03", 3),
  f("vinayagar", 2026, "Vinayagar Chathurthi", "விநாயகர் சதுர்த்தி", "2026-09-14", 5),
  f("ayudha-pooja", 2026, "Navaratri / Ayudha Pooja", "நவராத்திரி / ஆயுத பூஜை", "2026-10-19", 8),
  f("deepavali", 2026, "Deepavali", "தீபாவளி", "2026-11-08", 14),
  f("karthigai", 2026, "Karthigai Deepam", "கார்த்திகை தீபம்", "2026-11-24", 3),
  f("christmas", 2026, "Christmas", "கிறிஸ்துமஸ்", "2026-12-25", 7),

  f("pongal", 2027, "Pongal", "பொங்கல்", "2027-01-14", 7),
  f("ramzan", 2027, "Ramzan", "ரம்ஜான்", "2027-03-10", 7),
  f("tamil-new-year", 2027, "Tamil New Year", "தமிழ்ப் புத்தாண்டு", "2027-04-14", 5),
  f("bakrid", 2027, "Bakrid", "பக்ரீத்", "2027-05-17", 5),
  f("aadi", 2027, "Aadi Perukku", "ஆடிப்பெருக்கு", "2027-08-03", 3),
  f("vinayagar", 2027, "Vinayagar Chathurthi", "விநாயகர் சதுர்த்தி", "2027-09-04", 5),
  f("ayudha-pooja", 2027, "Navaratri / Ayudha Pooja", "நவராத்திரி / ஆயுத பூஜை", "2027-10-08", 8),
  f("deepavali", 2027, "Deepavali", "தீபாவளி", "2027-10-29", 14),
  f("karthigai", 2027, "Karthigai Deepam", "கார்த்திகை தீபம்", "2027-12-13", 3),
  f("christmas", 2027, "Christmas", "கிறிஸ்துமஸ்", "2027-12-25", 7),
];

const DAY = 86_400_000;
const ms = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, dd);
};
export const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);

export interface FestivalAhead {
  festival: PlanFestival;
  /** Days from today to the festival day (0 = today). */
  daysAway: number;
  /** The shopping window: from `windowStart` to the day before the festival (inclusive). */
  windowStart: string;
  windowEnd: string;
}

/**
 * Festivals whose shopping window the next `horizon` days touch (a festival 10 days away with a 14-day lead is "in its
 * window now"). Sorted by date. Festivals already past are left out.
 */
export function festivalsAhead(today: string, horizon = 30, list: readonly PlanFestival[] = PLAN_FESTIVALS): FestivalAhead[] {
  const out: FestivalAhead[] = [];
  for (const fest of list) {
    const away = daysBetween(today, fest.date);
    if (away < 0 || away > horizon) continue;
    out.push({ festival: fest, daysAway: away, windowStart: addDays(fest.date, -fest.leadDays), windowEnd: addDays(fest.date, -1) });
  }
  return out.sort((a, b) => a.festival.date.localeCompare(b.festival.date));
}

/** The same festival one year earlier (null when the calendar has none). */
export function lastYearOf(fest: PlanFestival, list: readonly PlanFestival[] = PLAN_FESTIVALS): PlanFestival | null {
  return list.find((x) => x.id === fest.id && x.year === fest.year - 1) ?? null;
}
