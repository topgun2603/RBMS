"use client";

import * as React from "react";
import { CheckCircle2Icon, Loader2Icon, MinusIcon, PlusIcon, SearchIcon, ShoppingBasketIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { money } from "../lib/format";
import { call, errorMessage } from "./api";
import { useT } from "./store-context";

export interface TableMenuItem {
  id: string;
  name: string;
  /** GST-exclusive paise. */
  rate: number;
  gstRate: number;
  categoryId: string | null;
  image: string | null;
  veg: boolean | null;
  available: boolean;
}

interface Line {
  qty: number;
  note: string;
}

interface Placed {
  orderNumber: number;
  tickets: number[];
}

/** Menu by category with +/- steppers, a sticky "your order" bar and a sheet to add notes and send. */
export function TableMenu({ token, items, categories }: { token: string; items: TableMenuItem[]; categories: { id: string | null; name: string | null }[] }) {
  const t = useT();
  const [lines, setLines] = React.useState<Record<string, Line>>({});
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [placed, setPlaced] = React.useState<Placed | null>(null);

  const byId = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const term = q.trim().toLowerCase();
  const visible = items.filter((i) => !term || i.name.toLowerCase().includes(term));
  const chosen = Object.entries(lines).filter(([, l]) => l.qty > 0);
  const count = chosen.reduce((s, [, l]) => s + l.qty, 0);
  const total = chosen.reduce((s, [id, l]) => s + l.qty * (byId.get(id)?.rate ?? 0), 0);
  const setQty = (id: string, qty: number) => setLines((m) => ({ ...m, [id]: { qty: Math.max(0, Math.min(50, qty)), note: m[id]?.note ?? "" } }));

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call<Placed>(`/dining/public/tables/${encodeURIComponent(token)}/orders`, {
        method: "POST",
        auth: false,
        body: { name: name.trim() || null, items: chosen.map(([itemId, l]) => ({ itemId, qty: l.qty, note: l.note.trim() || null })) },
      });
      setPlaced(r);
      setLines({});
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (placed) {
    return (
      <div className="grid place-items-center gap-4 rounded-2xl border bg-card px-6 py-12 text-center">
        <CheckCircle2Icon className="size-14 text-success" />
        <h2 className="font-display text-h2 font-semibold">{t("table.sentTitle")}</h2>
        <p className="max-w-sm text-muted-foreground">{t("table.sentBody", { number: placed.orderNumber })}</p>
        <button type="button" onClick={() => setPlaced(null)} className="mt-2 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground">
          {t("table.orderMore")}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="relative mb-6">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("table.search")}
          className="h-12 w-full rounded-full border bg-card pr-4 pl-11 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {visible.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">{t("table.empty")}</p>
      ) : (
        <div className="grid gap-8">
          {categories.map((c) => {
            const list = visible.filter((i) => i.categoryId === c.id);
            if (list.length === 0) return null;
            return (
              <section key={c.id ?? "other"} className="grid gap-3">
                <h2 className="font-display text-lg font-semibold">{c.name ?? t("table.other")}</h2>
                <ul className="grid gap-2">
                  {list.map((i) => {
                    const n = lines[i.id]?.qty ?? 0;
                    return (
                      <li key={i.id} className={cn("flex items-center gap-3 rounded-xl border bg-card p-3", !i.available && "opacity-60")}>
                        {i.image && <img src={i.image} alt="" className="size-16 shrink-0 rounded-lg object-cover" loading="lazy" />}
                        <div className="min-w-0 flex-1">
                          <p className="flex items-start gap-2 font-medium leading-snug">
                            {i.veg !== null && (
                              <span
                                role="img"
                                aria-label={i.veg ? t("table.veg") : t("table.nonVeg")}
                                className={cn("mt-1 inline-grid size-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px]", i.veg ? "border-success" : "border-destructive")}
                              >
                                <span className={cn("size-1.5 rounded-full", i.veg ? "bg-success" : "bg-destructive")} />
                              </span>
                            )}
                            {i.name}
                          </p>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            <span className="font-semibold text-foreground tabular-nums">{money(i.rate)}</span>
                            {i.gstRate > 0 && <span> {t("table.plusGst", { rate: i.gstRate })}</span>}
                          </p>
                        </div>
                        {!i.available ? (
                          <span className="text-sm font-medium text-muted-foreground">{t("table.soldOut")}</span>
                        ) : n === 0 ? (
                          <button
                            type="button"
                            onClick={() => setQty(i.id, 1)}
                            className="inline-flex h-10 items-center gap-1 rounded-full border border-primary px-4 text-sm font-semibold text-primary hover:bg-primary/10"
                          >
                            <PlusIcon className="size-4" /> {t("table.add")}
                          </button>
                        ) : (
                          <Stepper value={n} onChange={(v) => setQty(i.id, v)} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto grid max-w-3xl gap-3">
            {open && (
              <div className="grid max-h-[55vh] gap-3 overflow-auto rounded-xl border bg-card p-3">
                <h3 className="font-semibold">{t("table.yourOrder")}</h3>
                <ul className="grid gap-2">
                  {chosen.map(([id, l]) => (
                    <li key={id} className="grid gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{byId.get(id)?.name}</span>
                        <Stepper value={l.qty} onChange={(v) => setQty(id, v)} />
                      </div>
                      <input
                        value={l.note}
                        maxLength={200}
                        onChange={(e) => setLines((m) => ({ ...m, [id]: { qty: l.qty, note: e.target.value } }))}
                        placeholder={t("table.notePlaceholder")}
                        aria-label={t("table.note")}
                        className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </li>
                  ))}
                </ul>
                <input
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("table.name")}
                  className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )}
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <ShoppingBasketIcon className="size-5" />
                </span>
                <span className="grid">
                  <span className="text-sm font-semibold">{t("table.items", { count })}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{money(total)}</span>
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => (open ? send() : setOpen(true))}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy && <Loader2Icon className="size-4 animate-spin" />}
                {busy ? t("table.sending") : open ? t("table.send") : t("table.view")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex h-10 shrink-0 items-center rounded-full border border-primary">
      <button type="button" aria-label="−" onClick={() => onChange(value - 1)} className="grid h-full w-10 place-items-center text-primary">
        <MinusIcon className="size-4" />
      </button>
      <span className="w-6 text-center text-sm font-semibold tabular-nums">{value}</span>
      <button type="button" aria-label="+" onClick={() => onChange(value + 1)} className="grid h-full w-10 place-items-center text-primary">
        <PlusIcon className="size-4" />
      </button>
    </span>
  );
}
