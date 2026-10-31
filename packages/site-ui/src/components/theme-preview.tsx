"use client";

import * as React from "react";
import { ChevronDownIcon, EyeIcon, HeartIcon, MenuIcon, SearchIcon, ShieldCheckIcon, ShoppingBagIcon, StarIcon, TruckIcon, UserRoundIcon, XIcon } from "lucide-react";
import { cn } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import type { StoreTheme } from "@rbms/branding/theme";
import type { Copy } from "@rbms/verticals";
import { readableOn, type AppearanceDraft } from "../lib/appearance";

const RATIO: Record<StoreTheme["imageRatio"], string> = { portrait: "4 / 5", square: "1 / 1", landscape: "4 / 3" };
const BTN: Record<StoreTheme["buttons"], string> = { rounded: "0.5rem", pill: "9999px", square: "2px" };

/** Which page the preview draws. */
export type PreviewView = "home" | "product" | "listing";

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
    case "stripes":
      return { backgroundImage: `repeating-linear-gradient(-45deg, rgb(0 0 0 / 0.16) 0 8px, transparent 8px 16px), ${base}` };
    case "scallop":
      // Sweet-box lace: scalloped top and bottom edges (the store draws them in the shop's accent colour).
      return {
        backgroundImage: `radial-gradient(circle at 50% 0, rgb(253 227 173 / 0.85) 5px, transparent 5.5px), radial-gradient(circle at 50% 100%, rgb(253 227 173 / 0.85) 5px, transparent 5.5px), radial-gradient(circle, rgb(253 227 173 / 0.25) 1px, transparent 1.2px), ${base}`,
        backgroundSize: "14px 7px, 14px 7px, 10px 10px, auto",
        backgroundPosition: "0 0, 0 100%, 0 0, 0 0",
        backgroundRepeat: "repeat-x, repeat-x, repeat, no-repeat",
      };
    default:
      return { backgroundImage: base };
  }
}

/** A grey text line (links and copy in the footer / product sketch). */
function Line({ w, className }: { w: string; className?: string }) {
  return <span className={cn("block h-1.5 rounded-full", className)} style={{ width: w, background: "var(--pv-line)" }} />;
}

/**
 * A miniature store built from the draft, each choice in the editor drawn in its variant, colours and fonts. Home:
 * offer ribbon, header (layout, look, shop menu), banner, a section of product cards (look, hover, buttons, badges)
 * and the footer. Product page: the gallery layout, buy box, trust badges, details (accordion / tabs / open), similar
 * products and the phone buy bar. Not the real storefront, but every choice is visible here.
 */
export function ThemePreview({ draft, copy, shopName, view = "home" }: { draft: AppearanceDraft; copy: Copy; shopName: string; view?: PreviewView }) {
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
    "--pv-card": `color-mix(in oklch, ${fg} ${dark ? 6 : 2}%, ${bg})`,
    "--pv-line": `color-mix(in oklch, ${fg} 22%, ${bg})`,
    fontFamily: `"${draft.fontSans}", ui-sans-serif, system-ui, sans-serif`,
    background: "var(--pv-bg)",
    color: "var(--pv-fg)",
  } as React.CSSProperties;
  const heading: React.CSSProperties = { fontFamily: `"${draft.fontHeading}", ui-serif, serif` };
  const btn: React.CSSProperties = { borderRadius: BTN[th.buttons], background: "var(--pv-primary)", color: "var(--pv-on-primary)" };
  const gap = th.density === "compact" ? "gap-4" : "gap-6";
  // The clear header only sits over a full-width banner on the home page.
  const overHero = view === "home" && th.headerStyle === "transparent" && th.hero !== "split";

  const hero =
    th.hero === "split" ? (
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
        className={cn("flex px-4 text-white", th.hero === "full" ? "h-44 flex-col items-center justify-center text-center" : th.hero === "compact" ? "h-20 items-center" : "h-32 items-center", overHero && "pt-10", overHero && th.hero !== "full" && "h-40")}
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
    );

  return (
    <div className="overflow-hidden rounded-xl border shadow-sm" style={vars} aria-label="Store preview" data-view={view}>
      <Ribbon theme={th} primary={primary} text={copy.cta} />
      {overHero ? (
        <div className="relative">
          <div className="absolute inset-x-0 top-0 z-[1]">
            <PreviewHeader theme={th} shopName={shopName} heading={heading} copy={copy} clear />
          </div>
          {hero}
        </div>
      ) : (
        <PreviewHeader theme={th} shopName={shopName} heading={heading} copy={copy} />
      )}

      {view === "product" ? (
        <ProductSketch theme={th} primary={primary} radius={card} btn={btn} heading={heading} copy={copy} />
      ) : view === "listing" ? (
        <ListingSketch theme={th} primary={primary} radius={card} btn={btn} heading={heading} copy={copy} />
      ) : (
        <div className={cn("grid pb-5", gap)}>
          {!overHero && hero}
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
                <MiniCard key={i} i={i} theme={th} primary={primary} radius={card} btn={btn} heading={heading} />
              ))}
            </div>
          </div>
        </div>
      )}
      <PreviewFooter theme={th} shopName={shopName} heading={heading} primary={primary} btn={btn} radius={card} />
    </div>
  );
}

/** Offer ribbon: rotating with a close button · always shown · a scrolling line (messages run on past the edge). */
function Ribbon({ theme: th, primary, text }: { theme: StoreTheme; primary: string; text: string }) {
  return (
    <div className="relative flex h-5 items-center overflow-hidden px-3 text-[9px] font-medium text-white" style={{ background: `linear-gradient(120deg, color-mix(in oklch, ${primary} 82%, black), ${primary})` }}>
      {th.announcement === "ticker" ? (
        <span className="flex gap-4 whitespace-nowrap opacity-90">
          {[0, 1, 2, 3].map((i) => (
            <span key={i}>• {text}</span>
          ))}
        </span>
      ) : (
        <span className="mx-auto truncate opacity-90">{text}</span>
      )}
      {th.announcement === "dismissible" && <XIcon className="absolute end-2 size-2.5 opacity-80" />}
    </div>
  );
}

function PreviewHeader({ theme: th, shopName, heading, copy, clear }: { theme: StoreTheme; shopName: string; heading: React.CSSProperties; copy: Copy; clear?: boolean }) {
  const { t } = useI18n();
  const bold = th.header === "bold" && !clear;
  const surface: React.CSSProperties = clear
    ? { color: "#fff", borderColor: "transparent", background: "linear-gradient(to bottom, rgb(0 0 0 / 0.35), transparent)" }
    : bold
      ? { background: "var(--pv-primary)", color: "var(--pv-on-primary)", borderColor: "transparent" }
      : th.headerStyle === "glass"
        ? { borderColor: "var(--pv-border)", background: "color-mix(in oklch, var(--pv-bg) 78%, transparent)", backdropFilter: "blur(6px)" }
        : { borderColor: "var(--pv-border)", background: "var(--pv-bg)" };
  const nav = (
    <span className="flex items-center gap-3 text-[11px] opacity-75">
      {th.megaMenu !== "off" && (
        <span className="flex items-center gap-0.5">
          {t("site.appearance.pv.shop")} <ChevronDownIcon className="size-2.5" />
        </span>
      )}
      <span>{copy.newItems}</span>
      <span>{t("site.appearance.pv.offers")}</span>
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
    <span className="truncate text-sm font-bold" style={heading}>
      {shopName}
    </span>
  );
  return (
    <div className={cn("border-b px-4", th.header === "minimal" ? "py-2" : "py-3")} style={surface} data-header={th.header} data-header-style={clear ? "clear" : th.headerStyle}>
      {th.header === "centered" ? (
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <SearchIcon className="size-3.5 opacity-70" />
            {logo}
            {icons}
          </div>
          <div className="flex justify-center">{nav}</div>
        </div>
      ) : th.header === "split" ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className="hidden sm:block">{nav}</span>
          <MenuIcon className="size-4 sm:hidden" />
          {logo}
          <span className="justify-self-end">{icons}</span>
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
  );
}

function PreviewFooter({ theme: th, shopName, heading, primary, btn, radius }: { theme: StoreTheme; shopName: string; heading: React.CSSProperties; primary: string; btn: React.CSSProperties; radius: string }) {
  const { t } = useI18n();
  const name = (
    <span className="text-xs font-bold" style={heading}>
      {shopName}
    </span>
  );
  const socials = (
    <span className="flex gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-3 rounded-full border" style={{ borderColor: "var(--pv-border)" }} />
      ))}
    </span>
  );
  const columns = (
    <div className="grid grid-cols-3 gap-3 px-4 py-3">
      <div className="grid content-start gap-1.5">
        {name}
        {socials}
      </div>
      {[0, 1].map((c) => (
        <div key={c} className="grid content-start gap-1.5">
          <Line w="55%" />
          <Line w="70%" />
          <Line w="45%" />
        </div>
      ))}
    </div>
  );
  return (
    <div className="border-t" style={{ borderColor: "var(--pv-border)", background: th.footer === "minimal" ? undefined : "var(--pv-tint)" }} data-footer={th.footer}>
      {th.footer === "minimal" ? (
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Line w="30%" />
          <Line w="15%" />
          <span className="ms-auto">{socials}</span>
        </div>
      ) : th.footer === "centered" ? (
        <div className="grid justify-items-center gap-2 px-4 py-4">
          {name}
          <span className="flex gap-2">
            <Line w="2.5rem" />
            <Line w="2rem" />
            <Line w="3rem" />
            <Line w="2rem" />
          </span>
          {socials}
        </div>
      ) : th.footer === "newsletter" ? (
        <>
          <div className="flex items-center justify-between gap-3 px-4 py-4 text-white" style={motifBackground(th.motif, primary)}>
            <span className="text-xs font-semibold" style={heading}>
              {t("site.appearance.pv.newsletter")}
            </span>
            <span className="flex gap-1">
              <span className="h-4 w-16 rounded-full bg-white/90" />
              <span className="h-4 w-8 rounded-full bg-white/30" />
            </span>
          </div>
          {columns}
        </>
      ) : (
        <>
          <div className="mx-4 mt-3 flex items-center justify-between border px-3 py-2" style={{ borderColor: "var(--pv-border)", borderRadius: radius, background: "var(--pv-card)" }}>
            <Line w="35%" />
            <span className="h-3.5 w-10" style={btn} />
          </div>
          {columns}
        </>
      )}
    </div>
  );
}

const SHADES = [0.35, 0.55, 0.75];

function imageStyle(th: StoreTheme, primary: string, i: number, radius: string): React.CSSProperties {
  return {
    aspectRatio: RATIO[th.imageRatio],
    background: `linear-gradient(160deg, color-mix(in oklch, ${primary} ${Math.round(SHADES[i % 3]! * 40)}%, #e7e5e4), color-mix(in oklch, ${primary} ${Math.round(SHADES[i % 3]! * 70)}%, #d6d3d1))`,
    borderRadius: th.card === "minimal" || th.card === "editorial" ? "4px" : th.card === "boxed" ? "0" : radius,
  };
}

/** One product card; the middle one is drawn as if hovered (its hover effect and hover buttons). */
function MiniCard({ i, theme: th, primary, radius, btn, heading }: { i: number; theme: StoreTheme; primary: string; radius: string; btn: React.CSSProperties; heading: React.CSSProperties }) {
  const { t } = useI18n();
  const hovered = i === 1;
  const img = imageStyle(th, primary, i, radius);
  const fx = hovered ? th.cardHover : "none";
  const lift = fx === "rich" || fx === "lift";
  const swapped = fx === "rich" || fx === "swap";
  const zoom = fx === "rich" || fx === "zoom";
  const price = <span className="text-[11px] font-semibold">₹{(i + 2) * 249}</span>;
  const badge = i === 0 ? "-20%" : i === 2 ? t("site.appearance.pv.new") : null;
  const below = th.cardButton === "always" || (th.cardButton === "hover" && th.card === "framed");
  const photo = (
    <div className="relative overflow-hidden" style={img}>
      <div
        className="absolute inset-0"
        style={{
          ...(swapped ? { background: `linear-gradient(200deg, color-mix(in oklch, ${primary} 25%, #f5f5f4), color-mix(in oklch, ${primary} 60%, #a8a29e))` } : {}),
          transform: zoom ? "scale(1.08)" : undefined,
        }}
      />
      {badge && (
        <span className={cn("absolute start-0 top-1.5 rounded-e-full px-1.5 py-px text-[8px] font-bold", i === 0 ? "bg-red-600 text-white" : "bg-neutral-900 text-white")}>{badge}</span>
      )}
      <HeartIcon className="absolute end-1.5 top-1.5 size-3 text-white/90" />
      {hovered && th.cardButton !== "none" && <EyeIcon className="absolute end-1.5 top-6 size-3 text-white/90" />}
      {hovered && th.cardButton === "hover" && th.card !== "framed" && (
        <span className="absolute inset-x-1.5 bottom-1.5 rounded-full bg-white/95 py-0.5 text-center text-[8px] font-semibold text-neutral-900">{t("site.appearance.pv.add")}</span>
      )}
      {th.card === "overlay" && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 text-white">
          <p className="truncate text-[11px]">{t("site.appearance.pv.item", { n: i + 1 })}</p>
          {price}
        </div>
      )}
    </div>
  );
  const addBelow = below && (
    <span className={cn("mt-0.5 block py-1 text-center text-[10px] font-semibold", th.card === "boxed" && "mx-1.5 mb-1.5")} style={btn}>
      {t("site.appearance.pv.add")}
    </span>
  );
  const shadow = lift ? { transform: "translateY(-3px)", boxShadow: `0 8px 18px -10px color-mix(in oklch, ${primary} 60%, black)` } : {};
  if (th.card === "overlay") {
    return (
      <div className="grid gap-1.5" style={{ ...shadow, borderRadius: radius }}>
        {photo}
        {addBelow}
      </div>
    );
  }
  const boxed = th.card === "boxed";
  const editorial = th.card === "editorial";
  const framed = th.card === "framed";
  return (
    <div
      className={cn("grid content-start", boxed ? "gap-0 overflow-hidden border" : "gap-1.5", framed && "border p-1.5")}
      style={{
        ...(framed || boxed ? { borderColor: "var(--pv-border)", borderRadius: radius } : {}),
        ...(boxed ? { background: "var(--pv-card)" } : {}),
        ...shadow,
      }}
      data-card={th.card}
    >
      {photo}
      <div className={cn("grid gap-0.5", boxed && "p-1.5", editorial && "justify-items-center text-center")}>
        <p className={cn("truncate", editorial ? "text-xs font-medium" : "text-[11px]")} style={{ color: "var(--pv-fg)", ...(editorial ? heading : {}) }}>
          {t("site.appearance.pv.item", { n: i + 1 })}
        </p>
        {price}
      </div>
      {addBelow}
    </div>
  );
}

/** Product page sketch: gallery in the chosen layout, buy box, trust badges, details, similar products, phone buy bar. */
function ProductSketch({ theme: th, primary, radius, btn, heading, copy }: { theme: StoreTheme; primary: string; radius: string; btn: React.CSSProperties; heading: React.CSSProperties; copy: Copy }) {
  const { t } = useI18n();
  const ph = (i: number, extra?: React.CSSProperties) => <div style={{ ...imageStyle({ ...th, card: "standard" }, primary, i, radius), ...extra }} />;
  const thumbs = (dir: "col" | "row") => (
    <div className={cn("flex gap-1", dir === "col" ? "w-7 flex-col" : "flex-row")}>
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn(dir === "row" && "w-7", i === 0 && "ring-2")} style={{ ...imageStyle({ ...th, card: "minimal" }, primary, i + 1, radius), ["--tw-ring-color" as string]: primary }} />
      ))}
    </div>
  );
  const gallery =
    th.productLayout === "grid" ? (
      <div className="grid grid-cols-2 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <React.Fragment key={i}>{ph(i)}</React.Fragment>
        ))}
      </div>
    ) : th.productLayout === "slider" ? (
      <div className="flex gap-1 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-[42%] shrink-0">
            {ph(i)}
          </div>
        ))}
      </div>
    ) : th.productLayout === "thumbs-below" ? (
      <div className="grid gap-1">
        {ph(0)}
        {thumbs("row")}
      </div>
    ) : (
      <div className="flex gap-1">
        {thumbs("col")}
        <div className="flex-1">{ph(0)}</div>
      </div>
    );
  const titles = [t("site.appearance.pv.description"), t("site.appearance.pv.details"), t("site.appearance.pv.shipping")];
  const details =
    th.productDetails === "tabs" ? (
      <div className="border" style={{ borderColor: "var(--pv-border)", borderRadius: radius }}>
        <div className="flex gap-1 border-b p-1 text-[9px] font-semibold" style={{ borderColor: "var(--pv-border)" }}>
          {titles.map((x, i) => (
            <span key={x} className="rounded px-1.5 py-0.5" style={i === 0 ? { background: "var(--pv-tint)" } : { opacity: 0.6 }}>
              {x}
            </span>
          ))}
        </div>
        <div className="grid gap-1 p-2">
          <Line w="90%" />
          <Line w="70%" />
        </div>
      </div>
    ) : th.productDetails === "open" ? (
      <div className="grid gap-1.5">
        {titles.map((x) => (
          <div key={x} className="grid gap-1 border p-2" style={{ borderColor: "var(--pv-border)", borderRadius: radius }}>
            <span className="text-[9px] font-semibold">{x}</span>
            <Line w="80%" />
          </div>
        ))}
      </div>
    ) : (
      <div className="border px-2" style={{ borderColor: "var(--pv-border)", borderRadius: radius }}>
        {titles.map((x, i) => (
          <div key={x} className={cn("py-1.5", i > 0 && "border-t")} style={{ borderColor: "var(--pv-border)" }}>
            <span className="flex items-center justify-between text-[9px] font-semibold">
              {x} <ChevronDownIcon className={cn("size-2.5", i === 0 && "rotate-180")} />
            </span>
            {i === 0 && <Line w="85%" className="mt-1" />}
          </div>
        ))}
      </div>
    );
  const buy = (
    <div className="grid content-start gap-2">
      <p className="text-sm leading-tight font-semibold" style={heading}>
        {copy.newItems}
      </p>
      <span className="flex items-center gap-1 text-[10px] font-bold">
        ₹1,249
        <span className="flex text-amber-400">
          {[0, 1, 2, 3, 4].map((i) => (
            <StarIcon key={i} className="size-2 fill-current" />
          ))}
        </span>
      </span>
      <span className="block py-1.5 text-center text-[10px] font-semibold" style={btn}>
        {t("site.appearance.pv.addToCart")}
      </span>
      {th.productTrust === "on" && (
        <span className="flex gap-1">
          {[ShieldCheckIcon, TruckIcon].map((I, i) => (
            <span key={i} className="flex flex-1 items-center gap-1 rounded px-1 py-0.5" style={{ background: "var(--pv-tint)" }}>
              <I className="size-2.5" style={{ color: primary }} />
              <Line w="60%" />
            </span>
          ))}
        </span>
      )}
    </div>
  );
  return (
    <div className="grid gap-4 p-4" data-product-layout={th.productLayout}>
      {th.productLayout === "slider" ? (
        <>
          {gallery}
          <div className="grid grid-cols-2 gap-3">
            {buy}
            {details}
          </div>
        </>
      ) : (
        <div className={cn("grid gap-3", th.productLayout === "grid" ? "grid-cols-[1.35fr_1fr]" : "grid-cols-[1.1fr_1fr]")}>
          {gallery}
          <div className="grid content-start gap-2.5">
            {buy}
            {details}
          </div>
        </div>
      )}
      {th.related !== "off" && (
        <div className="grid gap-1.5">
          <span className="text-[10px] font-semibold" style={heading}>
            {t("site.appearance.pv.related")}
          </span>
          <div className={cn("gap-1.5", th.related === "grid" ? "grid grid-cols-4" : "flex overflow-hidden")}>
            {[0, 1, 2, 3, 4].slice(0, th.related === "grid" ? 4 : 5).map((i) => (
              <div key={i} className={th.related === "rail" ? "w-[22%] shrink-0" : undefined}>
                {ph(i)}
              </div>
            ))}
          </div>
        </div>
      )}
      {th.stickyBuy === "on" && (
        <div className="-mx-4 -mb-4 flex items-center gap-2 border-t px-4 py-1.5" style={{ borderColor: "var(--pv-border)", background: "var(--pv-card)" }}>
          <span className="text-[10px] font-bold">₹1,249</span>
          <span className="ms-auto px-3 py-1 text-[9px] font-semibold" style={btn}>
            {t("site.appearance.pv.addToCart")}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Category page: the header style, sub-category chips, where the filters sit (sidebar / top bar / a Filters button),
 * the desktop columns, grid or list rows (with the shopper's toggle), how more products load, and Compare on cards.
 */
function ListingSketch({ theme: th, primary, radius, btn, heading, copy }: { theme: StoreTheme; primary: string; radius: string; btn: React.CSSProperties; heading: React.CSSProperties; copy: Copy }) {
  const { t } = useI18n();
  const cols = Number(th.listingColumns) || 4;
  const list = th.listingView === "list";
  const sidebar = th.listingFilters === "sidebar";
  const tile = (i: number) =>
    list ? (
      <div key={i} className="flex gap-2 border p-1.5" style={{ borderColor: "var(--pv-border)", borderRadius: radius, background: "var(--pv-card)" }}>
        <span className="aspect-square w-10 shrink-0" style={{ borderRadius: `calc(${radius} - 0.3rem)`, background: `color-mix(in oklch, ${primary} ${10 + (i % 3) * 6}%, var(--pv-bg))` }} />
        <span className="grid flex-1 content-center gap-1">
          <Line w="70%" />
          <Line w="35%" className="opacity-70" />
          {th.compare === "on" && <CompareChip />}
        </span>
      </div>
    ) : (
      <div key={i} className="grid gap-1">
        <span className="aspect-[4/5] w-full" style={{ borderRadius: radius, background: `color-mix(in oklch, ${primary} ${10 + (i % 3) * 6}%, var(--pv-bg))` }} />
        <Line w="80%" />
        <Line w="40%" className="opacity-70" />
        {th.compare === "on" && <CompareChip />}
      </div>
    );
  const chip = (label: string, on?: boolean) => (
    <span className="rounded-full border px-2 py-0.5 text-[9px] font-semibold whitespace-nowrap" style={on ? { background: "var(--pv-primary)", color: "var(--pv-on-primary)", borderColor: "transparent" } : { borderColor: "var(--pv-border)" }}>
      {label}
    </span>
  );
  const header =
    th.categoryHeader === "none" ? null : th.categoryHeader === "banner" ? (
      <div className="flex h-16 items-end px-3 pb-2 text-white" style={{ borderRadius: radius, ...motifBackground(th.motif, primary) }}>
        <p className="text-sm font-semibold" style={heading}>
          {copy.categoriesTitle}
        </p>
      </div>
    ) : (
      <p className="text-base font-semibold" style={heading}>
        {copy.categoriesTitle}
      </p>
    );
  return (
    <div className="grid gap-3 px-4 py-4" data-listing={th.listingFilters}>
      {header}
      {th.subcategories === "chips" && <div className="flex gap-1">{[t("site.appearance.pv.all"), "A", "B", "C"].map((x, i) => chip(x, i === 0))}</div>}
      {th.listingFilters === "top-bar" && <div className="flex gap-1">{[t("site.appearance.pv.size"), t("site.appearance.pv.colour"), t("site.appearance.pv.price")].map((x) => chip(`${x} ▾`))}</div>}
      <div className={cn("grid gap-3", sidebar && "grid-cols-[4.5rem_1fr]")}>
        {sidebar && (
          <div className="grid content-start gap-1.5 border-e pe-2" style={{ borderColor: "var(--pv-border)" }}>
            {[60, 80, 50, 70, 40].map((w, i) => (
              <Line key={i} w={`${w}%`} />
            ))}
          </div>
        )}
        <div className="grid min-w-0 gap-2">
          <div className="flex items-center justify-between gap-2">
            <Line w="25%" />
            <span className="flex items-center gap-1">
              {th.listingFilters === "drawer" && chip(t("site.appearance.pv.filters"))}
              <span className="flex rounded-full border p-0.5" style={{ borderColor: "var(--pv-border)" }}>
                {["▦", "☰"].map((x, i) => (
                  <span key={x} className="flex size-4 items-center justify-center rounded-full text-[8px]" style={(i === 1) === list ? { background: "var(--pv-primary)", color: "var(--pv-on-primary)" } : undefined}>
                    {x}
                  </span>
                ))}
              </span>
            </span>
          </div>
          <div className={cn("grid gap-2")} style={{ gridTemplateColumns: list ? "1fr" : `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: list ? 3 : cols * 2 }, (_, i) => tile(i))}
          </div>
          <div className="flex justify-center pt-1">
            {th.listingPaging === "pages" ? (
              <span className="flex gap-1">{["1", "2", "3"].map((n, i) => chip(n, i === 0))}</span>
            ) : th.listingPaging === "load-more" ? (
              <span className="px-3 py-1 text-[10px] font-semibold" style={btn}>
                {t("site.appearance.pv.loadMore")}
              </span>
            ) : (
              <span className="text-[10px]" style={{ color: "var(--pv-muted)" }}>
                {t("site.appearance.pv.infinite")}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CompareChip() {
  return (
    <span className="mt-0.5 inline-flex items-center gap-1 text-[8px] font-semibold" style={{ color: "var(--pv-muted)" }}>
      <span className="size-2 rounded-[2px] border" style={{ borderColor: "currentColor" }} /> ⇄
    </span>
  );
}
