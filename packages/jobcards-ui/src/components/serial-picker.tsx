"use client";

import * as React from "react";
import { CheckIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { cn, Field, FieldHint, FieldLabel, Input } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { useSerialUnits } from "../lib/queries";

/**
 * Picks the serial numbers / IMEIs of the units fitted on a part line from the item's units on the shelf (one per
 * unit). Serials already on the line stay listed even once they're no longer "in stock". Shown only for items with
 * serial-tracked units; hidden when the shop can't read its serial stock.
 */
export function SerialPicker({ itemId, qty, value, onChange }: { itemId: string; qty: number; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  const q = useSerialUnits(itemId);
  const [filter, setFilter] = React.useState("");
  if (q.isError) return null;
  const units = q.data?.items ?? [];
  // Items without serial-tracked units on the shelf: nothing to pick.
  if (!q.isLoading && units.length === 0 && value.length === 0) return null;
  const max = Math.max(1, Math.ceil(qty || 1));
  const all = [...new Set([...value, ...units.map((u) => u.serial)])];
  const f = filter.trim().toUpperCase();
  const shown = f ? all.filter((s) => s.includes(f) || units.find((u) => u.serial === s)?.serial2?.includes(f)) : all;
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  const tooMany = value.length > max;
  return (
    <Field invalid={tooMany}>
      <FieldLabel htmlFor={null}>
        {t("jobcards.lines.serials")} <span className="font-normal text-muted-foreground">· {t("jobcards.lines.serialsPicked", { picked: value.length, qty: max })}</span>
      </FieldLabel>
      {q.isLoading ? (
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid gap-2">
          {all.length > 8 && (
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={filter} placeholder={t("jobcards.lines.serialsFilter")} aria-label={t("jobcards.lines.serialsFilter")} onChange={(e) => setFilter(e.target.value)} />
            </div>
          )}
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label={t("jobcards.lines.serials")}>
            {shown.map((s) => {
              const on = value.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && value.length >= max}
                  onClick={() => toggle(s)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-meta transition-colors disabled:opacity-40",
                    on ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                  )}
                >
                  {on && <CheckIcon className="size-3" />}
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <FieldHint>{tooMany ? t("jobcards.lines.serialsTooMany", { qty: max }) : t("jobcards.lines.serialsHint")}</FieldHint>
    </Field>
  );
}
