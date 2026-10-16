import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon, MinusIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { Card } from "@srirealtime/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@srirealtime/ui/components/table";
import { FadeIn, Reveal } from "@srirealtime/ui/motion";
import { getT } from "@/lib/i18n-server";
import { pageMetadata } from "@/lib/seo";
import { compareTable, parseInterval, planName, visiblePlans, type Plan } from "@/lib/plans";
import { fetchPlans } from "@/lib/plans-server";
import { CONTACT_EMAIL, SITE_URL, parseApp } from "@/lib/site";
import { PricingCards } from "@/components/pricing-view";
import { HeroBackdrop } from "@/components/hero";
import { JsonLd } from "@/components/json-ld";
import { Container, CtaBand, Eyebrow, FaqSection, SectionHeading, faqItems } from "@/components/sections";
import type { Translator } from "@srirealtime/i18n/client";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: t("pricing.meta.title"), description: t("pricing.meta.description"), path: "/pricing", locale });
}

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PricingPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { t, locale } = await getT();
  const all = await fetchPlans();
  const plans = all ? visiblePlans(all) : null;
  const app = parseApp(one(sp.app));
  const interval = parseInterval(one(sp.interval));

  return (
    <>
      {plans && <JsonLd data={offersJsonLd(plans, t)} />}
      <section className="relative isolate overflow-hidden">
        <HeroBackdrop />
        <Container className="pt-12 pb-16 sm:pt-20">
          <div className="mx-auto mb-10 max-w-2xl space-y-5 text-center">
            <FadeIn y={8}>
              <Eyebrow>{t("pricing.eyebrow")}</Eyebrow>
            </FadeIn>
            <h1 className="text-display text-balance">{t("pricing.title")}</h1>
            <FadeIn delay={0.1} y={8}>
              <p className="text-lg text-muted-foreground">{t("pricing.sub")}</p>
            </FadeIn>
          </div>
          {plans && plans.length ? (
            <PricingCards plans={plans} app={app} initialInterval={interval} />
          ) : (
            <Card className="mx-auto max-w-md items-center gap-4 rounded-2xl p-8 text-center" role="alert" data-testid="plans-error">
              <p className="font-medium">{t("pricing.loadError")}</p>
              <Button asChild variant="outline">
                <Link href="/pricing">
                  <RefreshCwIcon />
                  {t("pricing.retry")}
                </Link>
              </Button>
            </Card>
          )}
          <p className="mt-10 text-center text-sm text-muted-foreground">
            {t("pricing.enterprise")}{" "}
            <a className="font-medium text-primary underline-offset-4 hover:underline" href={`mailto:${CONTACT_EMAIL}?subject=Enterprise`}>
              {t("pricing.enterpriseCta")}
            </a>
          </p>
        </Container>
      </section>

      {plans && plans.length > 0 && <CompareSection plans={plans} t={t} locale={locale} />}
      <FaqSection t={t} items={faqItems(t, "faq.pricing", 5)} />
      <CtaBand t={t} />
    </>
  );
}

function CompareSection({ plans, t, locale }: { plans: Plan[]; t: Translator; locale: string }) {
  const groups = compareTable(plans, t, locale);
  return (
    <section className="section-y bg-tint" aria-labelledby="compare-title">
      <Container className="max-w-5xl">
        <SectionHeading id="compare-title" title={t("pricing.compare")} body={t("pricing.compareSub")} />
        <Reveal>
          <Card className="gap-0 overflow-hidden rounded-2xl py-0">
            <Table className="table-fixed" data-testid="compare-table">
              <colgroup>
                <col className="w-[40%]" />
                {plans.map((p) => (
                  <col key={p.id} />
                ))}
              </colgroup>
              <TableHeader className="bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-14 bg-card px-3 sm:px-4">{t("pricing.feature")}</TableHead>
                  {plans.map((p) => (
                    <TableHead key={p.id} className="h-14 px-1 text-center font-display text-sm font-bold whitespace-normal text-foreground normal-case">
                      {planName(t, p)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <GroupRows key={g.key} label={g.label} rows={g.rows} cols={plans.length} t={t} />
                ))}
              </TableBody>
            </Table>
          </Card>
        </Reveal>
        <p className="mt-4 text-center text-sm text-muted-foreground">{t("pricing.gstNote")}</p>
      </Container>
    </section>
  );
}

function GroupRows({ label, rows, cols, t }: { label: string; rows: ReturnType<typeof compareTable>[number]["rows"]; cols: number; t: Translator }) {
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell colSpan={cols + 1} className="px-3 sm:px-4 py-2.5 text-xs font-semibold tracking-wide text-primary uppercase">
          {label}
        </TableCell>
      </TableRow>
      {rows.map((r) => (
        <TableRow key={r.key}>
          <TableCell className="px-3 py-3 whitespace-normal sm:px-4">{r.label}</TableCell>
          {r.values.map((v, i) => (
            <TableCell key={i} className="px-1 py-3 text-center text-xs sm:text-sm whitespace-normal">
              {v.kind === "text" ? (
                <span className="font-medium tabular-nums">{v.text}</span>
              ) : v.on ? (
                <CheckIcon className="mx-auto size-5 text-success" aria-label={t("pricing.included")} />
              ) : (
                <MinusIcon className="mx-auto size-4 text-muted-foreground/50" aria-label={t("pricing.notIncluded")} />
              )}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function offersJsonLd(plans: Plan[], t: Translator) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Srirealtime",
    description: t("brand.tagline"),
    brand: { "@type": "Brand", name: "Srirealtime" },
    url: `${SITE_URL}/pricing`,
    offers: plans.flatMap((p) =>
      (["monthly", "yearly"] as const)
        .filter((iv) => iv === "monthly" || p.priceYearlyPaise > 0)
        .map((iv) => ({
          "@type": "Offer",
          name: `${p.name} (${iv})`,
          price: ((iv === "yearly" ? p.priceYearlyPaise : p.priceMonthlyPaise) / 100).toFixed(2),
          priceCurrency: "INR",
          url: `${SITE_URL}/signup?plan=${p.id}&interval=${iv}`,
          availability: "https://schema.org/InStock",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: ((iv === "yearly" ? p.priceYearlyPaise : p.priceMonthlyPaise) / 100).toFixed(2),
            priceCurrency: "INR",
            valueAddedTaxIncluded: false,
            billingDuration: iv === "yearly" ? "P1Y" : "P1M",
          },
        })),
    ),
  };
}
