"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, CrownIcon, GaugeIcon, SparklesIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Meter,
  motion,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { featureModuleName, featureName } from "../app/gate";
import { useOptionalWebApp, useSettingsHref } from "../app/navigation";
import { allSettingsPages, useOptionalSession } from "../app/session";
import { BUILT_IN_SETTINGS } from "../app/builtins";
import { onApiError } from "../lib/api";
import { useFeatures } from "../lib/features";
import { formatPaise, humanizeKey } from "../lib/format";
import { tOr, useI18n, type Translator } from "../lib/i18n";
import { usePublicPlans } from "../lib/subscription-queries";
import { isUnlimited, isUpgradeError, PLAN_SETTINGS_PATH, planBlockFrom, planThatUnlocks, SUBSCRIPTIONS_PERMISSION, type PlanBlock } from "../lib/subscriptions";

/** Name of a plan limit key ("invoices_per_month" → "Bills this month"). */
export const limitName = (t: Translator, key: string) => tOr(t, `web.plan.limits.${key}`, humanizeKey(key));

/**
 * Listens for plan errors from any api() write and explains them: which limit (used / limit), which plan lifts it and
 * a link to Settings → Plan & billing. Members without `subscriptions.manage` are told to ask the owner. Mounted once
 * by the app frame; callers keep their own error toast (the dialog adds the way out).
 */
export function UpgradeDialogHost() {
  const [block, setBlock] = React.useState<PlanBlock | null>(null);
  React.useEffect(
    () =>
      onApiError((e) => {
        if (isUpgradeError(e)) setBlock(planBlockFrom(e.error.details));
      }),
    [],
  );
  return <UpgradeDialog block={block} onClose={() => setBlock(null)} />;
}

export function UpgradeDialog({ block, onClose }: { block: PlanBlock | null; onClose: () => void }) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const app = useOptionalWebApp();
  const session = useOptionalSession();
  const features = useFeatures();
  const settingsHref = useSettingsHref();
  const open = block !== null;
  const plans = usePublicPlans(open);

  // Keep the last block while the dialog animates closed.
  const [shown, setShown] = React.useState<PlanBlock | null>(block);
  React.useEffect(() => {
    if (block) setShown(block);
  }, [block]);
  const b = block ?? shown;

  const hasPage = React.useMemo(() => !!app && allSettingsPages(app, BUILT_IN_SETTINGS).some((p) => p.path === PLAN_SETTINGS_PATH), [app]);
  const canManage = !!session?.can(SUBSCRIPTIONS_PERMISSION) && hasPage;
  const unlock = b && plans.data ? planThatUnlocks(plans.data, b, features.data?.planId) : null;

  let body = "";
  if (b?.kind === "limit") body = t("web.plan.upgrade.limitBody", { limit: limitName(t, b.key).toLowerCase() });
  else if (b?.kind === "feature") body = t("web.plan.upgrade.featureBody", { feature: featureName(t, b.feature, features.state(b.feature)) });
  else if (b?.kind === "module") body = t("web.plan.upgrade.moduleBody", { feature: featureModuleName(t, b.module, features.state(b.module)) });
  else body = t("web.plan.upgrade.planBody");

  const showMeter = b?.kind === "limit" && b.limit !== null && !isUnlimited(b.limit);
  const used = b?.kind === "limit" ? (b.used ?? b.limit ?? 0) : 0;
  const limit = b?.kind === "limit" ? (b.limit ?? 0) : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("web.common.close")}>
        <DialogHeader className="items-center text-center sm:items-center sm:text-center">
          <motion.span
            initial={reduced ? false : { scale: 0.6, rotate: -12, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            className="icon-chip mb-1 size-14 rounded-2xl text-primary"
          >
            {b?.kind === "limit" ? <GaugeIcon className="size-7" /> : <SparklesIcon className="size-7" />}
          </motion.span>
          <DialogTitle>{t("web.plan.upgrade.title")}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>

        {showMeter && b?.kind === "limit" && (
          <div className="grid gap-2 rounded-xl border bg-muted/30 p-3">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{limitName(t, b.key)}</span>
              <span className="tabular-nums text-muted-foreground">{t("web.plan.upgrade.used", { used, limit })}</span>
            </div>
            <Meter value={used} max={limit} label={limitName(t, b.key)} valueText={t("web.plan.upgrade.used", { used, limit })} />
            {b.key.endsWith("_per_month") && <p className="text-xs text-muted-foreground">{t("web.plan.upgrade.resets")}</p>}
          </div>
        )}

        {canManage && (
          <div className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
            <CrownIcon className="size-5 shrink-0 text-primary" aria-hidden />
            {plans.isPending ? (
              <span className="h-4 w-40 animate-pulse rounded bg-muted" />
            ) : unlock ? (
              <p className="min-w-0 text-sm">
                <span className="font-semibold">{t("web.plan.upgrade.unlockedBy", { plan: unlock.name })}</span>
                {unlock.priceMonthlyPaise > 0 && (
                  <span className="text-muted-foreground"> · {t("web.plan.upgrade.unlockedByPrice", { price: formatPaise(unlock.priceMonthlyPaise) })}</span>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("web.plan.upgrade.noPlan")}</p>
            )}
          </div>
        )}
        {!canManage && <p className="text-center text-sm text-muted-foreground">{t("web.plan.upgrade.askOwner")}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("web.plan.upgrade.later")}
          </Button>
          {canManage && (
            <Button asChild>
              <Link href={settingsHref(PLAN_SETTINGS_PATH)} onClick={onClose}>
                {t("web.plan.upgrade.seePlans")} <ArrowRightIcon />
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
