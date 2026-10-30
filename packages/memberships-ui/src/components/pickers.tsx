"use client";

import * as React from "react";
import { Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { Button, cn, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rbms/ui";
import { useDebounced, useI18n } from "@rbms/web";
import { money } from "../lib/format";
import { usePlans, useShopItems } from "../lib/queries";
import type { Plan, ShopItem } from "../lib/types";

/** Picks a billing item (catalogue variant) by name; once picked it shows with a change button. */
export function ItemPicker({
  value,
  onChange,
  id,
}: {
  value: Pick<ShopItem, "id" | "name"> | null;
  onChange: (v: ShopItem | null) => void;
  id?: string;
}) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const term = useDebounced(q, 250);
  const r = useShopItems(term, open && !value);
  const items = r.data?.items ?? [];
  const [active, setActive] = React.useState(0);
  React.useEffect(() => setActive(0), [items]);

  if (value) {
    return (
      <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <span className="min-w-0 truncate text-sm font-medium">{value.name}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
          <XIcon /> {t("memberships.common.change")}
        </Button>
      </div>
    );
  }

  const pick = (row: ShopItem) => {
    onChange(row);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        className="pl-9"
        value={q}
        placeholder={t("memberships.pickers.itemPlaceholder")}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && items[active]) {
            e.preventDefault();
            pick(items[active]!);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {r.isFetching && <Loader2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {open && (
        <ul role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {items.length === 0 && !r.isFetching ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t("memberships.pickers.noItems")}</li>
          ) : (
            items.map((row, i) => (
              <li
                key={row.id}
                role="option"
                aria-selected={i === active}
                className={cn("cursor-pointer rounded-sm px-3 py-2 text-sm", i === active && "bg-accent text-accent-foreground")}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(row);
                }}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate">{row.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{money(row.rate)}</span>
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** "Gym monthly · 30 days · ₹1,500.00" */
export function usePlanLabel() {
  const { t } = useI18n();
  return (p: Plan) =>
    [p.name, t("memberships.plan.days", { days: p.durationDays }), p.sessions ? t("memberships.plan.sessionsN", { count: p.sessions }) : null, money(p.price)]
      .filter(Boolean)
      .join(" · ");
}

/** Select of the plans on sale. `allowNone` adds a "No plan yet" choice (value ""). */
export function PlanSelect({ value, onChange, allowNone, id }: { value: string; onChange: (id: string, plan: Plan | null) => void; allowNone?: boolean; id?: string }) {
  const { t } = useI18n();
  const plans = usePlans();
  const label = usePlanLabel();
  const list = plans.data?.items ?? [];
  const NONE = "__none";
  return (
    <Select value={value || (allowNone ? NONE : undefined)} onValueChange={(v) => onChange(v === NONE ? "" : v, list.find((p) => p.id === v) ?? null)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={plans.isPending ? t("memberships.common.loading") : t("memberships.pickers.planPlaceholder")} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{t("memberships.pickers.noPlan")}</SelectItem>}
        {list.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {label(p)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
