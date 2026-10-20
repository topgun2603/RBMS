"use client";

import * as React from "react";
import { HeartIcon, MenuIcon, SearchIcon, ShoppingBagIcon, UserRoundIcon } from "lucide-react";
import { cn } from "@srirealtime/ui";
import type { StoreTheme } from "@srirealtime/branding/theme";
import type { Copy } from "@srirealtime/verticals";
import { readableOn, type AppearanceDraft } from "../lib/appearance";

const RATIO: Record<StoreTheme["imageRatio"], string> = { portrait: "4 / 5", square: "1 / 1", landscape: "4 / 3" };
const BTN: Record<StoreTheme["buttons"], string> = { rounded: "0.5rem", pill: "9999px", square: "2px" };

/** The motif as an inline background (the admin app doesn't load the storefront stylesheet). */
function motifBackground(motif: StoreTheme["motif"], primary: string): React.CSSProperties {
  const base = `linear-gradient(120deg, color-mix(in oklch, ${primary} 78%, black) 0%, ${primary} 100%)`;
  switch (motif) {
    case "kolam":
      return {
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 48 48'%3E%3Cg fill='none' stroke='%23fff' stroke-opacity='.16'%3E%3Cpath d='M24 8 40 24 24 40 8 24Z'/%3E%3Cpath d='M24 16 32 24 24 32 16 24Z'/%3E%3C/g%3E%3C/svg%3E"), linear-gradient(120deg, color-mix(in oklch, ${primary} 72%, black), ${primary} 55%, color-mix(in oklch, ${primary} 70%, #f5b971))`,
        backgroundSize: "32px 32px, auto",
      };
    case "dots":
      return { backgroundImage: `radial-gradient(circle, rgb(255 255 255 / 0.25) 1.2px, transparent 1.3px), ${base}`, backgroundSize: "14px 14px, auto" };
    case "waves":
      return {
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='16' viewBox='0 0 120 24'%3E%3Cpath d='M0 12c20 0 20-10 40-10s20 10 40 10 20-10 40-10' fill='none' stroke='%23fff' stroke-opacity='.2' stroke-width='1.5'/%3E%3C/svg%3E"), ${base}`,
        backgroundSize: "80px 16px, auto",
      };
    case "grid":
      return {
        backgroundImage: `linear-gradient(rgb(255 255 255 / 0.09) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.09) 1px, transparent 1px), ${base}`,
        backgroundSize: "20px 20px, 20px 20px, auto",
      };
    default:
      return { backgroundImage: base };
  }
}

/**
 * A miniature store built from the draft: header, hero, a section heading and three product cards, each drawn in the
 * chosen variant, colours and fonts. Not the real storefront, but every choice in the editor is visible here.
 */
export function ThemePreview({ draft, copy, shopName }: { draft: AppearanceDraft; copy: Copy; shopName: string }) {
  const th = draft.theme;
  const primary = draft.colors.primary;
  const dark = draft.mode === "dark";
  const bg = draft.colors.background ?? (dark ? "#111113" : "#ffffff");
  const fg = draft.colors.foreground ?? readableOn(bg);
  const radius = `${draft.radius}rem`;
  const card = `calc(${radius} + 0.4rem)`;
  const vars = {
    "--pv-primary": primary,
    "--pv-on-primary": readableOn(primary),
    "--pv-bg": bg,
    "--pv-fg": fg,
    "--pv-muted": `color-mix(in oklch, ${fg} 55%, ${bg})`,
    "--pv-tint": `color-mix(in oklch, ${primary} 8%, ${bg})`,
    "--pv-border": `color-mix(in oklch, ${fg} 14%, ${bg})`,
    fontFamily: `"${draft.fontSans}", ui-sans-serif, system-ui, sans-serif`,
    background: "var(--pv-bg)",
    color: "var(--pv-fg)",
  } as React.CSSProperties;
  const heading: React.CSSProperties = { fontFamily: `"${draft.fontHeading}", ui-serif, serif` };
  const btn: React.CSSProperties = { borderRadius: BTN[th.buttons], background: "var(--pv-primary)", color: "var(--pv-on-primary)" };
  const gap = th.density === "compact" ? "gap-4" : "gap-6";

  const nav = (
    <span className="flex gap-3 text-[11px] opacity-75">
      <span>Shop</span>
      <span>{copy.newItems}</span>
      <span>Offers</span>
    </span>
  );
  const icons = (
    <span className="flex gap-2 opacity-80">
      <SearchIcon className="size-3.5" />
      <UserRoundIcon className="size-3.5" />
      <ShoppingBagIcon className="size-3.5" />
    </span>
  );
  const logo = (
    <span className="text-sm font-bold" style={heading}>
      {shopName}
    </span>
  );

  return (
    <div className="overflow-hidden rounded-xl border shadow-sm" style={vars} aria-label="Store preview">
      {/* Header */}
      <div
        className={cn("border-b px-4", th.header === "minimal" ? "py-2" : "py-3")}
        style={{ borderColor: "var(--pv-border)", ...(th.header === "bold" ? { background: "var(--pv-primary)", color: "var(--pv-on-primary)", borderColor: "transparent" } : {}) }}
      >
        {th.header === "centered" ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <SearchIcon className="size-3.5 opacity-70" />
              {logo}
              {icons}
            </div>
            <div className="flex justify-center">{nav}</div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {th.header === "minimal" && <MenuIcon className="size-4" />}
            {logo}
            {th.header !== "minimal" && <span className="ms-2 hidden sm:block">{nav}</span>}
            <span className="ms-auto">{icons}</span>
          </div>
        )}
      </div>

      <div className={cn("grid pb-5", gap)}>
        {/* Hero */}
        {th.hero === "split" ? (
          <div className="grid grid-cols-2 items-center gap-4 px-4 py-5" style={{ background: "var(--pv-tint)" }}>
            <div>
              <p className={cn("leading-tight font-semibold", th.headings === "uppercase" ? "text-sm tracking-widest uppercase" : "text-lg")} style={heading}>
                {copy.heroHeading}
              </p>
              <span className="mt-3 inline-block px-3 py-1.5 text-[11px] font-semibold" style={btn}>
                {copy.cta}
              </span>
            </div>
            <div className="aspect-[4/3]" style={{ borderRadius: card, ...motifBackground(th.motif, primary) }} />
          </div>
        ) : (
          <div
            className={cn("flex px-4 text-white", th.hero === "full" ? "h-44 flex-col items-center justify-center text-center" : th.hero === "compact" ? "h-20 items-center" : "h-32 items-center")}
            style={motifBackground(th.motif, primary)}
          >
            <div>
              <p className={cn("leading-tight font-semibold", th.hero === "compact" ? "text-sm" : th.headings === "uppercase" ? "text-sm tracking-widest uppercase" : "text-xl")} style={heading}>
                {copy.heroHeading}
              </p>
              {th.hero !== "compact" && (
                <span className="mt-3 inline-block bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-900" style={{ borderRadius: BTN[th.buttons] }}>
                  {copy.cta}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Section with products */}
        <div
          className={cn("mx-4", th.sections === "boxed" && "border p-3", th.sections === "tinted" && "-mx-0 px-4 py-3")}
          style={{
            ...(th.sections === "boxed" ? { borderColor: "var(--pv-border)", borderRadius: card } : {}),
            ...(th.sections === "tinted" ? { background: "var(--pv-tint)" } : {}),
          }}
        >
          <p
            className={cn("mb-3 font-semibold", th.headings === "uppercase" ? "text-[11px] tracking-[0.18em] uppercase" : "text-base")}
            style={th.headings === "uppercase" ? { fontFamily: `"${draft.fontHeading}", sans-serif` } : heading}
          >
            {copy.newItems}
          </p>
          {th.headings === "underline" && <span className="-mt-2 mb-3 block h-[3px] w-8 rounded-full" style={{ background: "var(--pv-primary)" }} />}
          <div className={cn("grid grid-cols-3", th.density === "compact" ? "gap-2" : "gap-3")}>
            {[0, 1, 2].map((i) => (
              <MiniCard key={i} i={i} theme={th} primary={primary} radius={card} btn={btn} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const SHADES = [0.35, 0.55, 0.75];

function MiniCard({ i, theme: th, primary, radius, btn }: { i: number; theme: StoreTheme; primary: string; radius: string; btn: React.CSSProperties }) {
  const img: React.CSSProperties = {
    aspectRatio: RATIO[th.imageRatio],
    background: `linear-gradient(160deg, color-mix(in oklch, ${primary} ${Math.round(SHADES[i]! * 40)}%, #e7e5e4), color-mix(in oklch, ${primary} ${Math.round(SHADES[i]! * 70)}%, #d6d3d1))`,
    borderRadius: th.card === "minimal" ? "4px" : radius,
  };
  const price = <span className="text-[11px] font-semibold">₹{(i + 2) * 249}</span>;
  if (th.card === "overlay") {
    return (
      <div className="relative overflow-hidden" style={img}>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 text-white">
          <p className="truncate text-[11px]">Item {i + 1}</p>
          {price}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("grid gap-1.5", th.card === "framed" && "border p-1.5")} style={th.card === "framed" ? { borderColor: "var(--pv-border)", borderRadius: radius } : undefined}>
      <div className="relative" style={img}>
        <HeartIcon className="absolute top-1.5 right-1.5 size-3 text-white/90" />
      </div>
      <p className="truncate text-[11px]" style={{ color: "var(--pv-fg)" }}>
        Item {i + 1}
      </p>
      {price}
      {th.card === "framed" && (
        <span className="mt-0.5 block py-1 text-center text-[10px] font-semibold" style={btn}>
          Add
        </span>
      )}
    </div>
  );
}
