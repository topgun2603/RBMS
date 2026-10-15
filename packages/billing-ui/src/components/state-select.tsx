"use client";

import { GST_STATES } from "@srirealtime/gst";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";

/** GST state picker ("33 · Tamil Nadu"). Value is the 2-digit state code. */
export function StateSelect({
  id,
  value,
  onChange,
  disabled,
  className,
  placeholder,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const { t } = useI18n();
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={className ?? "h-10 w-full"} aria-label={ariaLabel}>
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
