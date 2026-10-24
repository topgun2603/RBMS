import type { Metadata } from "next";
import { Reveal } from "@srirealtime/ui/motion";
import { getT } from "@/lib/i18n-server";
import { pageMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { ALL_TRADES, TRADE_GROUPS, tradeName } from "@/lib/trades";
import { JsonLd } from "@/components/json-ld";
import { Container, CtaBand, Eyebrow } from "@/components/sections";
import { TradeCards } from "@/components/trades";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: t("industries.meta.title"), description: t("industries.meta.description"), path: "/industries", locale });
}

export default async function IndustriesPage() {
  const { t, locale } = await getT();
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: t("industries.meta.title"),
          description: t("industries.meta.description"),
          url: `${SITE_URL}/industries`,
          itemListElement: ALL_TRADES.map((id, i) => ({ "@type": "ListItem", position: i + 1, name: tradeName(id, locale), description: t(`ind.${id}`) })),
        }}
      />
      <section className="section-y">
        <Container className="space-y-14">
          <Reveal className="max-w-3xl space-y-4">
            <Eyebrow>{t("industries.eyebrow")}</Eyebrow>
            <h1 className="text-display text-balance">{t("industries.title")}</h1>
            <p className="text-base text-pretty text-muted-foreground sm:text-lg">{t("industries.sub")}</p>
          </Reveal>
          {TRADE_GROUPS.map((g) => (
            <div key={g.key} className="space-y-5" role="group" aria-labelledby={`grp-${g.key}`}>
              <h2 id={`grp-${g.key}`} className="font-display text-xl font-bold">{t(`industries.group.${g.key}`)}</h2>
              <TradeCards ids={g.ids} t={t} locale={locale} />
            </div>
          ))}
          <Reveal className="max-w-3xl space-y-2 rounded-2xl border bg-tint p-6">
            <h2 className="font-display text-lg font-semibold">{t("industries.every.title")}</h2>
            <p className="text-muted-foreground">{t("industries.every.body")}</p>
            <p className="text-sm text-muted-foreground">{t("trades.custom")}</p>
          </Reveal>
        </Container>
      </section>
      <CtaBand t={t} />
    </>
  );
}
