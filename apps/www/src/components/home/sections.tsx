import Link from "next/link";
import { ArrowRightIcon, CheckIcon, ExternalLinkIcon } from "lucide-react";
import type { Translator } from "@rbms/i18n/client";
import { Button } from "@rbms/ui/components/button";
import { Reveal } from "@rbms/ui/motion";
import { cn } from "@rbms/ui/lib/utils";
import { DEMO_APPS, DEMO_STORES } from "@/lib/demos";
import { listOf } from "@/lib/messages";
import { billMoneyWhole } from "@/lib/plans-money";
import { demoStoreUrl } from "@/lib/site";
import { ALL_TRADES, tradeName, type BusinessType } from "@/lib/trades";
import type { Plan } from "@/lib/plans";
import { TryDemoButton } from "../demo-button";
import { Container } from "../sections";
import { TRADE_ICONS } from "../trades";
import { Kolam } from "./kolam";

/** A looping band of content; pauses on hover, and with reduced motion becomes a row you can scroll. */
function Tape({ children, seconds = 50, reverse, className }: { children: React.ReactNode; seconds?: number; reverse?: boolean; className?: string }) {
  return (
    <div className={cn("tape overflow-hidden", className)}>
      <div className={cn("tape-track flex w-max", reverse && "tape-reverse")} style={{ animationDuration: `${seconds}s` }}>
        <div className="flex shrink-0">{children}</div>
        <div className="tape-copy flex shrink-0" aria-hidden="true">{children}</div>
      </div>
    </div>
  );
}

/** The ink ticker under the hero. */
export function FactTape({ t }: { t: Translator }) {
  const facts = [t("strip.gst"), t("strip.tamil"), t("strip.upi"), t("strip.phone"), t("strip.print"), t("home.tape.trades", { n: ALL_TRADES.length }), t("strip.counters")];
  return (
    <Tape seconds={38} className="bg-kungumam py-3 text-white">
      {facts.map((f) => (
        <span key={f} className="flex items-center gap-6 pr-6 font-mono text-sm font-bold whitespace-nowrap">
          {f}
          <span aria-hidden="true">✶</span>
        </span>
      ))}
    </Tape>
  );
}

const TERMS: [string, string][] = [
  ["பில்", "Bill"],
  ["கடன் கணக்கு", "Credit book"],
  ["இருப்பு", "Stock"],
  ["வாடிக்கையாளர்கள்", "Customers"],
  ["கொள்முதல்", "Purchases"],
  ["அறிக்கைகள்", "Reports"],
  ["செலவுகள்", "Expenses"],
  ["பொருட்கள்", "Items"],
];

/** Tamil at poster size, with the real Tamil dashboard behind it. */
export function LanguageSection({ t }: { t: Translator }) {
  return (
    <section className="relative isolate overflow-hidden bg-ink py-[var(--www-section)] text-paper" aria-labelledby="lang-title">
      <Kolam cols={9} rows={5} strokeWidth={2} className="absolute -top-10 -right-24 -z-10 w-[46rem] max-w-none text-turmeric/25" />
      <Container className="grid items-center gap-10 [&>*]:min-w-0 lg:grid-cols-2 lg:gap-14">
        <Reveal>
          <p className="mb-4 font-mono text-xs font-semibold tracking-wide text-turmeric">{t("home.lang.eyebrow")}</p>
          <h2 id="lang-title" className="text-poster-md text-paper">{t("home.lang.title")}</h2>
          <p className="mt-5 max-w-lg text-pretty text-paper/75 sm:text-lg">{t("home.lang.body")}</p>
          <ul className="mt-7 grid max-w-lg gap-2.5 text-sm">
            {[t("home.lang.p1"), t("home.lang.p2"), t("home.lang.p3")].map((p) => (
              <li key={p} className="flex items-start gap-2">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-turmeric" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal>
          <figure className="overflow-hidden rounded-xl border border-paper/20 shadow-[0_40px_80px_-30px_black] lg:rotate-[1.5deg]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/product/dashboard-ta.jpg" alt={t("home.lang.shotAlt")} width={2000} height={1132} loading="lazy" decoding="async" className="block h-auto w-full" />
          </figure>
        </Reveal>
      </Container>
      <Tape seconds={46} className="mt-12 sm:mt-16">
        {TERMS.map(([ta, en]) => (
          <span key={en} className="flex items-baseline gap-3 pr-12 whitespace-nowrap">
            <span lang="ta" className="font-poster text-5xl leading-[1.45] font-extrabold text-turmeric sm:text-7xl sm:leading-[1.45]">{ta}</span>
            <span className="font-mono text-xs text-paper/60">{en}</span>
          </span>
        ))}
      </Tape>
    </section>
  );
}

const BOARDS = [
  "bg-kungumam text-white",
  "bg-turmeric text-ink",
  "bg-peacock text-paper",
  "bg-ink text-turmeric",
  "bg-[oklch(0.93_0.04_90)] text-kungumam",
  "bg-[oklch(0.42_0.13_150)] text-paper",
];

function Board({ id, i, locale }: { id: BusinessType; i: number; locale: string }) {
  const Icon = TRADE_ICONS[id];
  const second = locale === "ta" ? "en" : "ta";
  return (
    <div className="pr-3">
      <div className={cn("flex h-24 min-w-52 items-center gap-3 rounded-md p-1.5 sm:h-28", BOARDS[i % BOARDS.length])}>
        <div className="flex h-full w-full items-center gap-3 rounded-[0.2rem] border-2 border-current/50 px-4">
          <Icon className="size-7 shrink-0" />
          <div className="whitespace-nowrap">
            <p className="font-poster text-2xl leading-tight font-extrabold sm:text-3xl" lang={locale}>{tradeName(id, locale)}</p>
            <p className="text-xs opacity-85" lang={second} aria-hidden="true">{tradeName(id, second)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Every trade as a painted shop sign, three rows moving past. */
export function SignboardsSection({ t, locale }: { t: Translator; locale: string }) {
  const n = ALL_TRADES.length;
  const rows = [0, 1, 2].map((r) => ALL_TRADES.filter((_, i) => i % 3 === r));
  return (
    <section className="section-y overflow-hidden" aria-labelledby="boards-title">
      <Container className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <Reveal className="max-w-3xl">
          <p className="mb-4 font-mono text-xs font-semibold tracking-wide text-primary">{t("home.boards.eyebrow")}</p>
          <h2 id="boards-title" className="text-poster-md">{t("home.boards.title")}</h2>
          <p className="mt-4 max-w-2xl text-pretty text-muted-foreground sm:text-lg">{t("home.boards.body", { n })}</p>
        </Reveal>
        <Button asChild variant="outline" className="group h-auto min-h-11 shrink-0 self-start rounded-full border-[1.5px] border-foreground px-6 py-2 font-bold whitespace-normal lg:self-end">
          <Link href="/industries">
            {t("home.boards.cta", { n })}
            <ArrowRightIcon className="transition-transform group-hover:translate-x-1" />
          </Link>
        </Button>
      </Container>
      <div className="grid gap-3" data-testid="signboards">
        {rows.map((row, r) => (
          <Tape key={r} seconds={70 + r * 14} reverse={r === 1}>
            {row.map((id, i) => (
              <Board key={id} id={id} i={i + r * 2} locale={locale} />
            ))}
          </Tape>
        ))}
      </div>
    </section>
  );
}

const SHOTS = [
  { src: "kitchen-display", w: 1366, h: 810, key: "kitchen", cls: "lg:col-span-7" },
  { src: "credit-book", w: 1400, h: 850, key: "credit", cls: "lg:col-span-5" },
  { src: "weighing-station", w: 1366, h: 800, key: "weigh", cls: "lg:col-span-5" },
  { src: "gst-report", w: 1400, h: 850, key: "gst", cls: "lg:col-span-7" },
];

/** Real screens from the demo shops, not drawings of them. */
export function ScreensSection({ t }: { t: Translator }) {
  return (
    <section className="section-y band-peacock" aria-labelledby="screens-title">
      <Container>
        <Reveal className="mb-10 max-w-3xl">
          <p className="mb-4 font-mono text-xs font-semibold tracking-wide text-primary">{t("home.screens.eyebrow")}</p>
          <h2 id="screens-title" className="text-poster-md">{t("home.screens.title")}</h2>
          <p className="mt-4 max-w-2xl text-pretty text-muted-foreground sm:text-lg">{t("home.screens.body")}</p>
        </Reveal>
        <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-12">
          {SHOTS.map((s) => (
            <Reveal key={s.key} className={s.cls}>
              <figure className="band-paper group flex h-full flex-col overflow-hidden rounded-2xl border-[1.5px] border-foreground bg-card shadow-[6px_6px_0_var(--foreground)] transition-transform duration-300 hover:-translate-x-0.5 hover:-translate-y-0.5">
                <figcaption className="border-b-[1.5px] border-foreground p-4 sm:p-5">
                  <p className="font-display text-lg font-bold">{t(`home.screens.${s.key}.title`)}</p>
                  <p className="mt-1 text-sm text-pretty text-muted-foreground">{t(`home.screens.${s.key}.body`)}</p>
                </figcaption>
                <div className="relative aspect-[16/9] flex-1 overflow-hidden lg:aspect-auto lg:min-h-96">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/product/${s.src}.jpg`} alt={t(`home.screens.${s.key}.title`)} width={s.w} height={s.h} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover object-left-top transition-transform duration-700 group-hover:scale-[1.03] motion-reduce:transition-none" />
                </div>
              </figure>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

/** Open a real demo shop: a ledger of them, and the storefronts passing below. */
export function ProofSection({ t, locale }: { t: Translator; locale: string }) {
  const nf = new Intl.NumberFormat("en-IN");
  const shops = [...DEMO_APPS].sort((a, b) => b.bills - a.bills).slice(0, 6);
  return (
    <section className="section-y overflow-hidden" aria-labelledby="proof-title" data-testid="proof">
      <Container>
        <Reveal className="mb-10 max-w-3xl">
          <p className="mb-4 font-mono text-xs font-semibold tracking-wide text-primary">{t("home.proof.eyebrow")}</p>
          <h2 id="proof-title" className="text-poster-md">{t("home.proof.title")}</h2>
          <p className="mt-4 max-w-2xl text-pretty text-muted-foreground sm:text-lg">{t("home.proof.body")}</p>
        </Reveal>
        <Reveal>
          <ul className="border-t-[1.5px] border-foreground">
            {shops.map((a) => (
              <li key={a.slug} className="grid items-center gap-x-6 gap-y-2 border-b-[1.5px] border-foreground py-4 transition-colors hover:bg-tint sm:grid-cols-[1fr_auto_11rem] sm:px-3">
                <div className="min-w-0">
                  <p className="font-poster text-3xl leading-none font-extrabold sm:text-4xl">{a.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground" lang={locale}>{tradeName(a.trade, locale)}</p>
                </div>
                <p className="font-mono text-sm font-semibold whitespace-nowrap">{t("demo.apps.bills", { n: nf.format(a.bills) })}</p>
                <TryDemoButton shop={a.slug} name={a.name} />
              </li>
            ))}
          </ul>
          <Button asChild variant="link" className="mt-3 h-auto px-0 text-base font-bold">
            <Link href="/demo" className="group/link">
              {t("home.proof.all", { n: DEMO_APPS.length })}
              <ArrowRightIcon className="transition-transform group-hover/link:translate-x-1" />
            </Link>
          </Button>
        </Reveal>
      </Container>
    </section>
  );
}

const planPrice = (p: Plan | null) => (p ? billMoneyWhole(p.priceMonthlyPaise) : null);

/** The two products, given equal room: what each one is, what it costs, a real look at each. */
export function TwoProducts({ t, billing, store }: { t: Translator; billing: Plan | null; store: Plan | null }) {
  const cards = [
    { href: "/billing", name: t("products.billing.title"), title: t("products.billing.title"), body: t("products.billing.body"), points: listOf(t, "products.billing.points"), tag: billing && t("home.two.billing.tag", { price: planPrice(billing)! }), img: "/product/new-bill.jpg", w: 1400, h: 850, tone: "bg-ink text-paper" },
    { href: "/online-store", name: t("products.store.title"), title: t("home.two.store.title"), body: t("products.store.body"), points: listOf(t, "products.store.points"), tag: store && t("home.two.store.tag", { price: planPrice(store)! }), img: "/demos/thari.webp", w: 640, h: 400, tone: "bg-kungumam text-white" },
  ];
  return (
    <section className="section-y" aria-labelledby="two-title" data-testid="two-products">
      <Container>
        <Reveal className="mb-10 max-w-3xl">
          <p className="mb-4 font-mono text-xs font-semibold tracking-wide text-primary">{t("home.two.eyebrow")}</p>
          <h2 id="two-title" className="text-poster-md">{t("home.two.title")}</h2>
          <p className="mt-4 max-w-2xl text-pretty text-muted-foreground sm:text-lg">{t("home.two.body")}</p>
        </Reveal>
        <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-2">
          {cards.map((c) => (
            <Reveal key={c.href}>
              <article className={cn("flex h-full flex-col overflow-hidden rounded-3xl", c.tone)} data-product={c.href}>
                <div className="flex flex-1 flex-col p-6 sm:p-8">
                  {c.tag && <p className="mb-2 font-mono text-xs font-bold text-turmeric">{c.tag}</p>}
                  <h3 className="text-h3-poster">{c.title}</h3>
                  <p className="mt-2 text-pretty opacity-90">{c.body}</p>
                  <ul className="mt-5 grid gap-2 text-sm">
                    {c.points.map((p) => (
                      <li key={p} className="flex items-start gap-2">
                        <CheckIcon className="mt-0.5 size-4 shrink-0 text-turmeric" aria-hidden="true" />
                        {p}
                      </li>
                    ))}
                  </ul>
                  <Link href={c.href} className="group mt-6 inline-flex min-h-11 items-center gap-2 self-start font-bold underline-offset-4 hover:underline focus-ring">
                    {t("home.two.more", { name: c.name })}
                    <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </Link>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.img} alt="" width={c.w} height={c.h} loading="lazy" decoding="async" className="aspect-[16/9] w-full object-cover object-left-top" />
              </article>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <p className="mt-5 rounded-2xl bg-turmeric px-5 py-4 text-center font-semibold text-pretty text-ink">{t("home.two.oneStock")}</p>
        </Reveal>
      </Container>
    </section>
  );
}

/** The store as a product in its own right: what shoppers get, and the demo stores going past. */
export function StoresSection({ t }: { t: Translator }) {
  const stores = DEMO_STORES.filter((s) => s.slug !== "thamarai");
  return (
    <section className="band-peacock overflow-hidden py-[var(--www-section)]" aria-labelledby="stores-title" data-testid="stores">
      <Container>
        <Reveal className="mb-10 max-w-3xl">
          <p className="mb-4 font-mono text-xs font-semibold tracking-wide text-primary">{t("home.stores.eyebrow")}</p>
          <h2 id="stores-title" className="text-poster-md">{t("home.stores.title")}</h2>
          <p className="mt-4 max-w-2xl text-pretty text-muted-foreground sm:text-lg">{t("home.stores.body")}</p>
        </Reveal>
        <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <li key={n}>
              <h3 className="font-display font-bold">{t(`storehl.${n}.title`)}</h3>
              <p className="mt-1 text-sm text-pretty text-muted-foreground">{t(`storehl.${n}.body`)}</p>
            </li>
          ))}
        </ul>
      </Container>
      <Container className="mt-12 mb-6">
        <h3 className="text-h3-poster">{t("home.stores.count", { n: stores.length })}</h3>
        <p className="mt-1 text-muted-foreground">{t("home.stores.countBody")}</p>
      </Container>
      <Tape seconds={90}>
        {stores.map((s) => {
          const href = demoStoreUrl(s.slug);
          const card = (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/demos/${s.slug}.webp`} alt="" width={640} height={400} loading="lazy" decoding="async" className="aspect-[16/10] w-64 border-b-[1.5px] border-ink object-cover object-top sm:w-80" />
              <span className="flex items-center justify-between gap-2 p-3 text-sm font-bold">
                <span className="truncate">{s.name}</span>
                {href && <ExternalLinkIcon className="size-4 shrink-0" aria-hidden="true" />}
              </span>
            </>
          );
          return (
            <div key={s.slug} className="pr-4">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border-[1.5px] border-ink bg-card text-ink transition-transform hover:-translate-y-1 focus-ring">{card}</a>
              ) : (
                <div className="overflow-hidden rounded-xl border-[1.5px] border-ink bg-card text-ink">{card}</div>
              )}
            </div>
          );
        })}
      </Tape>
      <Container className="mt-8">
        <Button asChild variant="outline" className="group h-auto min-h-11 rounded-full border-[1.5px] border-foreground bg-transparent px-6 py-2 font-bold whitespace-normal">
          <Link href="/online-store">
            {t("storehl.more")}
            <ArrowRightIcon className="transition-transform group-hover:translate-x-1" />
          </Link>
        </Button>
      </Container>
    </section>
  );
}

/** Pricing as what it is: a bill. Today's total is zero. Falls back to a plain link when the API can't be reached. */
export function PriceSlip({ t, billing, store }: { t: Translator; billing: Plan | null; store: Plan | null }) {
  return (
    <section className="section-y band-turmeric" aria-labelledby="slip-title" data-testid="price-slip">
      <Container className="grid items-center gap-12 [&>*]:min-w-0 lg:grid-cols-2">
        <Reveal>
          <p className="mb-4 font-mono text-xs font-bold tracking-wide text-foreground">{t("home.slip.eyebrow")}</p>
          <h2 id="slip-title" className="text-poster-md">{t("home.slip.title")}</h2>
          <p className="mt-4 max-w-lg text-pretty text-muted-foreground sm:text-lg">{t("home.slip.body")}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild size="lg" className="group h-auto min-h-12 rounded-full px-7 py-2.5 text-base font-bold whitespace-normal">
              <Link href="/signup">
                {t("cta.trial")}
                <ArrowRightIcon className="transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-auto min-h-12 rounded-full border-[1.5px] border-foreground bg-transparent px-7 py-2.5 text-base font-bold whitespace-normal">
              <Link href="/pricing">{t("home.slip.all")}</Link>
            </Button>
          </div>
        </Reveal>
        <Reveal className="mx-auto w-full max-w-sm lg:rotate-[1.5deg]">
          <div className="receipt-edge bg-[oklch(0.985_0.012_90)] px-6 pt-7 pb-9 font-mono text-[13px] text-[oklch(0.2_0.02_60)] drop-shadow-xl">
            <p className="text-center font-bold">RBMS</p>
            <p className="text-center text-xs opacity-70">{t("home.slip.head")}</p>
            <div className="my-3 border-t border-dashed border-current/40" />
            <dl className="grid gap-2">
              <div className="flex justify-between gap-3">
                <dt>{t("home.slip.trial")}</dt>
                <dd>₹0</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>{t("home.slip.card")}</dt>
                <dd>₹0</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>{t("home.slip.cancel")}</dt>
                <dd>₹0</dd>
              </div>
            </dl>
            <div className="my-3 border-t border-dashed border-current/40" />
            <p className="flex items-baseline justify-between text-lg font-bold">
              <span>{t("home.slip.today")}</span>
              <span>₹0</span>
            </p>
            <div className="my-3 border-t border-dashed border-current/40" />
            {billing && store ? (
              <p className="text-xs" data-testid="slip-plan">
                {t("home.slip.after", { billing: billMoneyWhole(billing.priceMonthlyPaise), store: billMoneyWhole(store.priceMonthlyPaise) })}
              </p>
            ) : (
              <p className="text-xs">{t("home.slip.afterNone")}</p>
            )}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

/** Moving from other software. */
export function SwitchBand({ t }: { t: Translator }) {
  return (
    <section className="py-[calc(var(--www-section)*0.7)]" aria-labelledby="switch-title">
      <Container className="grid items-end gap-8 [&>*]:min-w-0 lg:grid-cols-[3fr_2fr]">
        <Reveal>
          <p className="mb-4 font-mono text-xs font-semibold tracking-wide text-primary">{t("home.switch.eyebrow")}</p>
          <h2 id="switch-title" className="text-poster-md">
            {["Vyapar", "Tally", "Busy", "Marg", "Excel"].map((v, i) => (
              <span key={v} className={cn("mr-3 inline-block", i % 2 === 1 && "text-primary")}>{v}</span>
            ))}
          </h2>
        </Reveal>
        <Reveal>
          <p className="text-pretty text-muted-foreground sm:text-lg">{t("home.switch.body")}</p>
        </Reveal>
      </Container>
    </section>
  );
}

/** The sign at the end of the street. */
export function FinalCta({ t }: { t: Translator }) {
  return (
    <section className="relative isolate overflow-hidden bg-kungumam py-[calc(var(--www-section)*1.2)] text-white" aria-labelledby="final-title">
      <Kolam cols={11} rows={6 + 1} strokeWidth={2} className="absolute top-1/2 left-1/2 -z-10 w-[72rem] max-w-none -translate-x-1/2 -translate-y-1/2 text-white/20" />
      <Container className="text-center">
        <Reveal>
          <h2 id="final-title" className="text-poster mx-auto max-w-5xl">{t("home.final.title")}</h2>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-white/90 sm:text-lg">{t("cta.body")}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild size="lg" className="group h-auto min-h-13 w-full rounded-full bg-paper px-8 py-3 text-base font-bold whitespace-normal text-ink hover:bg-turmeric sm:w-auto">
              <Link href="/signup">
                {t("cta.trial")}
                <ArrowRightIcon className="transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="h-auto min-h-13 w-full rounded-full border-[1.5px] border-white px-8 py-3 text-base font-bold whitespace-normal text-white hover:bg-white/15 hover:text-white sm:w-auto">
              <Link href="/demo">{t("home.final.demo")}</Link>
            </Button>
          </div>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-white/90">
            {[t("cta.noCard"), t("cta.cancelAnytime"), t("cta.tamil")].map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <CheckIcon className="size-4" aria-hidden="true" />
                {s}
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </section>
  );
}
