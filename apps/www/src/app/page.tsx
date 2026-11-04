import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@rbms/ui/components/button";
import { FadeIn } from "@rbms/ui/motion";
import { getT } from "@/lib/i18n-server";
import { planForTier, POPULAR_TIER } from "@/lib/plans";
import { fetchPlans } from "@/lib/plans-server";
import { pageMetadata } from "@/lib/seo";
import { HeroDemo } from "@/components/home/hero-demo";
import { Kolam } from "@/components/home/kolam";
import { RippleSection } from "@/components/home/ripple";
import { SaleProvider } from "@/components/home/sale";
import { FactTape, FinalCta, LanguageSection, PriceSlip, ProofSection, ScreensSection, SignboardsSection, StoresSection, SwitchBand, TwoProducts } from "@/components/home/sections";
import { Container, FaqSection, TrialNotes, faqItems } from "@/components/sections";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: `RBMS: ${t("brand.tagline")}`, absoluteTitle: true, description: t("hero.sub"), path: "/", locale });
}

export default async function HomePage() {
  const { t, locale } = await getT();
  const [billingPlans, storePlans] = await Promise.all([fetchPlans("BL"), fetchPlans("EC")]);
  const billing = billingPlans ? planForTier(billingPlans, POPULAR_TIER) : null;
  const store = storePlans ? planForTier(storePlans, POPULAR_TIER) : null;

  return (
    <SaleProvider>
      <section className="band-turmeric relative isolate overflow-hidden" data-testid="hero">
        <Kolam cols={9} rows={7} strokeWidth={2} className="absolute -right-40 -bottom-32 -z-10 hidden w-[44rem] max-w-none text-foreground/15 lg:block" />
        <Container className="grid items-start gap-10 [&>*]:min-w-0 pt-8 pb-14 sm:pt-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-8 lg:pt-14 lg:pb-20">
          <div className="lg:sticky lg:top-24">
            <FadeIn y={8}>
              <p className="mb-5 max-w-lg font-mono text-xs font-bold tracking-wide text-foreground sm:text-sm">{t("home.eyebrow")}</p>
            </FadeIn>
            <h1 className="text-poster">
              <span className="block">{t("home.h1.1")}</span>
              <span className="block text-primary">{t("home.h1.2")}</span>
              <span className="block">{t("home.h1.3")}</span>
            </h1>
            <FadeIn delay={0.1} y={8}>
              <p className="mt-6 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">{t("home.sub")}</p>
            </FadeIn>
            <FadeIn delay={0.18} y={8} className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button asChild size="lg" className="group h-auto min-h-13 rounded-full px-8 py-3 text-base font-bold whitespace-normal" data-testid="hero-trial">
                <Link href="/signup">
                  {t("cta.trial")}
                  <ArrowRightIcon className="transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-auto min-h-13 rounded-full border-[1.5px] border-foreground bg-transparent px-8 py-3 text-base font-bold whitespace-normal">
                <Link href="/pricing">{t("cta.pricing")}</Link>
              </Button>
            </FadeIn>
            <FadeIn delay={0.26} y={0} className="mt-5">
              <TrialNotes t={t} className="text-foreground [&_svg]:!text-foreground" />
            </FadeIn>
          </div>
          <HeroDemo />
        </Container>
      </section>

      <FactTape t={t} />
      <TwoProducts t={t} billing={billing} store={store} />
      <StoresSection t={t} />
      <RippleSection />
      <LanguageSection t={t} />
      <SignboardsSection t={t} locale={locale} />
      <ScreensSection t={t} />
      <ProofSection t={t} locale={locale} />
      <PriceSlip t={t} billing={billing} store={store} />
      <SwitchBand t={t} />
      <FaqSection t={t} items={faqItems(t, "faq.home", 13)} />
      <FinalCta t={t} />
    </SaleProvider>
  );
}
