import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JEWELLERY_FEATURES, JEWELLERY_PERMISSIONS } from "./lib/access";
import { jewelleryMessages } from "./lib/messages";
import { buybackRate, isValidHuid, MAKING_TYPES, METALS, oldGoldValue, priceBreakdown, rateOf, resolveRates } from "./lib/pricing";
import { EXCHANGE_STATUSES, PIECE_STATUSES } from "./lib/types";
import { jewelleryModule } from "./module";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });

describe("jewellery messages", () => {
  const en = Object.keys(jewelleryMessages.en).sort();
  const ta = Object.keys(jewelleryMessages.ta).sort();

  it("has the same keys in English and Tamil", () => {
    expect(ta).toEqual(en);
  });

  it("covers every key the module uses", () => {
    const src = files(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");
    const notMessages = new Set<string>([...Object.values(JEWELLERY_FEATURES), ...Object.values(JEWELLERY_PERMISSIONS)]);
    const used = new Set([...src.matchAll(/["`](jewellery\.[A-Za-z0-9_.]+)["`]/g)].map((m) => m[1]!).filter((k) => !notMessages.has(k)));
    for (const m of METALS) used.add(`jewellery.metal.${m}`);
    for (const s of PIECE_STATUSES) used.add(`jewellery.pieceStatus.${s}`);
    for (const s of EXCHANGE_STATUSES) used.add(`jewellery.exchangeStatus.${s}`);
    for (const m of MAKING_TYPES) used.add(`jewellery.making.${m}`);
    expect([...used].filter((k) => !(k in jewelleryMessages.en))).toEqual([]);
  });
});

describe("jewelleryModule", () => {
  it("mounts at /jewellery and gates every route and nav item by a jewellery feature", () => {
    const m = jewelleryModule();
    expect(m.id).toBe("jewellery");
    expect(m.basePath).toBe("/jewellery");
    expect(jewelleryModule({ basePath: "/gold" }).basePath).toBe("/gold");
    for (const r of m.routes) expect(String(r.feature)).toMatch(/^jewellery/);
    for (const i of m.nav.flatMap((s) => s.items)) expect(String(i.feature)).toMatch(/^jewellery/);
    expect(m.routes.map((r) => r.path)).toEqual(["", "pieces", "exchange", "exchange/:id"]);
    expect(m.settings?.map((s) => s.path)).toEqual(["jewellery"]);
    expect(m.widgets?.filter((w) => w.zone === "kpi")).toHaveLength(2);
    expect(jewelleryModule({ widgets: false }).widgets).toEqual([]);
    expect(m.routes.find((r) => r.path === "exchange")?.feature).toBe("jewellery.exchange");
  });
});

describe("client pricing (mirrors @srirealtime/jewellery)", () => {
  it("derives purities from 24K and keeps overrides", () => {
    const card = resolveRates([
      { metal: "gold", purity: "24K", ratePerGram: 720000 },
      { metal: "gold", purity: "22K", ratePerGram: 662000 },
    ]);
    expect(rateOf(card, "gold", "22K")).toBe(662000);
    expect(rateOf(card, "gold", "18K")).toBe(540541);
    expect(rateOf(card, "silver", "925")).toBeNull();
  });

  it("gives the same breakdown as the server", () => {
    const b = priceBreakdown({ grossWeight: 10.5, stoneWeight: 0.5, wastagePct: 8, makingType: "per_gram", makingValue: 50000, stoneCharges: 150000 }, 660000, { roundTo: 100 });
    expect(b).toMatchObject({ metalValue: 6_600_000, wastage: 528_000, making: 500_000, stones: 150_000, total: 7_778_000, gst: 233_340, totalWithGst: 8_011_340 });
    expect(priceBreakdown({ grossWeight: 1.234, makingType: "flat", makingValue: 0 }, 660123, { roundTo: 100 })).toMatchObject({ subtotal: 814592, total: 814600, rounding: 8 });
  });

  it("values old gold and checks HUIDs", () => {
    expect(oldGoldValue({ grossWeight: 10, deductionPct: 2.5 }, buybackRate(660000, 2))).toEqual({ netWeight: 9.75, value: 6_306_300 });
    expect(isValidHuid("AB12CD")).toBe(true);
    expect(isValidHuid("AB12C")).toBe(false);
  });
});
