"use client";

import { ChipGroup, ColorInput, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@rbms/ui";
import { STORE_FONTS } from "@rbms/branding/theme";
import { useI18n } from "@rbms/web";

/** Form fields shared by Settings → Branding and Settings → Appearance. */

export function Choice<V extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <ChipGroup size="sm" aria-label={label} value={value} onChange={(v) => !disabled && onChange(v as V)} options={options} />
    </div>
  );
}

export function ColorField({ label, value, onChange, disabled, optional }: { label: string; value: string | null; onChange: (v: string | null) => void; disabled?: boolean; optional?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center justify-between text-sm font-medium">
        {label}
        {optional && value && !disabled && (
          <button type="button" className="text-meta font-normal text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}>
            {t("site.appearance.auto")}
          </button>
        )}
      </span>
      <ColorInput value={value ?? ""} placeholder={optional ? t("site.appearance.auto") : "#2563eb"} onChange={(v) => onChange(v)} disabled={disabled} aria-label={label} />
    </div>
  );
}

export function FontField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const fonts = (STORE_FONTS as readonly string[]).includes(value) ? STORE_FONTS : [value, ...STORE_FONTS];
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fonts.map((f) => (
            <SelectItem key={f} value={f}>
              <span style={{ fontFamily: `"${f}", sans-serif` }}>{f}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
