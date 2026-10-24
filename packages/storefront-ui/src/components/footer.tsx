import * as React from "react";
import Link from "next/link";
import { ArrowUpIcon, ChevronDownIcon, FacebookIcon, HeartIcon, LifeBuoyIcon, InstagramIcon, MailIcon, MessageCircleIcon, PackageSearchIcon, PhoneIcon, ShoppingBagIcon, UserRoundIcon, YoutubeIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { NewsletterForm } from "../client/carousel";
import { PaymentIcons, TrustBadges } from "./trust";
import type { Translator } from "../lib/messages";
import { imageUrl, prettyPhone } from "../lib/format";
import type { MenuItem, StoreConfig, StoreThemeView } from "../types";

const isExternal = (href: string) => /^(https?:|tel:|mailto:)/i.test(href);

function FLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const cls = cn("w-fit rounded-sm text-sm text-foreground/70 transition-colors hover:text-primary focus-ring", className);
  return isExternal(href) ? (
    <a href={href} className={cls} {...(/^https?:/i.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export const POLICY_KINDS = ["shipping", "returns", "privacy", "terms"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

function whatsappUrl(v: string): string {
  if (/^https?:/i.test(v)) return v;
  const d = v.replace(/\D/g, "");
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`;
}

type Social = { href: string; label: string; icon: typeof InstagramIcon };

/** Desktop grid: the brand block, then 1–6 equal link columns, all in one row. Static classes for Tailwind. */
const FOOTER_GRID: Record<number, string> = {
  1: "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]",
  2: "lg:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]",
  3: "lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]",
  4: "lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]",
  5: "lg:grid-cols-[minmax(0,1.3fr)_repeat(5,minmax(0,1fr))]",
  6: "lg:grid-cols-[minmax(0,1.25fr)_repeat(6,minmax(0,1fr))]",
};

function SocialLinks({ social, t, className }: { social: Social[]; t: Translator; className?: string }) {
  if (!social.length) return null;
  return (
    <div className={cn("flex gap-2", className)} role="group" aria-label={t("footer.follow")}>
      {social.map((s) => (
        <a
          key={s.label}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={s.label}
          className="flex size-10 items-center justify-center rounded-full border bg-card text-foreground/70 transition-[color,border-color,transform] hover:-translate-y-0.5 hover:border-primary hover:text-primary focus-ring motion-reduce:hover:translate-y-0"
        >
          <s.icon className="size-4" />
        </a>
      ))}
    </div>
  );
}

/** "Back to top": a plain anchor to the top of the store (smooth unless the shopper prefers reduced motion). */
function BackToTop({ t, className }: { t: Translator; className?: string }) {
  return (
    <a href="#top" className={cn("inline-flex items-center gap-1.5 rounded-full text-xs font-semibold text-foreground/70 transition-colors hover:text-primary focus-ring", className)} data-testid="footer-top">
      <ArrowUpIcon className="size-3.5" aria-hidden />
      {t("common.backToTop")}
    </a>
  );
}

function FooterLogo({ name, logoUrl, className }: { name: string; logoUrl?: string | null; className?: string }) {
  const logo = imageUrl(logoUrl ?? null);
  return logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo} alt={name} className={cn("h-10 w-auto max-w-[180px] object-contain", className)} loading="lazy" />
  ) : (
    <p className={cn("font-display text-2xl font-semibold", className)}>{name}</p>
  );
}

const norm = (v: string) => v.trim().toLowerCase();
const linksTo = (items: MenuItem[], href: string) => items.some((m) => m.href === href || m.children?.some((c) => c.href === href));

export interface FooterLink {
  label: string;
  href: string;
}
/** One footer link column. `kind` says where it came from: the shop's menu group, or one of ours. */
export interface FooterColumn {
  kind: "group" | "shop" | "more" | "help" | "policies";
  label: string;
  links: FooterLink[];
}

/**
 * Link columns beside the brand block on desktop. Our built-in columns (Shop, More, Help, Policies) only fill gaps up
 * to this many; past it they fold into each other (see `footerColumns`). A shop's own groups always show (up to 6
 * fit the grid), so a shop with five groups of its own keeps them.
 */
export const FOOTER_MAX_COLUMNS = 4;

const CATALOG_TYPES = new Set(["category", "collection", "product", "brand"]);
const CATALOG_HREF = /^\/(products|c|collections|bundles|search|p|offers)(\/|\?|$)/;
/** A link into the catalogue (a category, collection, product, the bundles page, a search …). */
export const isCatalogLink = (m: Pick<MenuItem, "type" | "href">) => CATALOG_TYPES.has(m.type) || (!!m.href && CATALOG_HREF.test(m.href));

const SHOP_TITLES = ["shop", "shop by", "shop by category", "categories", "collections", "products", "catalogue", "catalog"];
const HELP_TITLES = ["help", "support", "help & support", "customer care", "customer service"];
const POLICY_TITLES = ["policies", "policy", "legal", "information"];

const toLinks = (items: MenuItem[]): FooterLink[] => items.filter((c) => !!c.href).map((c) => ({ label: c.label, href: c.href! }));
const hasHref = (links: FooterLink[], href: string) => links.some((l) => l.href === href);

/**
 * The footer's link columns. The shop's footer menu groups define the columns (in menu order); ours only fill gaps:
 *
 * - **Shop** — a group titled like "Shop"/"Categories", or one that mostly links the catalogue, *is* the shop column
 *   ("Shop all" is added when it doesn't link /products). Without one we add our own Shop column.
 * - **Loose top-level links** (no group): catalogue links join the shop column; the rest go to a "More" column (or,
 *   when the menu has exactly one non-shop group, into that group) — never into a column whose title doesn't fit.
 * - **Help** — the help centre (when on) and order tracking join the shop's own help group (same title as ours, or a
 *   group that links /track or /help); otherwise we add a Help column.
 * - **Policies** — the shop's policies (those with text) join a "Policies"/"Legal" group, or get our column.
 */
export function footerColumns(menu: MenuItem[], help: boolean, t: Translator, policyLinks: readonly FooterLink[] = []): FooterColumn[] {
  const groups = menu.filter((m) => m.children?.length);
  const loose = menu.filter((m) => !m.children?.length && m.href);
  const titleIs = (g: MenuItem, list: string[]) => list.includes(norm(g.label));

  const cols: FooterColumn[] = groups.map((g) => ({ kind: "group", label: g.label, links: toLinks(g.children!) }));
  const kids = (i: number) => groups[i]!.children!;

  const shopTitles = [...SHOP_TITLES, norm(t("footer.shop"))];
  const shopIdx = groups.findIndex((g, i) => titleIs(g, shopTitles) || kids(i).filter(isCatalogLink).length * 2 > kids(i).length);
  const helpTitles = [...HELP_TITLES, norm(t("footer.help")), norm(t("nav.help"))];
  const helpIdx = groups.findIndex((g, i) => i !== shopIdx && (titleIs(g, helpTitles) || kids(i).some((c) => c.href === "/track" || c.href === "/help")));
  const policyTitles = [...POLICY_TITLES, norm(t("footer.policies"))];
  const policyIdx = groups.findIndex((g, i) => i !== shopIdx && i !== helpIdx && (titleIs(g, policyTitles) || kids(i).some((c) => !!c.href?.startsWith("/policies/"))));
  const helpCol = helpIdx >= 0 ? cols[helpIdx]! : null;
  const policyCol = policyIdx >= 0 ? cols[policyIdx]! : null;

  // Shop: the shop's own shop-like group, else ours (first). When ours would hold nothing but "Shop all" and one of the
  // shop's groups already links the catalogue ("Salon: … Shop salon care"), "Shop all" joins that group instead of a
  // one-link column of its own.
  let shopCol = shopIdx >= 0 ? cols[shopIdx]! : null;
  let borrowed = false;
  if (!shopCol) {
    const host = loose.some(isCatalogLink) ? -1 : groups.findIndex((g, i) => i !== helpIdx && i !== policyIdx && kids(i).some(isCatalogLink));
    if (host >= 0) {
      shopCol = cols[host]!;
      borrowed = true;
    } else {
      shopCol = { kind: "shop", label: t("footer.shop"), links: [] };
      cols.unshift(shopCol);
    }
  }
  if (!linksTo(menu, "/products")) {
    const all = { label: t("nav.shopAll"), href: "/products" };
    if (borrowed) shopCol.links.push(all);
    else shopCol.links.unshift(all);
  }
  for (const l of toLinks(loose.filter(isCatalogLink))) if (!hasHref(shopCol.links, l.href)) shopCol.links.push(l);

  // Loose non-catalogue links: the menu's only other group takes them; otherwise a "More" column.
  const otherLoose = toLinks(loose.filter((m) => !isCatalogLink(m)));
  if (otherLoose.length) {
    const others = cols.filter((c) => c.kind === "group" && c !== shopCol && c !== helpCol && c !== policyCol);
    if (others.length === 1) others[0]!.links.push(...otherLoose.filter((l) => !hasHref(others[0]!.links, l.href)));
    else cols.push({ kind: "more", label: t("footer.more"), links: otherLoose });
  }

  // Help: the help centre (when on) and tracking join the shop's help group, else our Help column.
  const helpLinks: FooterLink[] = [
    ...(help && !linksTo(menu, "/help") ? [{ label: t("help.title"), href: "/help" }] : []),
    ...(!linksTo(menu, "/track") ? [{ label: t("nav.track"), href: "/track" }] : []),
  ];
  if (helpCol) helpCol.links.push(...helpLinks);
  else if (helpLinks.length) {
    // A shop with no menu groups at all also gets "My account" here (as before).
    cols.push({ kind: "help", label: t("footer.help"), links: [...helpLinks, ...(groups.length === 0 ? [{ label: t("nav.account"), href: "/account" }] : [])] });
  }

  // Policies (those with text): into the shop's policies group, else our column.
  const missingPolicies = policyLinks.filter((l) => !linksTo(menu, l.href));
  if (policyCol) policyCol.links.push(...missingPolicies);
  else if (missingPolicies.length) cols.push({ kind: "policies", label: t("footer.policies"), links: [...missingPolicies] });

  return fitColumns(
    cols.filter((c) => c.links.length > 0),
    helpCol,
  );
}

/**
 * Keeps the footer to FOOTER_MAX_COLUMNS link columns by folding ours away, least important first: Policies into
 * Help (ours or the shop's help group), then "More" into Help / the shop's last group, then our Help into the shop's
 * last group, then our Shop column into the shop's first group. The shop's own groups are never dropped.
 */
function fitColumns(cols: FooterColumn[], helpGroup: FooterColumn | null): FooterColumn[] {
  const out = [...cols];
  const fold = (from: FooterColumn, into: FooterColumn) => {
    for (const l of from.links) if (!hasHref(into.links, l.href)) into.links.push(l);
    out.splice(out.indexOf(from), 1);
  };
  const ours = (kind: FooterColumn["kind"]) => out.find((c) => c.kind === kind);
  const lastGroup = (except?: FooterColumn | null) => [...out].reverse().find((c) => c.kind === "group" && c !== except);
  while (out.length > FOOTER_MAX_COLUMNS) {
    const policies = ours("policies");
    const more = ours("more");
    const help = ours("help") ?? (helpGroup && out.includes(helpGroup) ? helpGroup : undefined);
    const shop = ours("shop");
    if (policies && (help ?? more)) fold(policies, (help ?? more)!);
    else if (more && (help ?? lastGroup())) fold(more, (help ?? lastGroup())!);
    else if (ours("help") && lastGroup()) fold(ours("help")!, lastGroup()!);
    else if (policies && lastGroup()) fold(policies, lastGroup()!);
    else if (shop && out.find((c) => c.kind === "group")) fold(shop, out.find((c) => c.kind === "group")!);
    else break;
  }
  return out;
}

/** The minimal footer's one row: "Shop all", then every footer-menu link (each href once). */
export function minimalLinks(columns: FooterColumn[], t: Translator): FooterLink[] {
  const seen = new Set<string>(["/products"]);
  return [{ label: t("nav.shopAll"), href: "/products" }, ...columns.flatMap((c) => c.links).filter((l) => !seen.has(l.href) && !!seen.add(l.href))];
}

/**
 * Store footer. Theme `footer`: columns (trust row, newsletter card, link columns) · centered (logo, one row of links,
 * socials) · newsletter (a big signup band on the brand colour, then the columns) · minimal (one line). Every variant
 * keeps the payment marks, socials (when the shop set them) and a "back to top" link; colours come from the theme
 * tokens, so dark shops stay readable. The signup band / card carries `data-footer-signup`: styles.css hides it on a
 * page that already shows a newsletter section (the home page's own signup), so shoppers never see two.
 */
export function StoreFooter({
  config,
  menu,
  t,
  help = false,
  variant = "columns",
  logoUrl = null,
  locale = "en",
}: {
  config: StoreConfig;
  menu: MenuItem[];
  t: Translator;
  help?: boolean;
  variant?: StoreThemeView["footer"];
  logoUrl?: string | null;
  /** The shopper's language (Tamil words of the trade's trust promise and the owner's own badges). */
  locale?: string;
}) {
  const { shop, policies } = config;
  const social = [
    shop.social.instagram && { href: shop.social.instagram, label: "Instagram", icon: InstagramIcon },
    shop.social.facebook && { href: shop.social.facebook, label: "Facebook", icon: FacebookIcon },
    shop.social.youtube && { href: shop.social.youtube, label: "YouTube", icon: YoutubeIcon },
    shop.social.whatsapp && { href: whatsappUrl(shop.social.whatsapp), label: "WhatsApp", icon: MessageCircleIcon },
  ].filter(Boolean) as Social[];

  const policyLinks = POLICY_KINDS.filter((k) => policies[k]?.trim());
  const columns = footerColumns(
    menu,
    help,
    t,
    policyLinks.map((k) => ({ label: t(`policy.${k}`), href: `/policies/${k}` })),
  );
  const rights = t("footer.rights", { year: new Date().getFullYear(), name: shop.name });

  if (variant === "minimal") {
    return (
      <footer className="mt-[var(--sf-section)] border-t" data-footer="minimal">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-x-6 gap-y-3 px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:flex-row lg:px-8">
          <p className="text-center">{rights}</p>
          {/* The shop's footer menu (photo credits, policies, help…) flattened into one compact wrapping row. */}
          <nav aria-label={t("footer.shop")} className="flex flex-wrap justify-center gap-x-4 gap-y-1 lg:me-auto">
            {minimalLinks(columns, t).map((l) => (
              <FLink key={l.href} href={l.href} className="text-xs">
                {l.label}
              </FLink>
            ))}
          </nav>
          <SocialLinks social={social} t={t} className="[&_a]:size-8" />
          <PaymentIcons t={t} cod={config.codEnabled} config={config} className="justify-center" />
          <BackToTop t={t} />
        </div>
      </footer>
    );
  }

  if (variant === "centered") {
    // Every link in one wrapping row: the same columns, flattened (each link once).
    const seen = new Set<string>();
    const links = columns.flatMap((c) => c.links).filter((l) => !seen.has(l.href) && !!seen.add(l.href));
    return (
      <footer className="mt-[var(--sf-section)] border-t bg-tint-1" data-footer="centered">
        <div className="mx-auto grid w-full max-w-5xl justify-items-center gap-7 px-4 pt-14 pb-10 text-center sm:px-6 lg:px-8">
          <FooterLogo name={shop.name} logoUrl={logoUrl} />
          <nav aria-label={t("footer.shop")} className="flex flex-wrap justify-center gap-x-6 gap-y-2.5">
            {links.map((l, i) => (
              <FLink key={`${l.href}-${i}`} href={l.href}>
                {l.label}
              </FLink>
            ))}
          </nav>
          <SocialLinks social={social} t={t} className="justify-center" />
          {(shop.contactPhone || shop.contactEmail) && (
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-foreground/70">
              {shop.contactPhone && (
                <a href={`tel:${shop.contactPhone}`} className="flex items-center gap-2 rounded-sm hover:text-foreground focus-ring">
                  <PhoneIcon className="size-4" /> {prettyPhone(shop.contactPhone)}
                </a>
              )}
              {shop.contactEmail && (
                <a href={`mailto:${shop.contactEmail}`} className="flex items-center gap-2 rounded-sm break-all hover:text-foreground focus-ring">
                  <MailIcon className="size-4 shrink-0" /> {shop.contactEmail}
                </a>
              )}
            </div>
          )}
          <PaymentIcons t={t} cod={config.codEnabled} config={config} className="justify-center" />
        </div>
        <div className="border-t">
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
            <p>{rights}</p>
            <BackToTop t={t} />
            <p>{t("footer.poweredBy")}</p>
          </div>
        </div>
      </footer>
    );
  }

  const quick = [
    { href: "/track", label: t("nav.track"), icon: PackageSearchIcon },
    ...(help ? [{ href: "/help", label: t("nav.help"), icon: LifeBuoyIcon }] : []),
    { href: "/account", label: t("nav.account"), icon: UserRoundIcon },
    { href: "/account?tab=wishlist", label: t("nav.wishlist"), icon: HeartIcon },
    { href: "/cart", label: t("nav.cart"), icon: ShoppingBagIcon },
  ];
  const bigBand = variant === "newsletter";
  // Brand block + the link columns in one row on desktop (ours keep it to FOOTER_MAX_COLUMNS; a shop with more groups
  // of its own gets up to 6 in the row, more wrap), two columns on tablets,
  // an accordion on phones.
  const desktopCols = Math.max(1, Math.min(6, columns.length));

  return (
    <footer className={cn("mt-[var(--sf-section)] bg-tint-1", !bigBand && "border-t")} data-footer={variant}>
      {bigBand && (
        // Newsletter look: the signup is the footer's headline, on the brand colour (with the theme's pattern).
        <div className="sf-brand-hero relative isolate overflow-hidden text-primary-foreground" data-footer-signup="band">
          <div className="relative z-[1] mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-6 px-4 py-12 sm:px-6 sm:py-16 lg:flex-row lg:items-center lg:px-8">
            <div className="max-w-xl">
              <p className="font-display text-h1 font-semibold text-balance">{t("footer.newsletterTitle")}</p>
              <p className="mt-2 text-base text-primary-foreground/85">{t("footer.newsletterText")}</p>
            </div>
            <NewsletterForm />
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
        <TrustBadges t={t} config={config} locale={locale} />
      </div>

      {!bigBand && (
        // Newsletter card
        <div className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8" data-footer-signup="card">
          <div className="kolam flex flex-col items-start justify-between gap-5 rounded-[var(--sf-radius-card)] border bg-card p-6 shadow-xs sm:p-8 md:flex-row md:items-center">
            <div className="max-w-md">
              <p className="font-display text-h3 font-semibold">{t("footer.newsletterTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("footer.newsletterText")}</p>
            </div>
            <NewsletterForm tone="plain" />
          </div>
        </div>
      )}

      <div className={cn("mx-auto grid w-full max-w-7xl gap-x-8 gap-y-10 px-4 py-12 sm:px-6 lg:px-8", FOOTER_GRID[desktopCols])} data-footer-columns={columns.length}>
        <div className="grid min-w-0 content-start gap-4">
          <FooterLogo name={shop.name} logoUrl={bigBand ? logoUrl : null} />
          <div className="grid gap-2 text-sm text-foreground/70">
            {shop.contactPhone && (
              <a href={`tel:${shop.contactPhone}`} className="flex w-fit items-center gap-2 rounded-sm hover:text-foreground focus-ring">
                <PhoneIcon className="size-4" /> {prettyPhone(shop.contactPhone)}
              </a>
            )}
            {shop.contactEmail && (
              <a href={`mailto:${shop.contactEmail}`} className="flex w-fit items-center gap-2 rounded-sm break-all hover:text-foreground focus-ring">
                <MailIcon className="size-4 shrink-0" /> {shop.contactEmail}
              </a>
            )}
          </div>
          <SocialLinks social={social} t={t} />
          {/* Quick links: small icon pills that wrap inside the brand column (never wider than it). */}
          <ul className="mt-1 flex min-w-0 flex-wrap gap-1.5" data-footer-quick>
            {quick.map((q) => (
              <li key={q.href} className="min-w-0">
                <Link
                  href={q.href}
                  className="group inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card py-1.5 ps-2 pe-3 text-xs font-semibold text-foreground/75 transition-colors hover:border-primary/40 hover:text-primary focus-ring"
                >
                  <q.icon className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">{q.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Phones: one accordion (native <details>, no JS). */}
        <div className="divide-y border-y md:hidden" data-footer-accordion>
          {columns.map((c, i) => (
            <details key={i} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase focus-ring [&::-webkit-details-marker]:hidden">
                {c.label}
                <ChevronDownIcon className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
              </summary>
              <ul className="grid gap-3 pb-4">
                {c.links.map((l, j) => (
                  <li key={j}>
                    <FLink href={l.href}>{l.label}</FLink>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
        {/* Tablets: two columns; desktop: every column in the brand block's row. */}
        <div className={cn("hidden gap-x-8 gap-y-10 md:grid md:grid-cols-2 lg:contents")}>
          {columns.map((c, i) => (
            <nav key={i} aria-label={c.label} className="grid min-w-0 content-start gap-3" data-footer-column={c.kind}>
              <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{c.label}</p>
              <ul className="grid gap-3">
                {c.links.map((l, j) => (
                  <li key={j}>
                    <FLink href={l.href}>{l.label}</FLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="border-t">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <p>{rights}</p>
          <PaymentIcons t={t} cod={config.codEnabled} config={config} />
          <div className="flex items-center gap-4">
            <p>{t("footer.poweredBy")}</p>
            <BackToTop t={t} />
          </div>
        </div>
      </div>
    </footer>
  );
}
