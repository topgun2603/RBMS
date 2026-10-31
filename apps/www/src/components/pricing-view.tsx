"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@rbms/ui/components/badge";
import { Button } from "@rbms/ui/components/button";
import { Card } from "@rbms/ui/components/card";
import { AnimatePresence, AnimatedNumber, motion, RevealGroup, RevealItem } from "@rbms/ui/motion";
import { cn } from "@rbms/ui/lib/utils";
import { POPULAR_TIER, isFreePlan, maxSavingPct, planDescription, planHighlights, planName, planTier, pricePaise, rupees, signupHref, yearlySavingPaise, yearlySavingPct, type Interval, type Plan } from "@/lib/plans";
import { APP_IDS, appParam, type AppId } from "@/lib/site";
import { useSite } from "./site-context";
import { IntervalToggle } from "./interval-toggle";
import { Lift } from "./motion-bits";

/**
 * Which app's plans are shown: links that set `?app=` (the server page fetches that app's plans), keeping the interval.
 * A nav of links rather than a toggle, so it works before hydration and each app's pricing has its own URL.
 */
export function AppSwitcher({ app, interval }: { app: AppId; interval: Interval }) {
  const { t } = useSite();
  const list = React.useRef<HTMLUListElement>(null);
  // On narrow screens the row scrolls sideways: bring the current app into view (without moving the page).
  React.useEffect(() => {
    const ul = list.current;
    const cur = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (ul && cur && ul.scrollWidth > ul.clientWidth) ul.scrollLeft = cur.offsetLeft - (ul.clientWidth - cur.offsetWidth) / 2;
  }, [app]);
  return (
    <nav aria-label={t("pricing.forApp")} className="flex w-full justify-center">
      <ul ref={list} className="relative inline-flex max-w-full overflow-x-auto rounded-full border bg-card p-1 shadow-sm [scrollbar-width:none]" data-testid="pricing-apps">
        {APP_IDS.map((a) => {
          const on = a === app;
          return (
            <li key={a} className="shrink-0">
              <Link
                href={`/pricing?app=${appParam(a)}&interval=${interval}`}
                scroll={false}
                aria-current={on ? "page" : undefined}
                data-testid={`pricing-app-${a}`}
                className={cn("relative flex h-9 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors focus-ring", on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {on && <motion.span layoutId="pricing-app-pill" className="absolute inset-0 rounded-full bg-primary shadow-sm" transition={{ type: "spring", stiffness: 480, damping: 34 }} />}
                <span className="relative">{t(`app.${a}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** App switcher, interval toggle + plan cards. The interval is mirrored in the URL (?interval=) so a shared link keeps it. */
export function PricingCards({ plans, app, initialInterval }: { plans: Plan[]; app: AppId; initialInterval: Interval }) {
  const { t, locale } = useSite();
  const [interval, setIntervalState] = React.useState<Interval>(initialInterval);
  const setInterval = (v: Interval) => {
    setIntervalState(v);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("interval", v);
      window.history.replaceState(null, "", u.toString());
    } catch {
      /* ignore */
    }
  };
  const save = maxSavingPct(plans);
  return (
    <div className="space-y-10">
      <div className="flex flex-col items-center gap-3">
        <AppSwitcher app={app} interval={interval} />
        <IntervalToggle value={interval} onChange={setInterval} savePct={save} />
        <p className="text-sm text-muted-foreground">{t("pricing.gstNote")}</p>
      </div>
      <RevealGroup className={cn("mx-auto grid max-w-6xl items-stretch gap-5", plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2", plans.length === 2 && "max-w-4xl")}>
        {plans.map((p) => {
          const tier = planTier(p) ?? p.id;
          const popular = tier === POPULAR_TIER;
          const free = isFreePlan(p);
          const price = pricePaise(p, interval);
          const pct = yearlySavingPct(p);
          return (
            <RevealItem key={p.id} className="h-full">
              <Lift className="h-full">
                <Card
                  data-testid={`plan-${tier}`}
                  className={cn(
                    "relative h-full gap-0 rounded-[1.75rem] p-6 sm:p-7",
                    popular && "border-transparent bg-[linear-gradient(var(--card),var(--card))_padding-box,linear-gradient(135deg,var(--primary),var(--www-marigold))_border-box] [border:2px_solid_transparent] shadow-www",
                  )}
                >
                  {popular && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1 rounded-full px-3 py-1 shadow-sm">
                      <SparklesIcon />
                      {t("pricing.popular")}
                    </Badge>
                  )}
                  <h3 className="font-display text-2xl font-bold">{planName(t, p)}</h3>
                  <p className="mt-1 min-h-10 text-sm text-muted-foreground">{planDescription(t, p, locale)}</p>
                  <div className="mt-6 flex min-h-[4.5rem] flex-col justify-end">
                    {free ? (
                      <p className="font-display text-4xl font-bold tabular-nums">{rupees(locale, 0)}</p>
                    ) : (
                      <p className="flex flex-wrap items-baseline gap-x-1">
                        <span className="font-display text-4xl font-bold tabular-nums">
                          <AnimatedNumber value={price} duration={0.45} format={(n) => rupees(locale, Math.round(n / 100) * 100)} />
                        </span>
                        <span className="text-sm text-muted-foreground">{interval === "yearly" ? t("pricing.perYear") : t("pricing.perMonth")}</span>
                      </p>
                    )}
                    <div className="h-5 text-xs text-muted-foreground">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.p key={`${interval}-${free}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                          {free
                            ? t("pricing.freeForever")
                            : interval === "yearly"
                              ? t("pricing.monthlyEquivalent", { amount: rupees(locale, Math.round(p.priceYearlyPaise / 12 / 100) * 100) })
                              : `${t("pricing.exGst")}`}
                        </motion.p>
                      </AnimatePresence>
                    </div>
                  </div>
                  <div className="h-7 pt-1">
                    <AnimatePresence>
                      {interval === "yearly" && pct > 0 && (
                        <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="inline-block">
                          <Badge variant="success">{t("pricing.yearlySaving", { amount: rupees(locale, yearlySavingPaise(p)) })}</Badge>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <Button asChild size="lg" variant={popular ? "default" : "outline"} className="group mt-4 w-full rounded-full" data-testid={`plan-cta-${tier}`}>
                    <Link href={signupHref(p.id, interval, app)}>
                      {free ? t("pricing.ctaFree") : t("pricing.ctaTrial")}
                      <ArrowRightIcon className="transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </Button>
                  <ul className="mt-6 space-y-2.5 border-t pt-6 text-sm">
                    {planHighlights(p, plans, t, locale).map((h) => (
                      <li key={h} className="flex items-start gap-2">
                        <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </Lift>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </div>
  );
}
