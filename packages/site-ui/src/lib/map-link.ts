/** "9.9252, 78.1198" — what Google Maps copies when you right-click a place. */
const PAIR = /^-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/;

function norm(a: string, b: string): string | null {
  const lat = Number(a);
  const lng = Number(b);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? `${lat}, ${lng}` : null;
}

/**
 * Pulls "lat, lng" out of what an owner pastes: the pair itself or a Google Maps / OpenStreetMap link
 * (`@9.92,78.11,17z`, `!3d9.92!4d78.11`, `?q=9.92,78.11`, `ll=`, `#map=17/9.92/78.11`, `mlat=..&mlon=..`).
 * Returns the normalised pair, or null (short maps.app.goo.gl links carry no numbers; keep the text as typed then).
 */
export function coordsFromText(input: string | null | undefined): string | null {
  const v = (input ?? "").trim();
  if (!v) return null;
  if (PAIR.test(v)) {
    const [a, b] = v.split(",").map((x) => x.trim()) as [string, string];
    return norm(a, b);
  }
  let t = v;
  try {
    t = decodeURIComponent(v);
  } catch {
    /* keep raw */
  }
  const N = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
  const pats = [
    `!3d${N}!4d${N}`,
    `@${N},${N}`,
    String.raw`[?&](?:q|ll|query|center|destination)=${N}(?:,|\+)\s*${N}`,
    `mlat=${N}&mlon=${N}`,
    String.raw`#map=\d+/${N}/${N}`,
  ];
  for (const p of pats) {
    const m = new RegExp(p).exec(t);
    const r = m && norm(m[1]!, m[2]!);
    if (r) return r;
  }
  return null;
}
