"use client";

import { LanguagesIcon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@rbms/ui";
import { LOCALE_NAMES, SUPPORTED_LOCALES, useI18n, type Locale } from "@/lib/i18n";

export function LocaleSwitcher({ compact = true }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? "sm" : "default"} aria-label={t("admin.locale.switch")} className="gap-1.5 px-2">
          <LanguagesIcon />
          <span className="text-xs font-semibold uppercase">{locale === "ta" ? "த" : "EN"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(v as Locale)}>
          {SUPPORTED_LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} lang={l}>
              {LOCALE_NAMES[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
