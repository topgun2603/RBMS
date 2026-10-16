"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangleIcon, ArrowRightIcon, SparklesIcon, XIcon } from "lucide-react";
import { AnimatePresence, Button, cn, motion, useReducedMotionSafe } from "@srirealtime/ui";
import { useOptionalWebApp, useSettingsHref } from "../app/navigation";
import { allSettingsPages, useOptionalSession } from "../app/session";
import { BUILT_IN_SETTINGS } from "../app/builtins";
import { useI18n } from "../lib/i18n";
import { readStored, writeStored } from "../lib/session";
import { useSubscriptionCurrent } from "../lib/subscription-queries";
import { bannerState, MOCK_AUTH_PARAM, PLAN_SETTINGS_PATH, SUBSCRIPTIONS_PERMISSION } from "../lib/subscriptions";
import { useTenantSlug } from "../lib/tenant";

const todayKey = () => new Date().toISOString().slice(0, 10);

/**
 * Slim trial / past-due / expired strip at the top of the signed-in shell, for members who hold
 * `subscriptions.manage` (owners and admins). Reads the cached GET /v1/subscriptions/current; hidden when the
 * subscription is healthy, when the app has no Plan & billing page, on that page itself, and when the call fails.
 * A trial reminder can be hidden for the day; past-due and expired can't.
 */
export function PlanBanner() {
  const { t } = useI18n();
  const app = useOptionalWebApp();
  const session = useOptionalSession();
  const slug = useTenantSlug();
  const pathname = usePathname() ?? "/";
  const settingsHref = useSettingsHref();
  const reduced = useReducedMotionSafe();

  const hasPage = React.useMemo(() => !!app && allSettingsPages(app, BUILT_IN_SETTINGS).some((p) => p.path === PLAN_SETTINGS_PATH), [app]);
  const allowed = !!session?.can(SUBSCRIPTIONS_PERMISSION) && hasPage;
  const current = useSubscriptionCurrent(allowed);
  const href = settingsHref(PLAN_SETTINGS_PATH);
  const router = useRouter();

  // The mock provider's authUrl may land anywhere in the app: bring `?mockAuth=` to Plan & billing, which owns the dialog.
  React.useEffect(() => {
    if (!hasPage) return;
    const id = new URLSearchParams(window.location.search).get(MOCK_AUTH_PARAM);
    if (id && pathname !== href) router.replace(`${href}?${MOCK_AUTH_PARAM}=${encodeURIComponent(id)}`);
  }, [hasPage, pathname, href, router]);

  const dismissKey = `sr_plan_banner_${slug ?? "_"}`;
  const [dismissed, setDismissed] = React.useState(false);
  React.useEffect(() => {
    try {
      setDismissed(readStored(dismissKey) === todayKey());
    } catch {
      setDismissed(false);
    }
  }, [dismissKey]);

  const state = allowed && current.data ? bannerState(current.data) : null;
  const onPage = pathname === href || pathname.startsWith(`${href}/`);
  const show = !!state && !onPage && !(state.kind === "trial" && dismissed);
  const danger = state?.kind === "past_due" || state?.kind === "expired";

  let title = "";
  let hint = "";
  if (state?.kind === "trial") {
    title = state.daysLeft <= 0 ? t("web.plan.banner.trialEnded") : state.daysLeft === 1 ? t("web.plan.banner.trialOne") : t("web.plan.banner.trial", { days: state.daysLeft });
    hint = t("web.plan.banner.trialHint");
  } else if (state?.kind === "past_due") {
    title = state.graceDaysLeft <= 1 ? t("web.plan.banner.pastDueOne") : t("web.plan.banner.pastDue", { days: state.graceDaysLeft });
    hint = t("web.plan.banner.pastDueHint");
  } else if (state?.kind === "expired") {
    title = t("web.plan.banner.expired");
    hint = t("web.plan.banner.expiredHint");
  }
  const Icon = danger ? AlertTriangleIcon : SparklesIcon;

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="plan-banner"
          role={danger ? "alert" : "status"}
          data-print-hide
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <div
            className={cn(
              "flex items-center gap-2.5 border-b px-4 py-2 text-sm sm:px-6 lg:px-8",
              danger ? "border-destructive/25 bg-destructive/10 text-danger-ink" : "border-primary/15 bg-primary/8 text-foreground",
            )}
          >
            <Icon className={cn("size-4 shrink-0", danger ? "text-danger-ink" : "text-primary")} aria-hidden />
            <p className="min-w-0 flex-1 leading-snug">
              <span className="font-semibold">{title}</span>
              <span className={cn("hidden lg:inline", danger ? "text-danger-ink/80" : "text-muted-foreground")}> · {hint}</span>
            </p>
            <Button asChild size="sm" variant={danger ? "destructive" : "default"} className="h-8 shrink-0 rounded-full px-3">
              <Link href={href}>
                {state?.kind === "past_due" ? t("web.plan.banner.payNow") : t("web.plan.banner.choose")}
                <ArrowRightIcon className="hidden sm:inline" />
              </Link>
            </Button>
            {state?.kind === "trial" && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="-mr-1 size-8 shrink-0 text-muted-foreground"
                aria-label={t("web.plan.banner.dismiss")}
                title={t("web.plan.banner.dismiss")}
                onClick={() => {
                  setDismissed(true);
                  try {
                    writeStored(dismissKey, todayKey());
                  } catch {
                    // private mode: hidden for this visit only
                  }
                }}
              >
                <XIcon />
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
