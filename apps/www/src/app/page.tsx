import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  BarChart3Icon,
  BookOpenCheckIcon,
  BoxesIcon,
  CheckIcon,
  GiftIcon,
  MessageCircleIcon,
  MonitorSmartphoneIcon,
  PrinterIcon,
  ReceiptIndianRupeeIcon,
  ScanBarcodeIcon,
  SmartphoneIcon,
  StoreIcon,
  LanguagesIcon,
  QrCodeIcon,
} from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { Card } from "@srirealtime/ui/components/card";
import { FadeIn, RevealGroup, RevealItem } from "@srirealtime/ui/motion";
import { getT } from "@/lib/i18n-server";
import { listOf } from "@/lib/messages";
import { pageMetadata } from "@/lib/seo";
import { HeroBackdrop, HeroHeadline, HeroVisual } from "@/components/hero";
import { InvoiceMockup, PhoneStoreMockup } from "@/components/mockups";
import { Lift, Marquee } from "@/components/motion-bits";
import { DemoBand, PosSection, StoreHighlights, TradesSection } from "@/components/home-sections";
import { Container, CtaBand, Eyebrow, FaqSection, FeatureGrid, HowItWorks, SectionHeading, Testimonials, TrialNotes, faqItems } from "@/components/sections";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: `Srirealtime: ${t("brand.tagline")}`, absoluteTitle: true, description: t("hero.sub"), path: "/", locale });
}

export default async function HomePage() {
  const { t, locale } = await getT();
  const strip = [
    { icon: <ReceiptIndianRupeeIcon />, label: t("strip.gst") },
    { icon: <LanguagesIcon />, label: t("strip.tamil") },
    { icon: <QrCodeIcon />, label: t("strip.upi") },
    { icon: <SmartphoneIcon />, label: t("strip.phone") },
    { icon: <PrinterIcon />, label: t("strip.print") },
    { icon: <StoreIcon />, label: t("strip.trades") },
    { icon: <ScanBarcodeIcon />, label: t("strip.counters") },
  ];
  const features = [
    { icon: <ReceiptIndianRupeeIcon />, title: t("features.gst.title"), body: t("features.gst.body") },
    { icon: <BookOpenCheckIcon />, title: t("features.credit.title"), body: t("features.credit.body"), tone: "bg-marigold/20 text-marigold-ink" },
    { icon: <MessageCircleIcon />, title: t("features.whatsapp.title"), body: t("features.whatsapp.body"), tone: "bg-[#25D366]/15 text-[#128C7E] dark:text-[#25D366]" },
    { icon: <ScanBarcodeIcon />, title: t("features.pos.title"), body: t("features.pos.body") },
    { icon: <BoxesIcon />, title: t("features.inventory.title"), body: t("features.inventory.body"), tone: "bg-leaf/15 text-leaf" },
    { icon: <StoreIcon />, title: t("features.store.title"), body: t("features.store.body"), tone: "bg-[oklch(0.6_0.17_340/0.14)] text-[oklch(0.5_0.17_340)] dark:text-[oklch(0.75_0.14_340)]" },
    { icon: <GiftIcon />, title: t("features.loyalty.title"), body: t("features.loyalty.body"), tone: "bg-marigold/20 text-marigold-ink" },
    { icon: <BarChart3Icon />, title: t("features.reports.title"), body: t("features.reports.body") },
  ];

  return (
    <>
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <HeroBackdrop />
        <Container className="grid items-center gap-10 [&>*]:min-w-0 pt-10 pb-16 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:pt-20 lg:pb-24">
          <div className="space-y-6">
            <FadeIn y={8}>
              <Eyebrow>{t("hero.eyebrow")}</Eyebrow>
            </FadeIn>
            <HeroHeadline />
            <FadeIn delay={0.1} y={8}>
              <p className="max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">{t("hero.sub")}</p>
            </FadeIn>
            <FadeIn delay={0.18} y={8} className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="group h-auto min-h-12 rounded-full px-7 py-2.5 text-base whitespace-normal" data-testid="hero-trial">
                <Link href="/signup">
                  {t("cta.trial")}
                  <ArrowRightIcon className="transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-auto min-h-12 rounded-full px-7 py-2.5 text-base whitespace-normal">
                <Link href="/pricing">{t("cta.pricing")}</Link>
              </Button>
            </FadeIn>
            <FadeIn delay={0.26} y={0}>
              <TrialNotes t={t} />
            </FadeIn>
          </div>
          <HeroVisual />
        </Container>
      </section>

      {/* Trust strip */}
      <div className="border-y bg-card/50 py-5">
        <Marquee>
          {strip.map((s) => (
            <span key={s.label} className="flex items-center gap-2 text-sm font-medium whitespace-nowrap text-muted-foreground [&_svg]:size-4.5 [&_svg]:text-primary">
              {s.icon}
              {s.label}
            </span>
          ))}
        </Marquee>
      </div>

      <TradesSection t={t} locale={locale} />
      <DemoBand t={t} />

      {/* Two products */}
      <section className="section-y" aria-labelledby="products-title">
        <Container>
          <SectionHeading id="products-title" eyebrow={t("products.eyebrow")} title={t("products.title")} body={t("products.body")} />
          <RevealGroup className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <RevealItem>
              <ProductCard
                href="/billing"
                icon={<ReceiptIndianRupeeIcon />}
                title={t("products.billing.title")}
                body={t("products.billing.body")}
                points={listOf(t, "products.billing.points")}
                cta={t("products.learnMore")}
                visual={<InvoiceMockup className="mx-auto w-full max-w-[340px] rotate-[-2deg]" />}
                tone="from-primary/15 via-primary/5"
              />
            </RevealItem>
            <RevealItem>
              <ProductCard
                href="/online-store"
                icon={<MonitorSmartphoneIcon />}
                title={t("products.store.title")}
                body={t("products.store.body")}
                points={listOf(t, "products.store.points")}
                cta={t("products.learnMore")}
                visual={<PhoneStoreMockup className="w-[230px] rotate-[2deg]" />}
                tone="from-marigold/25 via-marigold/5"
              />
            </RevealItem>
          </RevealGroup>
        </Container>
      </section>

      <PosSection t={t} />
      <StoreHighlights t={t} />

      {/* Feature grid */}
      <section className="section-y bg-tint" aria-labelledby="features-title">
        <Container>
          <SectionHeading id="features-title" eyebrow={t("features.eyebrow")} title={t("features.title")} />
          <FeatureGrid items={features} />
        </Container>
      </section>

      <HowItWorks t={t} />
      <Testimonials t={t} />
      <FaqSection t={t} items={faqItems(t, "faq.home", 13)} />
      <CtaBand t={t} />
    </>
  );
}

function ProductCard(props: { href: string; icon: React.ReactNode; title: string; body: string; points: string[]; cta: string; visual: React.ReactNode; tone: string }) {
  return (
    <Lift className="h-full">
      <Card className="group relative h-full gap-0 overflow-hidden rounded-[1.75rem] p-0">
        <div className={`relative flex h-[320px] items-start justify-center overflow-hidden bg-gradient-to-b ${props.tone} to-transparent px-6 pt-10`}>
          <div className="bg-grid absolute inset-0 opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true" />
          <div className="relative w-full transition-transform duration-500 group-hover:-translate-y-2 [&>*]:mx-auto">{props.visual}</div>
        </div>
        <div className="relative space-y-4 border-t bg-card p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground [&_svg]:size-5">{props.icon}</span>
            <h3 className="font-display text-2xl font-bold">{props.title}</h3>
          </div>
          <p className="text-muted-foreground">{props.body}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {props.points.map((p) => (
              <li key={p} className="flex items-start gap-2 text-sm">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
          <Button asChild variant="link" className="h-auto px-0 text-base">
            <Link href={props.href} className="group/link">
              {props.cta}
              <ArrowRightIcon className="transition-transform group-hover/link:translate-x-1" />
            </Link>
          </Button>
        </div>
      </Card>
    </Lift>
  );
}
