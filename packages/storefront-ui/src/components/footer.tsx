import { packFor } from "@srirealtime/verticals";
import * as React from "react";
import Link from "next/link";
import { FacebookIcon, HeartIcon, LifeBuoyIcon, InstagramIcon, MailIcon, MessageCircleIcon, PackageSearchIcon, PhoneIcon, ShoppingBagIcon, UserRoundIcon, YoutubeIcon } from "lucide-react";
import { NewsletterForm } from "../client/carousel";
import { PaymentIcons, TrustBadges } from "./trust";
import type { Translator } from "../lib/messages";
import { prettyPhone } from "../lib/format";
import type { MenuItem, StoreConfig } from "../types";

const isExternal = (href: string) => /^(https?:|tel:|mailto:)/i.test(href);

function FLink({ href, children }: { href: string; children: React.ReactNode }) {
  const cls = "w-fit rounded-sm text-sm text-foreground/70 transition-colors hover:text-primary focus-ring";
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

export function StoreFooter({ config, menu, t, help = false }: { config: StoreConfig; menu: MenuItem[]; t: Translator; help?: boolean }) {
  const { shop, policies } = config;
  const social = [
    shop.social.instagram && { href: shop.social.instagram, label: "Instagram", icon: InstagramIcon },
    shop.social.facebook && { href: shop.social.facebook, label: "Facebook", icon: FacebookIcon },
    shop.social.youtube && { href: shop.social.youtube, label: "YouTube", icon: YoutubeIcon },
    shop.social.whatsapp && { href: whatsappUrl(shop.social.whatsapp), label: "WhatsApp", icon: MessageCircleIcon },
  ].filter(Boolean) as { href: string; label: string; icon: typeof InstagramIcon }[];

  const groups = menu.filter((m) => m.children?.length);
  const loose = menu.filter((m) => !m.children?.length && m.href);
  const policyLinks = POLICY_KINDS.filter((k) => policies[k]?.trim());

  const quick = [
    { href: "/track", label: t("nav.track"), icon: PackageSearchIcon },
    ...(help ? [{ href: "/help", label: t("nav.help"), icon: LifeBuoyIcon }] : []),
    { href: "/account", label: t("nav.account"), icon: UserRoundIcon },
    { href: "/account?tab=wishlist", label: t("nav.wishlist"), icon: HeartIcon },
    { href: "/cart", label: t("nav.cart"), icon: ShoppingBagIcon },
  ];

  return (
    <footer className="mt-[var(--sf-section)] border-t bg-tint-1">
      <div className="mx-auto w-full max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
        <TrustBadges t={t} cod={config.codEnabled} returns={!!policies.returns?.trim()} local={!!packFor(config.shop.businessType)?.localMade} />
      </div>

      {/* Newsletter band */}
      <div className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
        <div className="kolam flex flex-col items-start justify-between gap-5 rounded-[var(--sf-radius-card)] border bg-card p-6 shadow-xs sm:p-8 md:flex-row md:items-center">
          <div className="max-w-md">
            <p className="font-display text-h3 font-semibold">{t("footer.newsletterTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("footer.newsletterText")}</p>
          </div>
          <NewsletterForm tone="plain" />
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr] lg:px-8">
        <div className="grid content-start gap-4">
          <p className="font-display text-2xl font-semibold">{shop.name}</p>
          <div className="grid gap-2 text-sm text-foreground/70">
            {shop.contactPhone && (
              <a href={`tel:${shop.contactPhone}`} className="flex w-fit items-center gap-2 rounded-sm hover:text-foreground focus-ring">
                <PhoneIcon className="size-4" /> {prettyPhone(shop.contactPhone)}
              </a>
            )}
            {shop.contactEmail && (
              <a href={`mailto:${shop.contactEmail}`} className="flex w-fit items-center gap-2 rounded-sm hover:text-foreground focus-ring">
                <MailIcon className="size-4" /> {shop.contactEmail}
              </a>
            )}
          </div>
          {social.length > 0 && (
            <div className="flex gap-2" role="group" aria-label={t("footer.follow")}>
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
          )}
          {/* App-style quick links */}
          <ul className="mt-2 grid grid-cols-4 gap-2 sm:max-w-sm">
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
        {groups.length > 0 && help && !menu.some((m) => m.href === "/help" || m.children?.some((c) => c.href === "/help")) && (
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
          <p>{t("footer.rights", { year: new Date().getFullYear(), name: shop.name })}</p>
          <PaymentIcons t={t} cod={config.codEnabled} />
          <p>{t("footer.poweredBy")}</p>
        </div>
      </div>
    </footer>
  );
}
