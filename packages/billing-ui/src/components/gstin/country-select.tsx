"use client";

import { COUNTRIES } from "@rbms/gst";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rbms/ui";
import { useI18n } from "@rbms/web";

/** Country of a buyer outside India (ISO alpha-2); "" = India. */
export function CountrySelect({ id, value, onChange, className }: { id?: string; value: string; onChange: (code: string) => void; className?: string }) {
  const { t } = useI18n();
  return (
    <Select value={value || "IN"} onValueChange={(v) => onChange(v === "IN" ? "" : v)}>
      <SelectTrigger id={id} className={className ?? "w-full"} aria-label={t("billing.gstin.country")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value="IN">{t("billing.gstin.countryNone")}</SelectItem>
        {COUNTRIES.map((c) => (
          <SelectItem key={c.code} value={c.code}>
            <span className="w-6 text-muted-foreground">{c.code}</span> {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
