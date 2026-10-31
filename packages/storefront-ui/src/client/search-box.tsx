"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon, SearchIcon, TagIcon, XIcon } from "lucide-react";
import { cn } from "@rbms/ui/lib/utils";
import { AnimatePresence, motion } from "@rbms/ui/motion";
import { STORE_PATHS } from "@rbms/cms/seo";
import { money } from "../lib/format";
import type { Suggestions } from "../types";
import { StoreImage } from "../components/bits";
import { call } from "./api";
import { track } from "./analytics";
import { useStore } from "./store-context";

/** Search-as-you-type: suggestions from /catalog/public/search/suggest; Enter goes to /search?q=. */
export function SearchBox({
  className,
  initial = "",
  autoFocus,
  onNavigate,
  expandable,
}: {
  className?: string;
  initial?: string;
  autoFocus?: boolean;
  onNavigate?: () => void;
  /** Header: rests compact and widens while focused. */
  expandable?: boolean;
}) {
  const { t } = useStore();
  const router = useRouter();
  const id = React.useId();
  const [q, setQ] = React.useState(initial);
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<Suggestions | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const wrap = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setQ(initial), [initial]);

  React.useEffect(() => {
    const term = q.trim();
    if (!open) return;
    if (term.length < 2) {
      setData(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      call<Suggestions>("/catalog/public/search/suggest", { query: { q: term }, signal: ctrl.signal, auth: false })
        .then((d) => {
          setData(d);
          setActive(-1);
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, open]);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const items = React.useMemo(
    () => [
      ...(data?.products ?? []).map((p) => ({ kind: "product" as const, href: STORE_PATHS.product(p.slug), p })),
      ...(data?.categories ?? []).map((c) => ({ kind: "category" as const, href: STORE_PATHS.category(c.slug), c })),
    ],
    [data],
  );

  const go = (href: string) => {
    setOpen(false);
    onNavigate?.();
    router.push(href);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const pick = active >= 0 ? items[active] : undefined;
    if (pick) return go(pick.href);
    const term = q.trim();
    if (!term) return;
    track({ type: "search", query: term });
    go(`${STORE_PATHS.search}?q=${encodeURIComponent(term)}`);
  };

  const showPanel = open && q.trim().length >= 2 && (items.length > 0 || (!loading && data !== null));

  return (
    <div
      ref={wrap}
      className={cn("relative", expandable && "max-w-xs transition-[max-width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus-within:max-w-lg motion-reduce:transition-none xl:max-w-sm", className)}
    >
      <form role="search" onSubmit={submit} className="relative">
        <label htmlFor={`${id}-q`} className="sr-only">
          {t("search.label")}
        </label>
        <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={`${id}-q`}
          type="search"
          value={q}
          autoFocus={autoFocus}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={t("search.placeholder")}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === "Escape") setOpen(false);
          }}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={`${id}-list`}
          aria-activedescendant={active >= 0 ? `${id}-o${active}` : undefined}
          className="h-11 w-full rounded-full border border-input bg-muted/40 ps-10 pe-10 text-sm outline-none transition-[background-color,box-shadow,border-color] placeholder:text-muted-foreground hover:bg-muted/70 focus:border-ring focus:bg-card focus:shadow-[var(--elevation-1)] focus:ring-[3px] focus:ring-ring/25 [&::-webkit-search-cancel-button]:hidden"
        />
        {loading ? (
          <Loader2Icon aria-hidden className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : q ? (
          <button type="button" onClick={() => setQ("")} className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label={t("common.close")}>
            <XIcon className="size-4" />
          </button>
        ) : null}
      </form>
      <AnimatePresence>
        {showPanel && (
          <motion.div
            id={`${id}-list`}
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="sf-pop absolute inset-x-0 top-full z-50 mt-2 origin-top overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-[var(--elevation-2)]"
          >
            {items.length === 0 && <p className="px-4 py-4 text-sm text-muted-foreground">{t("search.noSuggestions")}</p>}
            {data?.products.length ? <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("search.products")}</p> : null}
            {items.map((it, i) =>
              it.kind === "product" ? (
                <motion.div key={it.href} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0, transition: { delay: i * 0.03 } }}>
                  <Link
                    id={`${id}-o${i}`}
                    role="option"
                    aria-selected={active === i}
                    href={it.href}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      setOpen(false);
                      onNavigate?.();
                    }}
                    className="relative flex items-center gap-3 px-4 py-2"
                  >
                    {active === i && <motion.span layoutId={`${id}-hl`} className="absolute inset-x-1.5 inset-y-0.5 rounded-xl bg-accent" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                    <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-muted">
                      <StoreImage src={it.p.image} alt="" name={it.p.name} />
                    </span>
                    <span className="relative min-w-0 flex-1 truncate text-sm">{it.p.name}</span>
                    <span className="sf-price relative text-sm font-semibold">{money(it.p.priceMin)}</span>
                  </Link>
                </motion.div>
              ) : (
                <React.Fragment key={it.href}>
                  {i === (data?.products.length ?? 0) && <p className="border-t px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("search.categories")}</p>}
                  <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0, transition: { delay: i * 0.03 } }}>
                    <Link
                      id={`${id}-o${i}`}
                      role="option"
                      aria-selected={active === i}
                      href={it.href}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => {
                        setOpen(false);
                        onNavigate?.();
                      }}
                      className="relative flex items-center gap-3 px-4 py-2 text-sm"
                    >
                      {active === i && <motion.span layoutId={`${id}-hl`} className="absolute inset-x-1.5 inset-y-0.5 rounded-xl bg-accent" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                      <TagIcon className="relative size-4 text-muted-foreground" />
                      <span className="relative">{it.c.name}</span>
                    </Link>
                  </motion.div>
                </React.Fragment>
              ),
            )}
            <button type="submit" onClick={submit} className="flex w-full items-center gap-2 border-t px-4 py-3 text-left text-sm font-medium text-primary hover:bg-accent">
              <SearchIcon className="size-4" />
              {t("search.seeAll", { q: q.trim() })}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
