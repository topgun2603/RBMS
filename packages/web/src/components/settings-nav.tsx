"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SettingsIcon } from "lucide-react";
import { cn, motion } from "@srirealtime/ui";
import { BUILT_IN_SETTINGS } from "../app/builtins";
import { useVisibleSettings } from "../app/session";
import { useI18n } from "../lib/i18n";

/** Tabs across every settings page the app's modules contribute (plus Settings → Features). */
export function SettingsNav({ className }: { className?: string }) {
  const { t } = useI18n();
  const pathname = (usePathname() ?? "").replace(/\/+$/, "") || "/";
  const pages = useVisibleSettings(BUILT_IN_SETTINGS);
  if (pages.length < 2) return null;
  return (
    <nav aria-label={t("web.settings.tabs")} className={cn("-mx-1 mb-5 overflow-x-auto px-1 [scrollbar-width:none]", className)}>
      <ul className="inline-flex gap-1 rounded-xl border bg-card p-1 shadow-xs">
        {pages.map((p) => {
          const active = pathname === p.href;
          const Icon = p.icon ?? SettingsIcon;
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="sr-settings-tab"
                    className="absolute inset-0 rounded-lg bg-primary/10"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon className="relative size-4" />
                <span className="relative">{t(p.label)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
