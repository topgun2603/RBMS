import * as React from "react";
import { ShoeSizeChart } from "../client/shoe-size-chart";

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

export type SizeKind = "top" | "bottom" | "saree" | "shoe-men" | "shoe-women" | "shoe-kids";

/** Footwear words (and the footwear trade's id) that switch to the shoe chart. Not "oxford" / "derby": shirts too. */
const SHOE_RE =
  /\b(footwear|shoes?|sandals?|chappals?|slippers?|heels|juttis?|mojaris?|kolhapuris?|sneakers?|loafers?|boots?|floaters?|flip-?flops?|clogs?|slides|brogues?|moccasins?|bellies|ballerinas?|wedges)\b|காலணி|செருப்பு/;
const KIDS_RE = /\b(kids?|child|children|boys?|girls?|school|toddlers?|baby|infants?)\b|குழந்தை/;
const WOMEN_RE = /\b(women|womens|ladies|lady|heels|juttis?|bellies|ballerinas?|wedges)\b|பெண்/;

/**
 * Which default chart fits a product (from its shop's trade, category and name). Footwear gets the shoe chart, opened on
 * the kids' / women's / men's tab by the words it finds; clothing keeps the blouse / bottom / top charts.
 */
export function sizeKindFor(...hints: (string | null | undefined)[]): SizeKind {
  const s = hints.filter(Boolean).join(" ").toLowerCase();
  if (SHOE_RE.test(s)) return KIDS_RE.test(s) ? "shoe-kids" : WOMEN_RE.test(s) ? "shoe-women" : "shoe-men";
  if (/saree|sari|புடவை|blouse/.test(s)) return "saree";
  if (/bottom|palazzo|pant|trouser|legging|skirt|churidar|salwar|jean|dhoti|veshti/.test(s)) return "bottom";
  return "top";
}

/**
 * The chart for a pack's `sizeGuide` setting: a `shoes` pack always gets the shoe chart (men / women / kids by the
 * words it finds, men's by default), a `clothing` pack follows the product words, so a sports shop's trainers still get
 * the shoe chart; null = no guide.
 */
export function sizeKindForGuide(guide: "clothing" | "shoes" | null | undefined, ...hints: (string | null | undefined)[]): SizeKind | null {
  if (!guide) return null;
  const kind = sizeKindFor(...hints);
  if (guide === "clothing" || kind.startsWith("shoe-")) return kind;
  const s = hints.filter(Boolean).join(" ").toLowerCase();
  return KIDS_RE.test(s) ? "shoe-kids" : WOMEN_RE.test(s) ? "shoe-women" : "shoe-men";
}

const CHARTS: Record<"top" | "bottom" | "saree", { cols: string[]; rows: (string | number)[][] }> = {
  top: {
    cols: ["size", "bust", "waist", "length"],
    rows: [
      ["XS", 32, 26, 44],
      ["S", 34, 28, 44],
      ["M", 36, 30, 45],
      ["L", 38, 32, 45],
      ["XL", 40, 34, 46],
      ["XXL", 42, 36, 46],
    ],
  },
  bottom: {
    cols: ["size", "waist", "hip", "length"],
    rows: [
      ["S", "26–28", 36, 38],
      ["M", "28–30", 38, 39],
      ["L", "30–32", 40, 39],
      ["XL", "32–34", 42, 40],
      ["XXL", "34–36", 44, 40],
    ],
  },
  saree: {
    cols: ["blouse", "bust", "waist", "shoulder"],
    rows: [
      [32, 32, 28, 13.5],
      [34, 34, 30, 14],
      [36, 36, 32, 14.5],
      [38, 38, 34, 15],
      [40, 40, 36, 15.5],
      [42, 42, 38, 16],
    ],
  },
};

/** Default size chart (inches) with how-to-measure notes. Shops can replace it with a CMS page at /size-guide. */
export function SizeChart({ kind, t, guideHref }: { kind: SizeKind; t: T; /** Footwear: link to the shop's own size guide page under the chart. */ guideHref?: string }) {
  if (kind === "shoe-men" || kind === "shoe-women" || kind === "shoe-kids") return <ShoeSizeChart initial={kind === "shoe-kids" ? "kids" : kind === "shoe-women" ? "women" : "men"} guideHref={guideHref} />;
  const chart = CHARTS[kind];
  return (
    <div className="grid gap-4 text-sm">
      <p className="text-muted-foreground">{kind === "saree" ? t("size.sareeNote") : t("size.note")}</p>
      <div className="overflow-hidden rounded-2xl border">
        <table className="w-full text-center tabular-nums">
          <thead className="bg-tint-2 text-xs font-semibold tracking-wide uppercase">
            <tr>
              {chart.cols.map((c) => (
                <th key={c} scope="col" className="px-3 py-2.5">
                  {t(`size.col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((r, i) => (
              <tr key={i} className="border-t odd:bg-muted/30">
                {r.map((v, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="px-3 py-2 font-semibold">
                      {v}
                    </th>
                  ) : (
                    <td key={j} className="px-3 py-2">
                      {v}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-1.5 text-muted-foreground">
        <li>
          <span className="font-semibold text-foreground">{t("size.col.bust")}:</span> {t("size.howBust")}
        </li>
        <li>
          <span className="font-semibold text-foreground">{t("size.col.waist")}:</span> {t("size.howWaist")}
        </li>
        <li>{t("size.between")}</li>
      </ul>
    </div>
  );
}
