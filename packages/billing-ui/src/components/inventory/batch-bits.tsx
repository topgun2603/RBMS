"use client";

import * as React from "react";
import { AlertTriangleIcon, CheckCircle2Icon, CircleDashedIcon, ClockIcon, XCircleIcon } from "lucide-react";
import { cn, Input, StatusPill, type StatusTone } from "@srirealtime/ui";
import { useDebounced, useI18n } from "@srirealtime/web";
import { useItems } from "../../lib/queries";
import type { Item } from "../../lib/types";
import type { ExpiryStatus } from "../../lib/types-stock";

type Icon = React.ComponentType<{ className?: string }>;

const META: Record<ExpiryStatus, { tone: StatusTone; icon: Icon; key: string }> = {
  expired: { tone: "danger", icon: XCircleIcon, key: "billing.batches.status.expired" },
  expiring: { tone: "warning", icon: AlertTriangleIcon, key: "billing.batches.status.expiring" },
  ok: { tone: "success", icon: CheckCircle2Icon, key: "billing.batches.status.ok" },
  none: { tone: "neutral", icon: CircleDashedIcon, key: "billing.batches.status.none" },
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** "31 Mar 2027" for a YYYY-MM-DD date; an em dash when there is none. */
export function fmtDay(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(`${d}T12:00:00+05:30`);
  return Number.isNaN(dt.getTime()) ? d : dateFmt.format(dt);
}

/** "31 Mar 2027" for a timestamp, on India's calendar day (a UTC date would be a day behind until 5:30 am). */
export function fmtStamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? ts : fmtDay(new Date(ms + 330 * 60_000).toISOString().slice(0, 10));
}

/** Expired / Expiring / OK / No expiry, with the days left in the text (icon + label, never colour alone). */
export function ExpiryPill({ status, daysLeft, className }: { status: ExpiryStatus; daysLeft: number | null; className?: string }) {
  const { t } = useI18n();
  const meta = META[status];
  const text =
    status === "expired" && daysLeft !== null
      ? t("billing.batches.expiredAgo", { days: Math.abs(daysLeft) })
      : (status === "expiring" || (status === "ok" && daysLeft !== null && daysLeft <= 180)) && daysLeft !== null
        ? t("billing.batches.daysLeft", { days: daysLeft })
        : t(meta.key);
  return (
    <StatusPill tone={meta.tone} icon={status === "expiring" && daysLeft !== null ? ClockIcon : meta.icon} className={className}>
      {text}
    </StatusPill>
  );
}

/** The highlighted suggestion after a key press: ArrowDown / ArrowUp move it (stopping at the ends; -1 = none), anything else leaves it. */
export function stepActive(active: number, key: string, count: number): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return Math.min(count - 1, active + 1);
  if (key === "ArrowUp") return Math.max(-1, active - 1);
  return active;
}

/** Search-as-you-type picker of saved items (name or code). Arrow keys move through the suggestions, Enter picks, Escape closes. */
export function ItemCombobox({
  id,
  value,
  onValue,
  onPick,
  invalid,
  autoFocus,
  placeholder,
}: {
  id: string;
  value: string;
  onValue: (v: string) => void;
  onPick: (item: Item) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const q = useDebounced(value.trim(), 200);
  const { data } = useItems(q, 8, open && q.length > 0);
  const items = open && q.length > 0 ? (data?.items ?? []) : [];
  const listId = `${id}-list`;
  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        autoComplete="off"
        autoFocus={autoFocus}
        aria-invalid={invalid}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={items.length > 0 && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onValue(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (items.length === 0) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => stepActive(i, e.key, items.length));
          } else if (e.key === "Enter" && items[active]) {
            e.preventDefault();
            onPick(items[active]!);
            setOpen(false);
            setActive(-1);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {items.length > 0 && (
        <ul id={listId} className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-xl border bg-popover p-1 shadow-lg" role="listbox">
          {items.map((it, i) => (
            <li key={it.id} id={`${listId}-${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                className={cn("flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent", i === active && "bg-accent")}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onPick(it);
                  setOpen(false);
                }}
              >
                <span className="truncate">{it.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{it.unit || "pcs"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
