import { CheckIcon, ExternalLinkIcon } from "lucide-react";
import type { Translator } from "@srirealtime/i18n/client";
import { Badge } from "@srirealtime/ui/components/badge";
import { Button } from "@srirealtime/ui/components/button";
import { Card } from "@srirealtime/ui/components/card";
import { RevealGroup, RevealItem } from "@srirealtime/ui/motion";
import { DEMO_APPS, DEMO_STORES } from "@/lib/demos";
import { listOf } from "@/lib/messages";
import { demoStoreUrl } from "@/lib/site";
import { tradeName } from "@/lib/trades";
import { Lift } from "./motion-bits";
import { TryDemoButton } from "./demo-button";

/** Online stores: a card per demo storefront with a screenshot of its home page. Empty when no demo store URL is configured. */
export function DemoStoreCards({ t, locale }: { t: Translator; locale: string }) {
  const stores = DEMO_STORES.map((s) => ({ ...s, href: demoStoreUrl(s.slug) })).filter((s) => s.href);
  if (stores.length === 0) return null;
  return (
    <RevealGroup className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {stores.map((s) => (
        <RevealItem key={s.slug} className="h-full">
          <Lift className="h-full">
            <Card className="group h-full gap-0 overflow-hidden rounded-2xl p-0 transition-shadow hover:shadow-www" data-demo-store={s.slug}>
              <a href={s.href!} target="_blank" rel="noopener noreferrer" className="block aspect-[16/10] overflow-hidden border-b bg-muted focus-ring" tabIndex={-1} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/demos/${s.slug}.webp`} alt="" width={640} height={400} loading="lazy" decoding="async" className="size-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]" />
              </a>
              <div className="flex flex-1 flex-col gap-3 p-5">
                <div className="space-y-1.5">
                  <h3 className="font-display text-lg font-semibold">{s.name}</h3>
                  <Badge variant="muted" lang={locale}>
                    {tradeName(s.trade, locale)}
                  </Badge>
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{t(`ind.${s.trade}`)}</p>
                <Button asChild variant="outline" className="mt-auto w-full rounded-full">
                  <a href={s.href!} target="_blank" rel="noopener noreferrer" aria-label={`${t("demo.stores.open")}: ${s.name}`}>
                    {t("demo.stores.open")}
                    <ExternalLinkIcon />
                  </a>
                </Button>
              </div>
            </Card>
          </Lift>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

/** Billing and business apps: a card per showcase shop with its history, what to look at, and the read-only sign-in button. */
export function DemoAppCards({ t, locale }: { t: Translator; locale: string }) {
  const nf = new Intl.NumberFormat(locale === "ta" ? "ta-IN" : "en-IN");
  return (
    <RevealGroup className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {DEMO_APPS.map((a) => (
        <RevealItem key={a.slug} className="h-full">
          <Lift className="h-full">
            <Card className="h-full gap-4 rounded-2xl p-5 transition-shadow hover:shadow-www" data-demo-app={a.slug}>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted">{t(`demo.app.${a.app}`)}</Badge>
                  <Badge variant="muted" lang={locale}>
                    {tradeName(a.trade, locale)}
                  </Badge>
                </div>
                <h3 className="font-display text-lg font-semibold">{a.name}</h3>
                <p className="text-sm font-medium text-primary">{t("demo.apps.bills", { n: nf.format(a.bills) })}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("demo.apps.lookAt")}</p>
                <ul className="grid gap-1.5">
                  {listOf(t, `demo.look.${a.app}`).map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm">
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-auto">
                <TryDemoButton shop={a.slug} name={a.name} />
              </div>
            </Card>
          </Lift>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}
