"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, type ControlSize } from "@rbms/ui";
import { GST_RATES } from "../lib/format";

/** GST rate picker. Value is the rate as a string ("18"). */
export function GstRateSelect({
  id,
  value,
  onChange,
  className,
  size,
  disabled,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  /** Control height on the shared scale (sm 36px in dense rows; default 40px). */
  size?: ControlSize;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} size={size} className={className} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GST_RATES.map((r) => (
          <SelectItem key={r} value={String(r)}>
            {r}%
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
