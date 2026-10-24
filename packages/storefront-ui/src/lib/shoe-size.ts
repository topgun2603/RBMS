/*
 * Foot length → UK / India shoe size for the size finder (pure). Same scale as the product page's shoe chart
 * (client/shoe-size-chart): one size = ⅓ inch ≈ 0.846 cm; adult UK 7 ≈ 25.4 cm (sizes "1"–"13"), children's 8C ≈
 * 15.2 cm ("8C"–"13C"). Approximate, as every last differs a little.
 */

const STEP = 0.846;

/** The longest foot (cm) a size label fits, or null for a label that isn't a UK size ("Free size", "M"). */
export function footCmFor(label: string): number | null {
  const m = /^\s*(?:uk\s*)?(\d{1,2}(?:\.5)?)\s*(c)?\s*$/i.exec(label);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2]) return n >= 4 && n <= 13.5 ? 8.43 + STEP * n : null;
  return n >= 1 && n <= 15 ? 19.48 + STEP * n : null;
}

/** The smallest of `sizes` whose length covers the foot (a little room for the toes), or null when none fits. */
export function sizeForFoot(sizes: readonly string[], footCm: number): string | null {
  if (!Number.isFinite(footCm) || footCm < 8 || footCm > 35) return null;
  const fits = sizes
    .map((s) => ({ s, cm: footCmFor(s) }))
    .filter((x): x is { s: string; cm: number } => x.cm !== null && x.cm + 0.05 >= footCm)
    .sort((a, b) => a.cm - b.cm);
  return fits[0]?.s ?? null;
}
