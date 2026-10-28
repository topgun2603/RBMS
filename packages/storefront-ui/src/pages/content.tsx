import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronDownIcon, NewspaperIcon } from "lucide-react";
import { breadcrumbJsonLd, STORE_PATHS } from "@srirealtime/cms/seo";
import { apiGetOrNull, apiGetSafe, getConfig, getRequestInfo, requireStore } from "../server/api";
import { storeMetadata } from "../server/meta";
import { formatDate } from "../lib/format";
import { Markdown, safeHref, stripLeadingHeading } from "../lib/markdown";
import type { Block, CmsPage, List, Post, PostSummary } from "../types";
import { Breadcrumbs, Container, Empty, JsonLd, StoreImage } from "../components/bits";
import { POLICY_KINDS, type PolicyKind } from "../components/footer";
import { NoticeBody, type PublicNotice } from "../components/privacy-notice";
import { AccountView } from "../client/account-view";
import { CartView } from "../client/cart-view";
import { EnquiryForm } from "../client/enquiry-form";
import { CheckoutView } from "../client/checkout-view";

/** Slugs that are routes of their own (never CMS pages). */
const RESERVED = new Set(["p", "c", "collections", "blog", "search", "products", "cart", "checkout", "account", "order", "track", "policies", "pages", "api", "help", "sellers"]);

const getPage = (slug: string) => (RESERVED.has(slug) || !/^[a-z0-9][a-z0-9-]{0,120}$/i.test(slug) ? Promise.resolve(null) : apiGetOrNull<CmsPage>(`/cms/public/pages/${encodeURIComponent(slug)}`, { revalidate: 60 }));
const getPost = (slug: string) => apiGetOrNull<Post>(`/cms/public/posts/${encodeURIComponent(slug)}`, { revalidate: 60 });

// ------------------------------------------------------------------ blocks

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="grid gap-6">
      {blocks.map((b, i) => (
        <BlockView key={b.id ?? i} b={b} />
      ))}
    </div>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case "heading":
      return b.level === 3 ? <h3 className="font-heading text-xl font-semibold">{b.text}</h3> : <h2 className="font-heading text-2xl font-bold tracking-tight">{b.text}</h2>;
    case "paragraph":
      return <Markdown source={b.markdown} className="text-[17px] leading-relaxed text-foreground/85" />;
    case "image":
      return (
        <figure>
          <div className="overflow-hidden rounded-2xl bg-muted">
            <StoreImage src={b.url} alt={b.alt} className="h-auto" />
          </div>
          {b.caption && <figcaption className="mt-2 text-center text-sm text-muted-foreground">{b.caption}</figcaption>}
        </figure>
      );
    case "gallery":
      return (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {b.images.map((img, i) => (
            <li key={i} className="aspect-square overflow-hidden rounded-2xl bg-muted">
              <StoreImage src={img.url} alt={img.alt} />
            </li>
          ))}
        </ul>
      );
    case "button": {
      const href = safeHref(b.href);
      if (!href) return null;
      return (
        <div>
          <Link href={href} className={b.style === "secondary" ? "inline-flex h-11 items-center rounded-full border px-6 text-sm font-semibold hover:bg-accent" : "inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90"}>
            {b.label}
          </Link>
        </div>
      );
    }
    case "faq":
      return (
        <div className="divide-y rounded-2xl border bg-card">
          {b.items.map((it, i) => (
            <details key={i} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {it.q}
                <ChevronDownIcon className="size-4 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <Markdown source={it.a} className="mt-3 text-sm text-foreground/80" />
            </details>
          ))}
        </div>
      );
    case "video":
      return /^[A-Za-z0-9_-]{6,20}$/.test(b.youtubeId) ? (
        <div className="aspect-video overflow-hidden rounded-2xl bg-muted">
          <iframe className="size-full" src={`https://www.youtube-nocookie.com/embed/${b.youtubeId}`} title={b.title ?? "Video"} loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        </div>
      ) : null;
    case "enquiry-form":
      return <EnquiryForm cfg={b} />;
    case "divider":
      return <hr className="border-border" />;
  }
}

// ------------------------------------------------------------------ CMS pages

export async function cmsPageMetadata(slug: string): Promise<Metadata> {
  const p = await getPage(slug).catch(() => null);
  if (!p) return { title: "Not found", robots: { index: false } };
  const firstText = p.blocks.find((b): b is Extract<Block, { type: "paragraph" }> => b.type === "paragraph")?.markdown;
  return storeMetadata({ kind: "page", slug: p.slug, title: p.title, description: firstText, seo: p.seo });
}

export async function CmsPageView({ slug }: { slug: string }) {
  const { t, baseUrl } = await getRequestInfo();
  await requireStore();
  const p = await getPage(slug);
  if (!p) notFound();
  return (
    <Container className="max-w-3xl py-10">
      <JsonLd data={breadcrumbJsonLd([{ name: t("nav.home"), url: "/" }, { name: p.title, url: STORE_PATHS.page(p.slug) }], baseUrl)} />
      <Breadcrumbs items={[{ name: t("nav.home"), href: "/" }, { name: p.title }]} />
      <h1 className="mt-4 mb-8 font-display text-h1 font-semibold">{p.title}</h1>
      <Blocks blocks={p.blocks} />
    </Container>
  );
}

// ------------------------------------------------------------------ blog

export async function blogMetadata(): Promise<Metadata> {
  const { t } = await getRequestInfo();
  return storeMetadata({ kind: "blog", title: t("blog.title") });
}

export async function BlogIndexPage() {
  const { t, locale } = await getRequestInfo();
  await requireStore();
  const posts = await apiGetSafe<List<PostSummary>>("/cms/public/posts", { items: [], total: 0 }, { revalidate: 60, query: { limit: 30 } });
  return (
    <Container className="py-10">
      <h1 className="mb-8 font-display text-h1 font-semibold">{t("blog.title")}</h1>
      {posts.items.length === 0 ? (
        <Empty icon={<NewspaperIcon />} title={t("blog.empty")} />
      ) : (
        <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {posts.items.map((p) => (
            <li key={p.id}>
              <Link href={STORE_PATHS.post(p.slug)} className="group block">
                <span className="block aspect-[16/10] overflow-hidden rounded-2xl bg-muted">
                  <StoreImage src={p.coverUrl} alt={p.title} className="transition-transform duration-500 group-hover:scale-105" />
                </span>
                {p.publishedAt && <span className="mt-3 block text-xs text-muted-foreground">{formatDate(p.publishedAt, locale)}</span>}
                <span className="mt-1 block font-heading text-lg font-semibold group-hover:underline">{p.title}</span>
                {p.excerpt && <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">{p.excerpt}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}

export async function postMetadata(slug: string): Promise<Metadata> {
  const p = await getPost(slug).catch(() => null);
  if (!p) return { title: "Not found", robots: { index: false } };
  return storeMetadata({ kind: "post", slug: p.slug, title: p.title, excerpt: p.excerpt, image: p.coverUrl, seo: p.seo, publishedAt: p.publishedAt, updatedAt: p.updatedAt });
}

export async function BlogPostPage({ slug }: { slug: string }) {
  const { t, locale, baseUrl } = await getRequestInfo();
  await requireStore();
  const [p, config] = await Promise.all([getPost(slug), getConfig()]);
  if (!p) notFound();
  return (
    <article className="pb-10">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: p.title,
          ...(p.coverUrl ? { image: [p.coverUrl] } : {}),
          ...(p.publishedAt ? { datePublished: p.publishedAt } : {}),
          dateModified: p.updatedAt,
          author: { "@type": p.authorName ? "Person" : "Organization", name: p.authorName ?? config?.shop.name ?? "" },
          mainEntityOfPage: `${baseUrl}${STORE_PATHS.post(p.slug)}`,
        }}
      />
      <Container className="max-w-3xl pt-10">
        <Breadcrumbs items={[{ name: t("nav.home"), href: "/" }, { name: t("blog.title"), href: STORE_PATHS.blog }, { name: p.title }]} />
        <h1 className="mt-4 font-display text-h1 font-semibold text-balance">{p.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {p.authorName && <>{t("blog.by", { name: p.authorName })} · </>}
          {p.publishedAt && formatDate(p.publishedAt, locale)}
        </p>
      </Container>
      {p.coverUrl && (
        <Container className="mt-8 max-w-5xl">
          <div className="aspect-[16/8] overflow-hidden rounded-3xl bg-muted">
            <StoreImage src={p.coverUrl} alt={p.title} eager />
          </div>
        </Container>
      )}
      <Container className="mt-10 max-w-3xl">
        <Blocks blocks={p.blocks} />
      </Container>
    </article>
  );
}

// ------------------------------------------------------------------ policies

export const isPolicyKind = (k: string): k is PolicyKind => (POLICY_KINDS as readonly string[]).includes(k);

export async function policyMetadata(kind: string): Promise<Metadata> {
  const { t } = await getRequestInfo();
  if (!isPolicyKind(kind)) return { title: "Not found" };
  return storeMetadata({ kind: "other", path: `/policies/${kind}`, title: t(`policy.${kind}`) });
}

export async function PolicyPage({ kind }: { kind: string }) {
  const [{ t, locale }, config] = await Promise.all([getRequestInfo(), getConfig()]);
  if (!isPolicyKind(kind) || (kind !== "privacy" && !config?.policies[kind]?.trim())) notFound();
  const own = config?.policies[kind]?.trim() ?? "";
  const notice = kind === "privacy" ? await apiGetOrNull<PublicNotice>("/consent/notice", { revalidate: 60 }) : null;
  return (
    <Container className="max-w-3xl py-10">
      <Breadcrumbs items={[{ name: t("nav.home"), href: "/" }, { name: t(`policy.${kind}`) }]} />
      <h1 className="mt-4 mb-8 font-display text-h1 font-semibold">{t(`policy.${kind}`)}</h1>
      {own && <Markdown source={stripLeadingHeading(own, [t(`policy.${kind}`), kind])} className="text-[17px] leading-relaxed text-foreground/85" />}
      {notice && <NoticeBody notice={notice} locale={locale} t={t} />}
      <nav className="mt-12 flex flex-wrap gap-2 border-t pt-6" aria-label={t("footer.policies")}>
        {POLICY_KINDS.filter((k) => k !== kind && config?.policies[k]?.trim()).map((k) => (
          <Link key={k} href={`/policies/${k}`} className="rounded-full border px-4 py-2 text-sm font-medium hover:bg-accent">
            {t(`policy.${k}`)}
          </Link>
        ))}
      </nav>
    </Container>
  );
}

// ------------------------------------------------------------------ cart / checkout / account shells (client views)

const noindex = { robots: { index: false, follow: false } } as const;

export async function cartMetadata(): Promise<Metadata> {
  const { t } = await getRequestInfo();
  return { title: t("cart.title"), ...noindex };
}
export async function checkoutMetadata(): Promise<Metadata> {
  const { t } = await getRequestInfo();
  return { title: t("checkout.title"), ...noindex };
}
export async function accountMetadata(): Promise<Metadata> {
  const { t } = await getRequestInfo();
  return { title: t("account.title"), ...noindex };
}

export async function CartPage() {
  const { t } = await getRequestInfo();
  await requireStore();
  return (
    <Container className="py-8">
      <h1 className="mb-6 font-display text-h1 font-semibold">{t("cart.title")}</h1>
      <CartView />
    </Container>
  );
}

export async function CheckoutPage() {
  const { t } = await getRequestInfo();
  await requireStore();
  return (
    <Container className="py-8">
      <h1 className="mb-6 font-display text-h1 font-semibold">{t("checkout.title")}</h1>
      <CheckoutView />
    </Container>
  );
}

export async function AccountPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireStore();
  const one = (k: string) => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v;
  };
  return (
    <Container className="py-8 sm:py-12">
      <AccountView params={{ tab: one("tab"), order: one("order"), next: one("next") }} />
    </Container>
  );
}
