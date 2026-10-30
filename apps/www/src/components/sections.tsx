import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, QuoteIcon } from "lucide-react";
import type { Translator } from "@rbms/i18n/client";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@rbms/ui/components/accordion";
import { Badge } from "@rbms/ui/components/badge";
import { Button } from "@rbms/ui/components/button";
import { Card } from "@rbms/ui/components/card";
import { Reveal, RevealGroup, RevealItem } from "@rbms/ui/motion";
import { cn } from "@rbms/ui/lib/utils";
import { DrawLine, Lift, PopIn } from "./motion-bits";
import { JsonLd } from "./json-ld";

export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6", className)} {...props} />;
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-semibold text-primary backdrop-blur", className)}>
      <span className="size-1.5 rounded-full bg-marigold" aria-hidden="true" />
      {children}
    </p>
  );
}

export function SectionHeading({ eyebrow, title, body, center = true, id }: { eyebrow?: string; title: string; body?: string; center?: boolean; id?: string }) {
  return (
    <Reveal className={cn("mb-10 max-w-2xl space-y-4 sm:mb-14", center && "mx-auto text-center")}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 id={id} className="text-h2 text-balance">
        {title}
      </h2>
      {body && <p className="text-base text-pretty text-muted-foreground sm:text-lg">{body}</p>}
    </Reveal>
  );
}

export interface FeatureItem {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone?: string;
}

/** Icon cards that stagger in and lift on hover. */
export function FeatureGrid({ items, cols = 4 }: { items: FeatureItem[]; cols?: 3 | 4 }) {
  return (
    <RevealGroup className={cn("grid gap-4 sm:grid-cols-2", cols === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
      {items.map((f) => (
        <RevealItem key={f.title} className="h-full">
          <Lift className="h-full">
            <Card className="group h-full gap-3 rounded-2xl p-6 transition-shadow hover:shadow-www">
              <span className={cn("flex size-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 [&_svg]:size-5", f.tone ?? "bg-primary/10 text-primary")}>{f.icon}</span>
              <h3 className="font-display text-lg font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </Card>
          </Lift>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

export function HowItWorks({ t }: { t: Translator }) {
  const steps = [1, 2, 3];
  return (
    <section className="section-y" aria-labelledby="how-title">
      <Container>
        <SectionHeading id="how-title" eyebrow={t("how.eyebrow")} title={t("how.title")} />
        <div className="relative">
          <DrawLine className="absolute top-7 right-[16%] left-[16%] hidden h-0.5 rounded-full md:block" />
          <RevealGroup as="ol" className="relative grid gap-8 md:grid-cols-3">
            {steps.map((n, i) => (
              <RevealItem as="li" key={n} className="flex flex-col items-center text-center">
                <PopIn delay={0.2 + i * 0.25} className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary font-display text-xl font-bold text-primary-foreground shadow-www ring-8 ring-background">
                  {n}
                </PopIn>
                <h3 className="mb-2 font-display text-lg font-semibold">{t(`how.${n}.title`)}</h3>
                <p className="max-w-xs text-sm text-muted-foreground">{t(`how.${n}.body`)}</p>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </Container>
    </section>
  );
}

export function Testimonials({ t }: { t: Translator }) {
  return (
    <section className="section-y bg-tint" aria-labelledby="stories-title">
      <Container>
        <SectionHeading id="stories-title" eyebrow={t("testimonials.eyebrow")} title={t("testimonials.title")} body={t("testimonials.placeholder")} />
        <RevealGroup className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <RevealItem key={n}>
              <Lift className="h-full">
                <Card className="relative h-full gap-4 rounded-2xl border-dashed p-6" data-placeholder="true">
                  <Badge variant="muted" className="absolute top-4 right-4">
                    {t("legal.placeholder")}
                  </Badge>
                  <QuoteIcon className="size-7 text-marigold" aria-hidden="true" />
                  <blockquote className="text-base text-pretty">{t(`testimonials.${n}.quote`)}</blockquote>
                  <p className="mt-auto text-sm text-muted-foreground">{t(`testimonials.${n}.who`)}</p>
                </Card>
              </Lift>
            </RevealItem>
          ))}
        </RevealGroup>
      </Container>
    </section>
  );
}

export interface FaqItem {
  q: string;
  a: string;
}

export const faqItems = (t: Translator, prefix: string, n: number): FaqItem[] =>
  Array.from({ length: n }, (_, i) => ({ q: t(`${prefix}.${i + 1}.q`), a: t(`${prefix}.${i + 1}.a`) }));

/** FAQ accordion + FAQPage JSON-LD. */
export function FaqSection({ t, items, title }: { t: Translator; items: FaqItem[]; title?: string }) {
  return (
    <section className="section-y" aria-labelledby="faq-title">
      <Container className="max-w-3xl">
        <SectionHeading id="faq-title" eyebrow={t("faq.eyebrow")} title={title ?? t("faq.title")} />
        <Reveal>
          <Card className="rounded-2xl px-2 py-2 sm:px-6">
            <Accordion type="single" collapsible defaultValue="q0">
              {items.map((f, i) => (
                <AccordionItem key={f.q} value={`q${i}`}>
                  <AccordionTrigger className="text-left text-base">{f.q}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Card>
        </Reveal>
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
          }}
        />
      </Container>
    </section>
  );
}

/** Closing call to action on a gradient band. */
export function CtaBand({ t, href = "/signup" }: { t: Translator; href?: string }) {
  return (
    <section className="px-4 pb-[var(--www-section)] sm:px-6">
      <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-[linear-gradient(120deg,oklch(0.42_0.2_272),oklch(0.5_0.2_300)_55%,oklch(0.68_0.17_45))] px-6 py-14 text-center text-white shadow-www sm:px-12 sm:py-20">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" aria-hidden="true" />
        <div className="relative mx-auto max-w-2xl space-y-5">
          <h2 className="text-h2 text-balance">{t("cta.title")}</h2>
          <p className="text-base text-pretty text-white/85 sm:text-lg">{t("cta.body")}</p>
          <div className="flex flex-col items-center justify-center gap-3 pt-2 sm:flex-row">
            <Button asChild size="lg" className="group h-auto min-h-12 w-full rounded-full bg-white px-7 py-2.5 text-base whitespace-normal text-neutral-900 shadow-lg hover:bg-white/90 sm:w-auto">
              <Link href={href}>
                {t("cta.trial")}
                <ArrowRightIcon className="transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="h-auto min-h-12 w-full rounded-full py-2.5 text-base whitespace-normal text-white hover:bg-white/15 hover:text-white sm:w-auto">
              <Link href="/pricing">{t("cta.pricing")}</Link>
            </Button>
          </div>
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-2 text-sm text-white/85">
            {[t("cta.noCard"), t("cta.cancelAnytime"), t("cta.tamil")].map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <CheckIcon className="size-4" aria-hidden="true" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </section>
  );
}

/** Trial reassurance line under hero buttons. */
export function TrialNotes({ t, className }: { t: Translator; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground", className)}>
      {[t("cta.noCard"), t("cta.cancelAnytime"), t("cta.tamil")].map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <CheckIcon className="size-4 text-success" aria-hidden="true" />
          {s}
        </li>
      ))}
    </ul>
  );
}
