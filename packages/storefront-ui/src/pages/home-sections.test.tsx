import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en, ta, translatorFor } from "../lib/messages";
import { sectionsEn, sectionsTa } from "../lib/messages-sections";
import type { HomeSection, HomeSectionOf, PublicMetalRates, StoreConfig } from "../types";
import { DietMark, FaqSection, GoldRatesSection, LocationSection, MenuBoardSection, offerEnded, SectionFrame } from "./home-sections";

const t = translatorFor("en");
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const config = { shop: { name: "Lakshmi Jewellers", contactPhone: "", contactEmail: "", social: {} } } as unknown as StoreConfig;
const text = (style?: HomeSection["style"]): HomeSection => ({ type: "text", markdown: "Hi", ...(style ? { style } : {}) });

describe("section style frame", () => {
  it("leaves unstyled sections exactly as they were", () => {
    expect(html(<SectionFrame section={text()}>X</SectionFrame>)).toBe("X");
    expect(html(<SectionFrame section={text({ hideOnMobile: false })}>X</SectionFrame>)).toBe("X");
  });

  it("puts the section on a band with spacing, width and hide rules", () => {
    const out = html(
      <SectionFrame section={text({ background: "dark", padding: "spacious", width: "contained", align: "center", hideOnMobile: true })}>
        <p>X</p>
      </SectionFrame>,
    );
    expect(out).toContain('data-sf-align="center"');
    expect(out).toContain("max-md:hidden");
    expect(out).toContain("sf-unboxed");
    expect(out).toContain("bg-neutral-950");
    expect(out).toContain("sf-on-tone");
    expect(out).toContain("rounded-[var(--sf-radius-card)]");
    expect(out).toContain("py-[calc(var(--sf-section)*1.45)]");
  });

  it("darkens a picture background with the overlay; no picture = no band", () => {
    const out = html(<SectionFrame section={text({ background: "image", imageUrl: "https://cdn.example.in/bg.jpg", overlay: 60 })}>X</SectionFrame>);
    expect(out).toContain('src="https://cdn.example.in/bg.jpg"');
    expect(out).toContain("opacity:0.6");
    expect(html(<SectionFrame section={text({ background: "image" })}>X</SectionFrame>)).not.toContain("<img");
  });

  it("never ships the entrance animation hidden in the server HTML", () => {
    for (const animation of ["fade", "rise"] as const) {
      const out = html(<SectionFrame section={text({ animation })}>X</SectionFrame>);
      expect(out).toContain("X");
      expect(out).not.toMatch(/opacity:\s*0[;"]/);
    }
  });
});

describe("trade sections", () => {
  it("gold rates: per-gram tiles with the pavun price, nothing when rates are off", () => {
    const s: HomeSectionOf<"gold-rates"> = { type: "gold-rates", showSilver: true };
    const rates: PublicMetalRates = {
      date: "2026-10-20",
      setToday: true,
      rates: [
        { metal: "gold", purity: "24K", ratePerGram: 780000, date: "2026-10-20" },
        { metal: "gold", purity: "22K", ratePerGram: 715195, date: "2026-10-20" },
        { metal: "silver", purity: "999", ratePerGram: 9800, date: "2026-10-20" },
      ],
    };
    const out = html(<GoldRatesSection s={s} t={t} rates={rates} locale="en" />);
    expect(out).toContain("Gold 22K");
    expect(out).toContain("Silver");
    expect(out).toContain("per pavun");
    expect(out).toContain("Updated today");
    expect(html(<GoldRatesSection s={{ ...s, showSilver: false }} t={t} rates={rates} locale="en" />)).not.toContain("Silver");
    expect(html(<GoldRatesSection s={s} t={t} rates={null} locale="en" />)).toBe("");
    expect(html(<GoldRatesSection s={s} t={t} rates={{ ...rates, rates: [] }} locale="en" />)).toBe("");
  });

  it("location: OpenStreetMap from the pin, falls back to the shop phone, renders nothing without any detail", () => {
    const s: HomeSectionOf<"location"> = { type: "location", address: "12 West Masi St, Madurai", hours: [{ label: "Mon – Sat", value: "10 – 9" }], coords: "9.9252, 78.1198" };
    const out = html(<LocationSection s={s} t={t} config={config} />);
    expect(out).toContain("openstreetmap.org/export/embed.html");
    expect(out).toContain("marker=9.9252%2C78.1198");
    expect(out).toContain("Get directions");
    expect(out).not.toContain("tel:");
    const withPhone = { ...config, shop: { ...config.shop, contactPhone: "+91 98765 43210" } } as StoreConfig;
    expect(html(<LocationSection s={{ type: "location", hours: [] }} t={t} config={withPhone} />)).toContain('href="tel:+919876543210"');
    expect(html(<LocationSection s={{ type: "location", hours: [] }} t={t} config={config} />)).toBe("");
  });

  it("menu board: veg / non-veg marks are labelled; prices in rupees", () => {
    const out = html(
      <MenuBoardSection
        s={{ type: "menu-board", groups: [{ name: "Tiffin", items: [{ name: "Idli", price: 4500, diet: "veg" }, { name: "Biryani", price: 22000, diet: "nonveg" }] }] }}
        t={t}
      />,
    );
    expect(out).toContain('aria-label="Veg"');
    expect(out).toContain('aria-label="Non-veg"');
    expect(out).toContain("45");
    expect(html(<DietMark diet="egg" t={t} />)).toContain("Contains egg");
  });

  it("FAQ uses native details/summary, the first one open", () => {
    const out = html(<FaqSection s={{ type: "faq", items: [{ q: "COD?", a: "Yes" }, { q: "Returns?", a: "7 days" }] }} t={t} />);
    expect(out.match(/<details/g)).toHaveLength(2);
    expect(out).toContain("<details class=\"group\" open=\"\">");
  });

  it("an offer that has ended is dropped", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    expect(offerEnded({ type: "offer", heading: "x", endsAt: "2026-10-19T10:00:00Z" }, now)).toBe(true);
    expect(offerEnded({ type: "offer", heading: "x", endsAt: "2026-10-21T10:00:00Z" }, now)).toBe(false);
    expect(offerEnded({ type: "offer", heading: "x" }, now)).toBe(false);
    expect(offerEnded(text(), now)).toBe(false);
  });
});

describe("section strings", () => {
  it("are in English and Tamil with the same placeholders, and merged into the store bundle", () => {
    expect(Object.keys(sectionsTa).sort()).toEqual(Object.keys(sectionsEn).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(sectionsEn)) expect(vars(sectionsTa[k]!), k).toEqual(vars(sectionsEn[k]!));
    for (const k of Object.keys(sectionsEn)) {
      expect(en[k], k).toBe(sectionsEn[k]);
      expect(ta[k], k).toBe(sectionsTa[k]);
    }
  });
});
