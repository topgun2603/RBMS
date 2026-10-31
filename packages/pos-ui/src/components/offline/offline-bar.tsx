"use client";

import * as React from "react";
import { AlertTriangleIcon, CloudUploadIcon, Loader2Icon, RefreshCwIcon, WifiOffIcon } from "lucide-react";
import { AnimatePresence, Button, motion } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { useCatalog } from "../catalog-provider";
import { usePos } from "../pos-context";
import { useOffline } from "./offline-provider";

/** The cached prices are older than this: the cashier is told they may be out of date. */
export const STALE_PRICES_MS = 24 * 60 * 60_000;

export function useAgo() {
  const { t } = useI18n();
  return React.useCallback(
    (at: number | null) => {
      if (!at) return t("pos.off.never");
      const mins = Math.max(Math.round((Date.now() - at) / 60_000), 0);
      if (mins < 1) return t("pos.off.justNow");
      if (mins < 60) return t("pos.off.minsAgo", { count: mins });
      if (mins < 48 * 60) return t("pos.off.hoursAgo", { count: Math.round(mins / 60) });
      return t("pos.off.daysAgo", { count: Math.round(mins / 1440) });
    },
    [t],
  );
}

/**
 * The strip under the top bar: offline banner with the number of bills saved on this device, "Sync now" and the way
 * into the Pending bills screen. Online it only shows while bills still wait (or failed), so a healthy counter stays clean.
 */
export function OfflineBar({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const { online } = usePos();
  const offline = useOffline();
  const catalog = useCatalog();
  const ago = useAgo();
  const { counts } = offline;
  const stalePrices = catalog.syncedAt !== null && Date.now() - catalog.syncedAt > STALE_PRICES_MS;
  const show = !online.online || counts.pending > 0 || !offline.persistent;
  const failed = counts.failed > 0;
  const tone = !online.online ? "bg-destructive text-white dark:bg-destructive/60" : failed ? "bg-warning/25 text-foreground" : "bg-primary/10 text-foreground";

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="offline-bar"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className={`overflow-hidden ${tone}`}
          role="alert"
        >
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
            <span className="flex items-center gap-2 font-medium">
              {!online.online ? <WifiOffIcon className="size-4" /> : failed ? <AlertTriangleIcon className="size-4" /> : <CloudUploadIcon className="size-4" />}
              {!online.online
                ? t(counts.pending > 0 ? "pos.off.bannerCount" : "pos.off.banner", { count: counts.pending })
                : failed
                  ? t("pos.off.needAttention", { count: counts.failed })
                  : t("pos.off.waiting", { count: counts.pending })}
            </span>
            {!online.online && catalog.available && (
              <span className={stalePrices ? "font-semibold underline decoration-dotted" : "opacity-90"}>
                {t(stalePrices ? "pos.off.pricesStale" : "pos.off.pricesAt", { when: ago(catalog.syncedAt) })}
              </span>
            )}
            {!offline.persistent && <span className="font-semibold">{t("pos.off.noStorage")}</span>}
            <span className="flex items-center gap-2">
              {online.online && counts.pending > 0 && (
                <Button type="button" size="sm" variant="secondary" onClick={() => void offline.syncNow()} disabled={offline.syncing}>
                  {offline.syncing ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} {t("pos.off.syncNow")}
                </Button>
              )}
              {(counts.pending > 0 || counts.flagged > 0) && (
                <Button type="button" size="sm" variant={online.online ? "outline" : "secondary"} onClick={onOpen}>
                  {t("pos.off.openPending", { count: counts.pending })}
                </Button>
              )}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
