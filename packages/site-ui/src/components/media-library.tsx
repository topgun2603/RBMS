"use client";

import * as React from "react";
import { CheckIcon, ImagesIcon, Loader2Icon, PaletteIcon, SearchIcon, VideoIcon } from "lucide-react";
import { STOCK_TRADES, type StockTrade } from "@srirealtime/branding/stock-art";
import { PACKS } from "@srirealtime/verticals";
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@srirealtime/ui";
import { absoluteUrl, useI18n } from "@srirealtime/web";
import { mediaThumb, stockItems, useDebounced, useMediaLibrary, useShopStock, type MediaFile, type MediaKind, type StockItem } from "../lib/media-library";

/** What the library hands back: the URL (or stock site path) to store, and a display name. */
export interface MediaPick {
  url: string;
  name: string;
}

/**
 * "Choose from library": the shop's earlier uploads (search by name, newest first, "Show more"), and for images a
 * Stock tab of artwork drawn for the trade in the shop's brand colours. Click selects, double-click (or "Use this")
 * picks and closes.
 */
export function MediaLibraryDialog({
  open,
  onOpenChange,
  kind = "image",
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: MediaKind;
  onPick: (pick: MediaPick) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<"uploads" | "stock">("uploads");
  const [selected, setSelected] = React.useState<MediaPick | null>(null);
  React.useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);
  const pick = (p: MediaPick) => {
    onPick(p);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-4 sm:max-w-4xl" data-media-library>
        <DialogHeader>
          <DialogTitle>{t("site.media.libraryTitle")}</DialogTitle>
          <DialogDescription>{t(kind === "image" ? "site.media.libraryDesc" : "site.media.videoLibraryDesc")}</DialogDescription>
        </DialogHeader>
        {kind === "image" ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "uploads" | "stock")} className="min-h-0 flex-1">
            <TabsList>
              <TabsTrigger value="uploads">
                <ImagesIcon /> {t("site.media.tabUploads")}
              </TabsTrigger>
              <TabsTrigger value="stock">
                <PaletteIcon /> {t("site.media.tabStock")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="uploads" className="min-h-0 overflow-y-auto">
              {tab === "uploads" && <UploadsGrid kind="image" selected={selected} onSelect={setSelected} onPick={pick} />}
            </TabsContent>
            <TabsContent value="stock" className="min-h-0 overflow-y-auto">
              {tab === "stock" && <StockGrid selected={selected} onSelect={setSelected} onPick={pick} />}
            </TabsContent>
          </Tabs>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <UploadsGrid kind={kind} selected={selected} onSelect={setSelected} onPick={pick} />
          </div>
        )}
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="truncate text-xs text-muted-foreground" aria-live="polite">
            {selected ? t("site.media.selected", { name: selected.name }) : ""}
          </p>
          <Button type="button" disabled={!selected} onClick={() => selected && pick(selected)} data-media-use>
            <CheckIcon /> {t("site.media.use")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tile({
  active,
  label,
  onSelect,
  onPick,
  className,
  children,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
  onPick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onSelect}
      onDoubleClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" && active) {
          e.preventDefault();
          onPick();
        }
      }}
      className={cn(
        "group relative block w-full overflow-hidden rounded-xl bg-muted text-left ring-1 ring-border outline-none transition hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring",
        active && "ring-2 ring-primary",
        className,
      )}
    >
      {children}
      {active && (
        <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
          <CheckIcon className="size-3.5" />
        </span>
      )}
    </button>
  );
}

function UploadsGrid({ kind, selected, onSelect, onPick }: { kind: MediaKind; selected: MediaPick | null; onSelect: (p: MediaPick) => void; onPick: (p: MediaPick) => void }) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const term = useDebounced(q);
  const list = useMediaLibrary(kind, term);
  const files: MediaFile[] = list.data?.pages.flatMap((p) => p.items) ?? [];
  const asPick = (f: MediaFile): MediaPick => ({ url: absoluteUrl(f.url), name: f.originalName });

  return (
    <div className="grid gap-3 pt-1">
      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("site.media.search")} aria-label={t("site.media.search")} className="pl-8" size="sm" maxLength={100} />
      </div>
      {list.isLoading ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <li key={i}>
              <Skeleton className="aspect-square w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : list.isError ? (
        <p className="py-10 text-center text-sm text-destructive">{t("site.media.loadFailed")}</p>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
          {kind === "video" ? <VideoIcon className="size-6" /> : <ImagesIcon className="size-6" />}
          {term.trim() ? t("site.media.emptySearch", { q: term.trim() }) : t(kind === "video" ? "site.media.emptyVideo" : "site.media.empty")}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5" data-media-uploads>
          {files.map((f) => {
            const p = asPick(f);
            return (
              <li key={f.id} className="grid gap-1">
                <Tile active={selected?.url === p.url} label={f.originalName} onSelect={() => onSelect(p)} onPick={() => onPick(p)} className="aspect-square">
                  {kind === "video" ? (
                    <video src={absoluteUrl(f.url)} muted preload="metadata" playsInline className="pointer-events-none size-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- UI modules don't use next/image
                    <img src={mediaThumb(f)} alt="" loading="lazy" className="pointer-events-none size-full object-cover" />
                  )}
                </Tile>
                <span className="truncate text-xs text-muted-foreground">{f.originalName}</span>
              </li>
            );
          })}
        </ul>
      )}
      {list.hasNextPage && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage && <Loader2Icon className="animate-spin" />} {t("site.media.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

const GROUP_SPAN: Record<StockItem["group"], string> = {
  hero: "col-span-2 aspect-[16/7]",
  banner: "col-span-2 aspect-[16/5]",
  split: "aspect-[4/5]",
  tile: "aspect-square",
};

function StockGrid({ selected, onSelect, onPick }: { selected: MediaPick | null; onSelect: (p: MediaPick) => void; onPick: (p: MediaPick) => void }) {
  const { t, locale } = useI18n();
  const shop = useShopStock();
  const [trade, setTrade] = React.useState<StockTrade | null>(null);
  const current = trade ?? shop.trade;
  const items = React.useMemo(() => stockItems(current, shop.colors), [current, shop.colors]);
  const tradeName = (id: StockTrade) => (locale === "ta" ? PACKS[id].nameTa : PACKS[id].name);
  const label = (it: StockItem, i: number) => `${tradeName(current)} · ${t(`site.media.slot.${it.group}`)} ${i + 1}`;

  return (
    <div className="grid gap-3 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="media-stock-trade" className="text-sm font-medium">
          {t("site.media.stockTrade")}
        </label>
        <select
          id="media-stock-trade"
          value={current}
          onChange={(e) => setTrade(e.target.value as StockTrade)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {STOCK_TRADES.map((id) => (
            <option key={id} value={id}>
              {tradeName(id)}
            </option>
          ))}
        </select>
        <p className="basis-full text-xs text-muted-foreground">{t("site.media.stockHint")}</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-media-stock>
        {items.map((it, i) => {
          const p: MediaPick = { url: it.path, name: label(it, i) };
          return (
            <li key={it.slot} className={GROUP_SPAN[it.group].split(" ")[0] === "col-span-2" ? "col-span-2" : undefined}>
              <Tile active={selected?.url === p.url} label={p.name} onSelect={() => onSelect(p)} onPick={() => onPick(p)} className={GROUP_SPAN[it.group].replace("col-span-2 ", "")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- generated SVG preview */}
                <img src={it.preview} alt="" className="pointer-events-none size-full object-cover" data-stock-slot={it.slot} />
              </Tile>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
