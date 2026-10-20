"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { cn, Input } from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { hhmm, istMinute, parseHHMM, time12 } from "../lib/format";
import { useAvailability } from "../lib/queries";
import type { Slot } from "../lib/types";

/**
 * Free slots for the services on a day as tap targets, plus a typed time for squeezing someone in (the desk may book
 * a named person outside the free slots; the server still refuses clashes). `value` is minutes since IST midnight.
 */
export function SlotPicker({
  date,
  serviceIds,
  staffId,
  value,
  onChange,
  onSlot,
  allowCustom = true,
}: {
  date: string;
  serviceIds: string[];
  /** A person or "any". */
  staffId: string;
  value: number | null;
  onChange: (min: number | null) => void;
  /** The slot picked (who "any" would give it to). */
  onSlot?: (slot: Slot | null) => void;
  allowCustom?: boolean;
}) {
  const { t } = useI18n();
  const a = useAvailability(date, serviceIds, staffId);
  const slots = a.data?.date === date ? a.data.slots : [];
  const [custom, setCustom] = React.useState(value !== null ? hhmm(value) : "");
  React.useEffect(() => {
    if (value !== null && !slots.some((s) => istMinute(s.start) === value)) setCustom(hhmm(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  if (serviceIds.length === 0) return <p className="text-sm text-muted-foreground">{t("bookings.new.pickServicesFirst")}</p>;
  return (
    <div className="grid gap-3">
      {a.isError ? (
        <p className="text-sm text-destructive">{describeError(a.error, t)}</p>
      ) : a.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> {t("bookings.new.loadingSlots")}
        </p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("bookings.new.noSlots")}</p>
      ) : (
        <div role="radiogroup" aria-label={t("bookings.new.slots")} className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
          {slots.map((s) => {
            const min = istMinute(s.start);
            const on = value === min;
            return (
              <button
                key={s.start}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  onChange(min);
                  onSlot?.(s);
                  setCustom("");
                }}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-sm tabular-nums transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {time12(min)}
              </button>
            );
          })}
        </div>
      )}
      {allowCustom && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("bookings.new.customTime")}
          <Input
            type="time"
            step={300}
            className="h-8 w-32"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              const m = parseHHMM(e.target.value);
              onChange(m);
              onSlot?.(null);
            }}
          />
        </label>
      )}
    </div>
  );
}
