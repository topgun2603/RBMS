"use client";

import * as React from "react";
import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import type { ScanFlag } from "../../lib/ai-scan";
import { money } from "../../lib/format";

/** Class for a field block the AI was unsure about (or a check failed): tinted, so it stands out until the person edits it. */
export const aiLowClass = (low: boolean) => (low ? "rounded-lg bg-warning/10 p-1.5 -m-1.5 ring-1 ring-warning/60" : "");

/** Flag params are numbers in paise for amounts; show those as rupees. */
const AMOUNT_PARAMS = new Set(["printed", "computed"]);

/**
 * The checks the server ran on the reading, in plain words (`billing.ai.flag.<code>`). Errors first. `line` flags say
 * which line they are about.
 */
export function ScanFlags({ flags, className }: { flags: ScanFlag[]; className?: string }) {
  const { t } = useI18n();
  const shown = flags.filter((f) => f.severity !== "info" || f.code === "item_fuzzy");
  if (shown.length === 0) return null;
  const order = { error: 0, warn: 1, info: 2 } as const;
  const sorted = [...shown].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <ul className={cn("grid gap-1.5 text-sm", className)} aria-label={t("billing.ai.checks")}>
      {sorted.map((f, i) => {
        const params: Record<string, string | number> = { line: (f.line ?? 0) + 1 };
        for (const [k, v] of Object.entries(f.params ?? {})) params[k] = AMOUNT_PARAMS.has(k) && typeof v === "number" ? money(v) : v;
        const key = `billing.ai.flag.${f.code}`;
        const Icon = f.severity === "error" ? CircleAlertIcon : f.severity === "warn" ? TriangleAlertIcon : InfoIcon;
        return (
          <li key={`${f.code}-${f.line ?? "h"}-${i}`} data-flag={f.code} className={cn("flex items-start gap-2", f.severity === "error" ? "text-destructive" : f.severity === "warn" ? "text-warning-ink" : "text-muted-foreground")}>
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {f.line !== undefined && <span className="font-medium">{t("billing.ai.lineN", { n: f.line + 1 })}: </span>}
              {t.has(key) ? t(key, params) : f.code}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
