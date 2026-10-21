import { packFor } from "@srirealtime/verticals";
import * as React from "react";
import Link from "next/link";
import { ArrowUpIcon, FacebookIcon, HeartIcon, LifeBuoyIcon, InstagramIcon, MailIcon, MessageCircleIcon, PackageSearchIcon, PhoneIcon, ShoppingBagIcon, UserRoundIcon, YoutubeIcon } from "lucide-react";
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

const FOOTER_COLS: Record<number, string> = {
  2: "lg:grid-cols-[1.3fr_1fr]",
  3: "lg:grid-cols-[1.3fr_1fr_1fr]",
  4: "lg:grid-cols-[1.3fr_1fr_1fr_1fr]",
  5: "lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]",
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

/**
 * Store footer. Theme `footer`: columns (trust row, newsletter card, link columns) · centered (logo, one row of links,
 * socials) · newsletter (a big signup band on the brand colour, then the columns) · minimal (one line). Every variant
 * keeps the payment marks, socials (when the shop set them) and a "back to top" link; colours come from the theme
 * tokens, so dark shops stay readable.
 */
export function StoreFooter({
  config,
  menu,
  t,
  help = false,
  variant = "columns",
  logoUrl = null,
}: {
  config: StoreConfig;
  menu: MenuItem[];
  t: Translator;
  help?: boolean;
  variant?: StoreThemeView["footer"];
  logoUrl?: string | null;
}) {
  const { shop, policies } = config;
  const social = [
    shop.social.instagram && { href: shop.social.instagram, label: "Instagram", icon: InstagramIcon },
    shop.social.facebook && { href: shop.social.facebook, label: "Facebook", icon: FacebookIcon },
    shop.social.youtube && { href: shop.social.youtube, label: "YouTube", icon: YoutubeIcon },
    shop.social.whatsapp && { href: whatsappUrl(shop.social.whatsapp), label: "WhatsApp", icon: MessageCircleIcon },
  ].filter(Boolean) as Social[];

  const groups = menu.filter((m) => m.children?.length);
  const loose = menu.filter((m) => !m.children?.length && m.href);
  const policyLinks = POLICY_KINDS.filter((k) => policies[k]?.trim());
  const rights = t("footer.rights", { year: new Date().getFullYear(), name: shop.name });

  if (variant === "minimal") {
    return (
      <footer className="mt-[var(--sf-section)] border-t" data-footer="minimal">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-x-6 gap-y-3 px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:flex-row lg:px-8">
          <p className="text-center">{rights}</p>
          <nav aria-label={t("footer.policies")} className="flex flex-wrap justify-center gap-x-4 gap-y-1 lg:me-auto">
            <FLink href="/products" className="text-xs">
              {t("nav.shopAll")}
            </FLink>
            {policyLinks.map((k) => (
              <FLink key={k} href={`/policies/${k}`} className="text-xs">
                {t(`policy.${k}`)}
              </FLink>
            ))}
          </nav>
          <SocialLinks social={social} t={t} className="[&_a]:size-8" />
          <PaymentIcons t={t} cod={config.codEnabled} className="justify-center" />
          <BackToTop t={t} />
        </div>
      </footer>
    );
  }

  if (variant === "centered") {
    // Every link in one wrapping row: the shop's menu (groups flattened), help, policies.
    const links = [
      { href: "/products", label: t("nav.shopAll") },
      ...loose.map((m) => ({ href: m.href!, label: m.label })),
      ...groups.flatMap((g) => g.children!.filter((c) => c.href).map((c) => ({ href: c.href!, label: c.label }))),
      ...(help && !menu.some((m) => m.href === "/help" || m.children?.some((c) => c.href === "/help")) ? [{ href: "/help", label: t("help.title") }] : []),
      { href: "/track", label: t("nav.track") },
      ...policyLinks.map((k) => ({ href: `/policies/${k}`, label: t(`policy.${k}`) })),
    ];
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
          <PaymentIcons t={t} cod={config.codEnabled} className="justify-center" />
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
  const extraHelp = groups.length > 0 && help && !menu.some((m) => m.href === "/help" || m.children?.some((c) => c.href === "/help"));
  // Contact + shop + the menu's groups (or help) + extra help + policies: one row on desktop (up to five columns).
  const columns = Math.min(5, 2 + Math.max(groups.length, 1) + (extraHelp ? 1 : 0) + (policyLinks.length ? 1 : 0));

  return (
    <footer className={cn("mt-[var(--sf-section)] bg-tint-1", !bigBand && "border-t")} data-footer={variant}>
      {bigBand && (
        // Newsletter look: the signup is the footer's headline, on the brand colour (with the theme's pattern).
        <div className="sf-brand-hero relative isolate overflow-hidden text-primary-foreground">
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
        <TrustBadges t={t} cod={config.codEnabled} returns={!!policies.returns?.trim()} local={!!packFor(config.shop.businessType)?.localMade} />
      </div>

      {!bigBand && (
        // Newsletter card
        <div className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
          <div className="kolam flex flex-col items-start justify-between gap-5 rounded-[var(--sf-radius-card)] border bg-card p-6 shadow-xs sm:p-8 md:flex-row md:items-center">
            <div className="max-w-md">
              <p className="font-display text-h3 font-semibold">{t("footer.newsletterTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("footer.newsletterText")}</p>
            </div>
            <NewsletterForm tone="plain" />
          </div>
        </div>
      )}

      <div className={cn("mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-2 lg:px-8", FOOTER_COLS[columns])}>
        <div className="grid content-start gap-4">
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
          {/* App-style quick links */}
          <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-2 sm:max-w-sm">
            {quick.map((q) => (
              <li key={q.href}>
                <Link href={q.href} className="group flex flex-col items-center gap-1.5 rounded-2xl border bg-card px-1 py-3 text-center text-[11px] font-semibold text-foreground/75 transition-colors hover:border-primary/40 hover:text-primary focus-ring">
                  <span className="icon-chip size-8 text-primary transition-transform group-hover:scale-110 motion-reduce:transition-none">
                    <q.icon className="size-4" />
                  </span>
                  <span className="line-clamp-1">{q.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid content-start gap-3">
          <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t("footer.shop")}</p>
          <FLink href="/products">{t("nav.shopAll")}</FLink>
          {loose.map((m, i) => (
            <FLink key={i} href={m.href!}>
              {m.label}
            </FLink>
          ))}
        </div>

        {groups.map((g, i) => (
          <div key={i} className="grid content-start gap-3">
            <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{g.label}</p>
            {g.children!.map((c, j) =>
              c.href ? (
                <FLink key={j} href={c.href}>
                  {c.label}
                </FLink>
              ) : null,
            )}
          </div>
        ))}

        {groups.length === 0 && (
          <div className="grid content-start gap-3">
            <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t("footer.help")}</p>
            <FLink href="/track">{t("nav.track")}</FLink>
            {help && <FLink href="/help">{t("help.title")}</FLink>}
            <FLink href="/account">{t("nav.account")}</FLink>
          </div>
        )}
        {extraHelp && (
          <div className="grid content-start gap-3">
            <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t("footer.help")}</p>
            <FLink href="/help">{t("help.title")}</FLink>
            <FLink href="/track">{t("nav.track")}</FLink>
          </div>
        )}

        {policyLinks.length > 0 && (
          <div className="grid content-start gap-3">
            <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t("footer.policies")}</p>
            {policyLinks.map((k) => (
              <FLink key={k} href={`/policies/${k}`}>
                {t(`policy.${k}`)}
              </FLink>
            ))}
          </div>
        )}
      </div>
      <div className="border-t">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <p>{rights}</p>
          <PaymentIcons t={t} cod={config.codEnabled} />
          <div className="flex items-center gap-4">
            <p>{t("footer.poweredBy")}</p>
            <BackToTop t={t} />
          </div>
        </div>
      </div>
    </footer>
  );
}
