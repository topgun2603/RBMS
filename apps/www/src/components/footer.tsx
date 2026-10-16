import Link from "next/link";
import type { Translator } from "@srirealtime/i18n/client";
import { Logo } from "./logo";
import { CONTACT_EMAIL } from "@/lib/site";

export function SiteFooter({ t }: { t: Translator }) {
  const cols = [
    {
      title: t("footer.products"),
      links: [
        { href: "/billing", label: t("nav.billing") },
        { href: "/online-store", label: t("nav.onlineStore") },
        { href: "/pricing", label: t("nav.pricing") },
      ],
    },
    {
      title: t("footer.company"),
      links: [
        { href: "/signup", label: t("nav.startTrial") },
        { href: "/login", label: t("nav.login") },
        { href: `mailto:${CONTACT_EMAIL}`, label: CONTACT_EMAIL },
      ],
    },
    {
      title: t("footer.legal"),
      links: [
        { href: "/terms", label: t("legal.terms") },
        { href: "/privacy", label: t("legal.privacy") },
        { href: "/refunds", label: t("legal.refunds") },
      ],
    },
  ];
  return (
    <footer className="border-t bg-card/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-sm space-y-4">
          <Logo />
          <p className="text-sm text-muted-foreground">{t("footer.about")}</p>
          <p className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-marigold" aria-hidden="true" />
            {t("footer.madeIn")}
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h2 className="mb-3 text-sm font-semibold">{c.title}</h2>
            <ul className="space-y-2 text-sm">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="break-words text-muted-foreground transition-colors hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-muted-foreground sm:px-6">{t("footer.rights", { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
