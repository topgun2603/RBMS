"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@srirealtime/ui/components/badge";
import { Button } from "@srirealtime/ui/components/button";
import { Card } from "@srirealtime/ui/components/card";
import { AnimatePresence, AnimatedNumber, motion, RevealGroup, RevealItem } from "@srirealtime/ui/motion";
import { cn } from "@srirealtime/ui/lib/utils";
import { POPULAR_PLAN, isFreePlan, maxSavingPct, planDescription, planHighlights, planName, pricePaise, rupees, yearlySavingPaise, yearlySavingPct, type Interval, type Plan } from "@/lib/plans";
import { appParam, type AppId } from "@/lib/site";
import { useSite } from "./site-context";
import { IntervalToggle } from "./interval-toggle";
import { Lift } from "./motion-bits";

export function signupHref(planId: string, interval: Interval, app: AppId | null) {
  const q = new URLSearchParams({ plan: planId, interval });
  if (app) q.set("app", appParam(app));
  return `/signup?${q.toString()}`;
}

/** Interval toggle + plan cards. The interval is mirrored in the URL (?interval=) so a shared link keeps it. */
export function PricingCards({ plans, app, initialInterval }: { plans: Plan[]; app: AppId | null; initialInterval: Interval }) {
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
        <IntervalToggle value={interval} onChange={setInterval} savePct={save} />
        <p className="text-sm text-muted-foreground">{t("pricing.gstNote")}</p>
      </div>
      <RevealGroup className={cn("mx-auto grid max-w-6xl items-stretch gap-5", plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2", plans.length === 2 && "max-w-4xl")}>
        {plans.map((p) => {
          const popular = p.id === POPULAR_PLAN;
          const free = isFreePlan(p);
          const price = pricePaise(p, interval);
          const pct = yearlySavingPct(p);
          return (
            <RevealItem key={p.id} className="h-full">
              <Lift className="h-full">
                <Card
                  data-testid={`plan-${p.id}`}
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
                  <p className="mt-1 min-h-10 text-sm text-muted-foreground">{planDescription(t, p)}</p>
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
                  <Button asChild size="lg" variant={popular ? "default" : "outline"} className="group mt-4 w-full rounded-full" data-testid={`plan-cta-${p.id}`}>
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
