"use client";

import { GST_STATES } from "@rbms/gst";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, type ControlSize } from "@rbms/ui";
import { useI18n } from "@rbms/web";

/** GST state picker ("33 · Tamil Nadu"). Value is the 2-digit state code. */
export function StateSelect({
  id,
  value,
  onChange,
  disabled,
  className,
  size,
  placeholder,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
  /** Control height on the shared scale (sm 36px in dense rows; default 40px). */
  size?: ControlSize;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const { t } = useI18n();
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} size={size} className={className ?? "w-full"} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder ?? t("billing.common.selectState")} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {GST_STATES.map((s) => (
          <SelectItem key={s.code} value={s.code}>
            <span className="w-6 text-muted-foreground tabular-nums">{s.code}</span> {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
