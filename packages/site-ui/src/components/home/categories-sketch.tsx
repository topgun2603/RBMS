import * as React from "react";
import { ArrowRightIcon, TagIcon } from "lucide-react";
import { cn } from "@srirealtime/ui";
import { absoluteUrl } from "@srirealtime/web";
import type { ResolvedHomeSection } from "../../lib/types";

/*
 * Rough editor-preview drawing of the categories section in each layout (home-preview.tsx). Not the storefront: just
 * enough shape for the owner to see what a layout does. Categories without a photo get a brand-tint tile with an icon,
 * the tint rotating like the storefront's.
 */

type Section = Extract<ResolvedHomeSection, { type: "categories" }>;
type Cat = Section["categories"][number];

const TINTS = ["bg-primary/15 text-primary", "bg-primary/25 text-primary", "bg-primary/10 text-primary", "bg-primary/20 text-primary"];

function Art({ c, i, className, bold }: { c: Cat; i: number; className?: string; bold?: boolean }) {
  const url = absoluteUrl(c.image ?? null);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- preview
    return <img src={url} alt="" className={cn("object-cover", className)} />;
  }
  return (
    <span className={cn("flex items-center justify-center", bold ? "bg-primary text-primary-foreground" : TINTS[i % TINTS.length], className)} style={bold ? { opacity: 1 - (i % 4) * 0.12 } : undefined}>
      <TagIcon className="size-[38%] max-h-6 max-w-6 opacity-80" />
    </span>
  );
}

export function CategoriesSketch({ s }: { s: Section }) {
  const layout = s.layout ?? "circles";
  const cats = s.categories;
  const start = s.style?.align === "start";
  const row = cn("flex gap-3 overflow-hidden px-4", !start && "justify-center");
  switch (layout) {
    case "circles":
    case "rounded-squares":
    case "story-rings":
      return (
        <div className={row} data-sketch={layout}>
          {cats.map((c, i) => (
            <div key={c.id} className="grid w-16 shrink-0 justify-items-center gap-1.5 text-center @lg:w-20">
              <span className={cn("block size-14 @lg:size-16", layout === "story-rings" && "rounded-full bg-gradient-to-tr from-primary to-primary/40 p-[2px]")}>
                <Art c={c} i={i} className={cn("size-full", layout === "rounded-squares" ? "rounded-2xl" : "rounded-full", layout === "story-rings" ? "ring-2 ring-background" : "ring-1 ring-border")} />
              </span>
              <span className="line-clamp-2 text-xs">{c.name}</span>
            </div>
          ))}
        </div>
      );
    case "pills":
    case "icon-list":
      return (
        <div className={cn("flex gap-2 px-4", layout === "pills" ? "overflow-hidden" : "flex-wrap", !start && "justify-center")} data-sketch={layout}>
          {cats.map((c, i) => (
            <span key={c.id} className="inline-flex shrink-0 items-center gap-2 rounded-full border bg-card py-1 ps-1 pe-3 text-xs font-medium">
              <Art c={c} i={i} className={cn("rounded-full", layout === "pills" ? "size-6" : "size-7")} />
              {c.name}
            </span>
          ))}
        </div>
      );
    case "bento":
      return (
        <div className="grid auto-rows-[70px] grid-cols-2 gap-2 px-4 @lg:auto-rows-[90px] @lg:grid-cols-4" data-sketch={layout}>
          {cats.map((c, i) => (
            <div key={c.id} className={cn("relative overflow-hidden rounded-lg", i === 0 && cats.length > 2 && "col-span-2 row-span-2")}>
              <Art c={c} i={i} bold className="absolute inset-0 size-full" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              <span className="absolute bottom-2 left-2 text-xs font-semibold text-white">{c.name}</span>
            </div>
          ))}
        </div>
      );
    case "minimal-list":
      return (
        <div className="mx-auto grid w-full max-w-xl border-t px-4" data-sketch={layout}>
          {cats.map((c, i) => (
            <div key={c.id} className="flex items-center gap-3 border-b py-2.5">
              <span className="w-5 text-[10px] text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1 truncate font-heading text-sm font-semibold">{c.name}</span>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" />
            </div>
          ))}
        </div>
      );
    case "slider":
      return (
        <div className={cn("flex gap-3 overflow-hidden px-4", !start && cats.length <= 4 && "@lg:justify-center")} data-sketch={layout}>
          {cats.map((c, i) => (
            <div key={c.id} className="relative w-[46%] shrink-0 overflow-hidden rounded-xl @lg:w-[23%]">
              <Art c={c} i={i} bold className="aspect-[3/4] w-full" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-6 pb-2 text-sm font-semibold text-white">{c.name}</span>
            </div>
          ))}
        </div>
      );
    default: {
      // cards · tiles · big-grid · banner-row: a wrapping row, the short last row centred.
      const per = layout === "cards" ? "w-[calc(50%-0.375rem)] @lg:w-[calc(25%-0.6rem)]" : layout === "tiles" ? "w-[calc(50%-0.375rem)] @lg:w-[calc(33.33%-0.5rem)]" : "w-full @lg:w-[calc(33.33%-0.5rem)]";
      return (
        <div className={cn("flex flex-wrap gap-3 px-4", !start && "justify-center")} data-sketch={layout}>
          {cats.map((c, i) => (
            <div key={c.id} className={per}>
              {layout === "banner-row" ? (
                <div className="flex items-center gap-2.5 rounded-xl border bg-card p-1.5">
                  <Art c={c} i={i} className="size-12 shrink-0 rounded-lg" />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate text-sm font-semibold">{c.name}</span>
                    <span className="text-[10px] font-semibold text-primary">→</span>
                  </span>
                </div>
              ) : layout === "cards" ? (
                <div className="overflow-hidden rounded-xl border bg-card">
                  <Art c={c} i={i} className="aspect-square w-full" />
                  <span className="block truncate px-2 py-1.5 text-center text-xs font-semibold">{c.name}</span>
                </div>
              ) : (
                <div className="relative overflow-hidden rounded-xl">
                  <Art c={c} i={i} bold className={cn("w-full", layout === "tiles" ? "aspect-square" : "aspect-[4/3]")} />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-6 pb-2 text-sm font-semibold text-white">{c.name}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }
  }
}
