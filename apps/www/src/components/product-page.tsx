import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import type { Translator } from "@rbms/i18n/client";
import { Button } from "@rbms/ui/components/button";
import { Card } from "@rbms/ui/components/card";
import { FadeIn, Reveal } from "@rbms/ui/motion";
import { SITE_URL } from "@/lib/site";
import { HeroBackdrop, HeroVisual } from "./hero";
import { Lift } from "./motion-bits";
import { Container, CtaBand, Eyebrow, FaqSection, FeatureGrid, SectionHeading, TrialNotes, type FaqItem, type FeatureItem } from "./sections";
import { JsonLd } from "./json-ld";

export interface ProductPageProps {
  t: Translator;
  product: "billing" | "store";
  path: string;
  features: FeatureItem[];
  mock: React.ReactNode;
  faq: FaqItem[];
}

/** /billing and /online-store: hero, mockup band, feature grid, cross-link, FAQ, CTA. */
export function ProductPage({ t, product, path, features, mock, faq }: ProductPageProps) {
  const p = product;
  const app = p === "billing" ? "billing" : "store";
  const other = p === "billing" ? { href: "/online-store", title: t("products.store.title"), body: t("products.store.body") } : { href: "/billing", title: t("products.billing.title"), body: t("products.billing.body") };
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: t(`${p}.eyebrow`),
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web, Android, iOS",
          url: `${SITE_URL}${path}`,
          description: t(`${p}.meta.description`),
          offers: { "@type": "Offer", price: "0", priceCurrency: "INR", description: t("pricing.trialNote") },
        }}
      />
      <section className="relative isolate overflow-hidden">
        <HeroBackdrop />
        <Container className="grid items-center gap-10 [&>*]:min-w-0 pt-10 pb-16 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:pt-20 lg:pb-24">
          <div className="space-y-6">
            <FadeIn y={8}>
              <Eyebrow>{t(`${p}.eyebrow`)}</Eyebrow>
            </FadeIn>
            <h1 className="text-display text-balance">{t(`${p}.title`)}</h1>
            <FadeIn delay={0.1} y={8}>
              <p className="max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">{t(`${p}.sub`)}</p>
            </FadeIn>
            <FadeIn delay={0.18} y={8} className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="group h-auto min-h-12 rounded-full px-7 py-2.5 text-base whitespace-normal">
                <Link href={`/signup?app=${app}`}>
                  {t("cta.trial")}
                  <ArrowRightIcon className="transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-auto min-h-12 rounded-full px-7 py-2.5 text-base whitespace-normal">
                <Link href={`/pricing?app=${app}`}>{t("cta.pricing")}</Link>
              </Button>
            </FadeIn>
            <TrialNotes t={t} />
          </div>
          <HeroVisual variant={p} />
        </Container>
      </section>

      <section className="section-y bg-tint" aria-labelledby="features-title">
        <Container>
          <SectionHeading id="features-title" eyebrow={t(`${p}.eyebrow`)} title={t("product.everything")} />
          <FeatureGrid items={features} cols={3} />
        </Container>
      </section>

      <section className="section-y" aria-labelledby="mock-title">
        <Container className="grid items-center gap-10 [&>*]:min-w-0 lg:grid-cols-2">
          <Reveal className="space-y-4">
            <h2 id="mock-title" className="text-h2 text-balance">
              {t(`${p}.mock.title`)}
            </h2>
            <p className="max-w-lg text-lg text-muted-foreground">{t(`${p}.mock.body`)}</p>
          </Reveal>
          <Reveal className="flex justify-center">{mock}</Reveal>
        </Container>
      </section>

      <section className="pb-[var(--www-section)]">
        <Container>
          <Reveal>
            <Lift>
              <Link href={other.href} className="group block rounded-[1.75rem] focus-ring">
                <Card className="flex-row items-center gap-6 rounded-[1.75rem] p-6 sm:p-8">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium text-primary">{t("product.alsoTry")}</p>
                    <p className="font-display text-xl font-bold">{other.title}</p>
                    <p className="text-muted-foreground">{other.body}</p>
                  </div>
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform group-hover:translate-x-1">
                    <ArrowRightIcon className="size-5" />
                  </span>
                </Card>
              </Link>
            </Lift>
          </Reveal>
        </Container>
      </section>

      <FaqSection t={t} items={faq} title={t("product.faq", { product: t(p === "billing" ? "nav.billing" : "nav.onlineStore") })} />
      <CtaBand t={t} href={`/signup?app=${app}`} />
    </>
  );
}
