import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRightIcon, LifeBuoyIcon } from "lucide-react";
import { absoluteUrl, breadcrumbJsonLd } from "@srirealtime/cms/seo";
import { Reveal } from "@srirealtime/ui/motion";
import { apiGetOrNull, apiGetSafe, getFeatures, getRequestInfo, requireStore } from "../server/api";
import { storeMetadata } from "../server/meta";
import { faqPageJsonLd } from "../lib/help";
import { featureOn, STORE_FEATURES } from "../lib/features";
import { formatDate } from "../lib/format";
import { Markdown } from "../lib/markdown";
import type { FaqArticle, FaqCategory, FaqGroup, List } from "../types";
import { Breadcrumbs, Container, JsonLd } from "../components/bits";
import { FaqBrowser, HelpActions, HelpfulVote } from "../client/help-center";
import { MyTickets, RaiseTicket, TicketThread } from "../client/support";

/** Most articles whose full answers are rendered (and put in the FAQPage JSON-LD) on /help. */
const INDEX_BODIES_MAX = 40;

const getIndex = () => apiGetSafe<List<FaqGroup>>("/support/public/faq", { items: [], total: 0 }, { revalidate: 120 });
const getArticle = (slug: string) =>
  /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) ? apiGetOrNull<{ article: FaqArticle; category: FaqCategory | null }>(`/support/public/faq/${encodeURIComponent(slug)}`, { revalidate: 120 }) : Promise.resolve(null);

/** The help centre is on when the shop has `support` (tickets) or `support.faq`; 404 otherwise. */
async function requireHelp() {
  const [config, features] = await Promise.all([requireStore(), getFeatures()]);
  const faq = featureOn(features, STORE_FEATURES.faq);
  const tickets = featureOn(features, STORE_FEATURES.support);
  if (!faq && !tickets) notFound();
  return { config, faq, tickets };
}

async function requireTickets() {
  const h = await requireHelp();
  if (!h.tickets) notFound();
  return h;
}

export async function helpMetadata(): Promise<Metadata> {
  const { t } = await getRequestInfo();
  return storeMetadata({ kind: "other", path: "/help", slug: "help", title: t("help.title"), description: t("help.subtitle") });
}

function HelpHero({ t, children }: { t: (k: string) => string; children?: React.ReactNode }) {
  return (
    <div className="kolam relative overflow-hidden border-b bg-tint-1">
      <Container className="py-10 text-center sm:py-14">
        <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[image:var(--sf-gradient)] text-primary-foreground shadow-lg shadow-primary/25">
          <LifeBuoyIcon className="size-7" />
        </span>
        <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase [:lang(ta)_&]:tracking-normal">{t("help.eyebrow")}</p>
        <h1 className="mt-2 font-display text-h1 font-semibold text-balance">{t("help.title")}</h1>
        <p className="mx-auto mt-2 max-w-xl text-muted-foreground">{t("help.subtitle")}</p>
        {children}
      </Container>
    </div>
  );
}

/** `/help`: FAQ by category (full answers server-rendered + FAQPage JSON-LD), instant search, "still need help". */
export async function HelpPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const [{ faq }, info] = await Promise.all([requireHelp(), getRequestInfo()]);
  const { t, baseUrl } = info;
  const qv = searchParams.q;
  const q = (Array.isArray(qv) ? qv[0] : qv)?.slice(0, 100) ?? "";
  const index = faq ? await getIndex() : { items: [], total: 0 };
  const slugs = index.items.flatMap((g) => g.articles.map((a) => a.slug)).slice(0, INDEX_BODIES_MAX);
  const articles = await Promise.all(slugs.map((s) => getArticle(s).catch(() => null)));
  const bodies: Record<string, string> = {};
  for (const a of articles) if (a) bodies[a.article.slug] = a.article.body;
  const ld = faqPageJsonLd(
    index.items.flatMap((g) => g.articles).filter((a) => bodies[a.slug]).map((a) => ({ question: a.title, answer: bodies[a.slug]!, url: absoluteUrl(baseUrl, `/help/${a.slug}`) })),
  );
  // FaqBrowser filters with `q` during SSR too, so a shared `?q=` link renders its results (and keeps filtering as you type).
  return (
    <>
      {ld && !q && <JsonLd data={[ld, breadcrumbJsonLd([{ name: t("nav.home"), url: "/" }, { name: t("help.title"), url: "/help" }], baseUrl)]} />}
      <HelpHero t={t} />
      <Container className="grid gap-12 py-10 sm:py-14">
        {faq && <FaqBrowser groups={index.items} bodies={bodies} initialQuery={q} />}
        <Reveal>
          <HelpActions />
        </Reveal>
      </Container>
    </>
  );
}

export async function helpArticleMetadata(slug: string): Promise<Metadata> {
  const a = await getArticle(slug).catch(() => null);
  if (!a) return { title: "Not found", robots: { index: false } };
  return storeMetadata({ kind: "other", path: `/help/${a.article.slug}`, slug: a.article.slug, title: a.article.title, description: a.article.body, seo: a.article.seo ? { title: a.article.seo.title, description: a.article.seo.description, noindex: a.article.seo.noindex } : null });
}

/** `/help/<slug>`: one article (FAQPage + breadcrumb JSON-LD), helpful vote, more in the category. */
export async function HelpArticlePage({ slug }: { slug: string }) {
  const [{ faq }, info] = await Promise.all([requireHelp(), getRequestInfo()]);
  if (!faq) notFound();
  const a = await getArticle(slug);
  if (!a) notFound();
  const { t, baseUrl, locale } = info;
  const index = await getIndex();
  const group = index.items.find((g) => (g.category?.id ?? null) === (a.article.categoryId ?? null));
  const more = (group?.articles ?? []).filter((x) => x.slug !== a.article.slug).slice(0, 6);
  const crumbs = [
    { name: t("nav.home"), href: "/" },
    { name: t("help.title"), href: "/help" },
    ...(a.category ? [{ name: a.category.name, href: `/help#cat-${a.category.slug}` }] : []),
    { name: a.article.title },
  ];
  const ld = faqPageJsonLd([{ question: a.article.title, answer: a.article.body, url: absoluteUrl(baseUrl, `/help/${a.article.slug}`) }]);
  return (
    <>
      <JsonLd data={[...(ld ? [ld] : []), breadcrumbJsonLd(crumbs.map((c, i) => ({ name: c.name, url: i === crumbs.length - 1 ? `/help/${a.article.slug}` : c.href })), baseUrl)]} />
      <Container className="max-w-3xl py-8 sm:py-12">
        <Breadcrumbs items={crumbs} className="mb-6" />
        <article className="rounded-3xl border bg-card p-6 shadow-[var(--elevation-1)] sm:p-10" data-testid="help-article">
          {a.category && <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase [:lang(ta)_&]:tracking-normal">{a.category.name}</p>}
          <h1 className="mt-2 font-display text-h1 font-semibold text-balance">{a.article.title}</h1>
          {a.article.updatedAt && <p className="mt-2 text-sm text-muted-foreground">{formatDate(a.article.updatedAt, locale)}</p>}
          <Markdown source={a.article.body} className="mt-6 text-[17px] leading-relaxed text-foreground/85" />
          <HelpfulVote slug={a.article.slug} className="mt-8 border-t pt-5" />
        </article>
        {more.length > 0 && (
          <Reveal>
            <section className="mt-10" aria-labelledby="help-more">
              <h2 id="help-more" className="mb-4 font-display text-h3 font-semibold">
                {t("help.related", { category: a.category?.name ?? t("help.general") })}
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {more.map((m) => (
                  <li key={m.slug}>
                    <Link href={`/help/${encodeURIComponent(m.slug)}`} className="group flex h-full items-start justify-between gap-3 rounded-2xl border bg-card p-4 hover:border-primary/30 hover:shadow-card focus-ring">
                      <span>
                        <span className="block font-semibold">{m.title}</span>
                        <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">{m.excerpt}</span>
                      </span>
                      <ArrowRightIcon className="mt-1 size-4 shrink-0 text-primary transition-transform group-hover:translate-x-1" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </Reveal>
        )}
        <Reveal>
          <HelpActions className="mt-10" />
        </Reveal>
      </Container>
    </>
  );
}

export async function helpPrivateMetadata(): Promise<Metadata> {
  const { t } = await getRequestInfo();
  return { title: t("help.myTickets"), robots: { index: false, follow: false } };
}

function SubPage({ title, t, children }: { title: string; t: (k: string) => string; children: React.ReactNode }) {
  return (
    <Container className="max-w-3xl py-8 sm:py-12">
      <Breadcrumbs items={[{ name: t("nav.home"), href: "/" }, { name: t("help.title"), href: "/help" }, { name: title }]} className="mb-6" />
      {children}
    </Container>
  );
}

/** `/help/new?order=<id>`: raise a ticket (signed-in, or guest via OTP). */
export async function RaiseTicketPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireTickets();
  const { t } = await getRequestInfo();
  const o = searchParams.order;
  const order = (Array.isArray(o) ? o[0] : o) ?? undefined;
  return (
    <SubPage title={t("ticket.newTitle")} t={t}>
      <RaiseTicket initialOrder={order && /^[0-9a-f-]{36}$/i.test(order) ? order : undefined} />
    </SubPage>
  );
}

/** `/help/tickets`: the shopper's (or verified guest's) tickets. */
export async function MyTicketsPage() {
  await requireTickets();
  const { t } = await getRequestInfo();
  return (
    <SubPage title={t("help.myTickets")} t={t}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-h1 font-semibold">{t("help.myTickets")}</h1>
        <Link href="/help/new" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          {t("help.raise")}
        </Link>
      </div>
      <MyTickets />
    </SubPage>
  );
}

/** `/help/tickets/<id>`: one ticket's public thread + reply. */
export async function TicketPage({ id }: { id: string }) {
  await requireTickets();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t } = await getRequestInfo();
  return (
    <SubPage title={t("help.myTickets")} t={t}>
      <TicketThread ticketId={id} />
    </SubPage>
  );
}
