"use client";

import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { Button } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import type { FieldErrors } from "../../lib/sections";
import { TextField } from "../bits";

/* Small pieces shared by the home section forms. */

/** Up / down / remove buttons for an item in a repeatable list. */
export function ItemTools({ i, n, onMove, onRemove, disabled, min = 1 }: { i: number; n: number; onMove: (d: number) => void; onRemove: () => void; disabled?: boolean; min?: number }) {
  const { t } = useI18n();
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === 0} onClick={() => onMove(-1)} aria-label={t("site.common.moveUpN", { n: i + 1 })}>
        <ArrowUpIcon />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === n - 1} onClick={() => onMove(1)} aria-label={t("site.common.moveDownN", { n: i + 1 })}>
        <ArrowDownIcon />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || n <= min} onClick={onRemove} aria-label={t("site.common.removeN", { n: i + 1 })}>
        <XIcon />
      </Button>
    </div>
  );
}

export function moveIn<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Button text + link. `field` names the form keys for errors ("cta" → ctaLabel / ctaHref, "cta2" → cta2Label …). */
export function CtaFields({
  idp,
  label,
  href,
  onLabel,
  onHref,
  errors,
  prefix = "",
  disabled,
  field = "cta",
  labelText,
  placeholder = "/products",
}: {
  idp: string;
  label: string;
  href: string;
  onLabel: (v: string) => void;
  onHref: (v: string) => void;
  errors: FieldErrors;
  prefix?: string;
  disabled?: boolean;
  field?: "cta" | "cta2";
  /** Label of the text field (default "Button text"). */
  labelText?: string;
  placeholder?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="grid items-start gap-3 sm:grid-cols-2">
      <TextField id={`${idp}-${field}-label`} label={labelText ?? t("site.home.ctaLabel")} optional value={label} placeholder={t("site.home.ctaLabelPlaceholder")} maxLength={60} disabled={disabled} error={errors[`${prefix}${field}Label`]} onChange={onLabel} />
      <TextField id={`${idp}-${field}-href`} label={t("site.home.ctaHref")} optional value={href} placeholder={placeholder} hint={t("site.common.linkHint")} disabled={disabled} error={errors[`${prefix}${field}Href`]} onChange={onHref} />
    </div>
  );
}
