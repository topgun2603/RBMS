import Link from "next/link";
import { ArrowRightIcon, CheckIcon, DownloadIcon, LanguagesIcon, LayoutTemplateIcon, LogInIcon, MapPinIcon, PlayCircleIcon, SmartphoneIcon, WalletIcon } from "lucide-react";
import type { Translator } from "@rbms/i18n/client";
import { Badge } from "@rbms/ui/components/badge";
import { Button } from "@rbms/ui/components/button";
import { Card } from "@rbms/ui/components/card";
import { Reveal } from "@rbms/ui/motion";
import { listOf } from "@/lib/messages";
import { CONTACT_EMAIL } from "@/lib/site";
import { ALL_TRADES, HOME_TRADES, tradeName } from "@/lib/trades";
import { PosMockup } from "./mockups";
import { Container, FeatureGrid, SectionHeading } from "./sections";
import { TradeCards } from "./trades";

/** Home: "every trade" is the headline story. */
export function TradesSection({ t, locale }: { t: Translator; locale: string }) {
  const rest = ALL_TRADES.filter((id) => !HOME_TRADES.includes(id));
  return (
    <section className="section-y bg-tint" aria-labelledby="trades-title">
      <Container>
        <SectionHeading id="trades-title" eyebrow={t("trades.eyebrow")} title={t("trades.title")} body={t("trades.body")} />
        <TradeCards ids={HOME_TRADES} t={t} locale={locale} />
        <Reveal className="mt-8 space-y-5 text-center">
          <p className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("trades.also")}:</span>
            {rest.map((id) => (
              <Badge key={id} variant="muted" lang={locale}>
                {tradeName(id, locale)}
              </Badge>
            ))}
          </p>
          <Button asChild variant="outline" className="group h-auto min-h-11 rounded-full px-6 py-2 whitespace-normal">
            <Link href="/industries">
              {t("trades.all")}
              <ArrowRightIcon className="transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">{t("trades.custom")}</p>
        </Reveal>
      </Container>
    </section>
  );
}

/** Home: a short "see it live" band linking to /demo. */
export function DemoBand({ t }: { t: Translator }) {
  return (
    <section className="section-y" aria-labelledby="demo-band-title">
      <Container>
        <Reveal>
          <Card className="flex-col items-start gap-5 rounded-[1.75rem] bg-tint p-6 sm:flex-row sm:items-center sm:gap-8 sm:p-10">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground [&_svg]:size-7">
              <PlayCircleIcon />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <h2 id="demo-band-title" className="text-h2 text-balance">{t("demo.band.title")}</h2>
              <p className="max-w-2xl text-muted-foreground">{t("demo.band.body")}</p>
            </div>
            <Button asChild size="lg" className="group h-auto min-h-11 shrink-0 rounded-full px-6 py-2 whitespace-normal">
              <Link href="/demo">
                {t("demo.band.cta")}
                <ArrowRightIcon className="transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
          </Card>
        </Reveal>
      </Container>
    </section>
  );
}

/** Multi-counter POS and the weighing station. */
export function PosSection({ t }: { t: Translator }) {
  return (
    <section className="section-y bg-tint" aria-labelledby="pos-title">
      <Container className="grid items-center gap-10 [&>*]:min-w-0 lg:grid-cols-2">
        <Reveal className="space-y-5">
          <p className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-semibold text-primary">
            <span className="size-1.5 rounded-full bg-marigold" aria-hidden="true" />
            {t("pos.eyebrow")}
          </p>
          <h2 id="pos-title" className="text-h2 text-balance">{t("pos.title")}</h2>
          <p className="max-w-lg text-base text-pretty text-muted-foreground sm:text-lg">{t("pos.body")}</p>
          <ul className="grid gap-2.5">
            {listOf(t, "pos.points").map((p) => (
              <li key={p} className="flex items-start gap-2 text-sm">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{t("pos.note")}</p>
          <Button asChild variant="link" className="h-auto px-0 text-base">
            <Link href="/billing" className="group/link">
              {t("pos.cta")}
              <ArrowRightIcon className="transition-transform group-hover/link:translate-x-1" />
            </Link>
          </Button>
        </Reveal>
        <Reveal className="flex justify-center">
          <PosMockup />
        </Reveal>
      </Container>
    </section>
  );
}

/** Online store highlights plus the Android app (early access). */
export function StoreHighlights({ t }: { t: Translator }) {
  const items = [
    { icon: <LayoutTemplateIcon />, key: 1 },
    { icon: <LanguagesIcon />, key: 2, tone: "bg-marigold/20 text-marigold-ink" },
    { icon: <DownloadIcon />, key: 3, tone: "bg-leaf/15 text-leaf" },
    { icon: <LogInIcon />, key: 4 },
    { icon: <WalletIcon />, key: 5, tone: "bg-marigold/20 text-marigold-ink" },
    { icon: <MapPinIcon />, key: 6, tone: "bg-leaf/15 text-leaf" },
  ].map((i) => ({ icon: i.icon, tone: i.tone, title: t(`storehl.${i.key}.title`), body: t(`storehl.${i.key}.body`) }));
  const mail = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t("mobile.mailSubject"))}`;
  return (
    <section className="section-y" aria-labelledby="storehl-title">
      <Container>
        <SectionHeading id="storehl-title" eyebrow={t("storehl.eyebrow")} title={t("storehl.title")} body={t("storehl.body")} />
        <FeatureGrid items={items} cols={3} />
        <Reveal className="mt-6 text-center">
          <Button asChild variant="link" className="h-auto text-base">
            <Link href="/online-store" className="group/link">
              {t("storehl.more")}
              <ArrowRightIcon className="transition-transform group-hover/link:translate-x-1" />
            </Link>
          </Button>
        </Reveal>
        <Reveal className="mt-10">
          <Card className="flex-col items-start gap-4 rounded-[1.75rem] p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-8">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground [&_svg]:size-6">
              <SmartphoneIcon />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-xl font-bold">{t("mobile.title")}</h3>
                <Badge variant="warning">{t("mobile.badge")}</Badge>
              </div>
              <p className="text-muted-foreground">{t("mobile.body")}</p>
            </div>
            <Button asChild variant="outline" className="h-auto min-h-11 shrink-0 rounded-full px-6 py-2 whitespace-normal">
              <a href={mail}>{t("mobile.cta")}</a>
            </Button>
          </Card>
        </Reveal>
      </Container>
    </section>
  );
}
