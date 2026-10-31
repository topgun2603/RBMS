import type { Metadata } from "next";
import { Reveal } from "@rbms/ui/motion";
import { getT } from "@/lib/i18n-server";
import { pageMetadata } from "@/lib/seo";
import { DEMO_STORES } from "@/lib/demos";
import { demoStoreUrl } from "@/lib/site";
import { Container, CtaBand, Eyebrow } from "@/components/sections";
import { DemoAppCards, DemoStoreCards } from "@/components/demo-gallery";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: t("demo.meta.title"), description: t("demo.meta.description"), path: "/demo", locale });
}

export default async function DemoPage() {
  const { t, locale } = await getT();
  const hasStores = DEMO_STORES.some((s) => demoStoreUrl(s.slug));
  return (
    <>
      <section className="section-y">
        <Container className="space-y-16">
          <Reveal className="max-w-3xl space-y-4">
            <Eyebrow>{t("demo.eyebrow")}</Eyebrow>
            <h1 className="text-display text-balance">{t("demo.title")}</h1>
            <p className="text-base text-pretty text-muted-foreground sm:text-lg">{t("demo.sub")}</p>
            <p className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-sm font-medium">
              {hasStores && (
                <a href="#stores" className="text-primary hover:underline focus-ring">
                  {t("demo.jump.stores")}
                </a>
              )}
              <a href="#apps" className="text-primary hover:underline focus-ring">
                {t("demo.jump.apps")}
              </a>
            </p>
          </Reveal>

          {hasStores && (
            <div id="stores" className="scroll-mt-24 space-y-6" role="group" aria-labelledby="demo-stores-title">
              <div className="max-w-2xl space-y-2">
                <h2 id="demo-stores-title" className="text-h2 text-balance">{t("demo.stores.title")}</h2>
                <p className="text-muted-foreground">{t("demo.stores.sub")}</p>
              </div>
              <DemoStoreCards t={t} locale={locale} />
            </div>
          )}

          <div id="apps" className="scroll-mt-24 space-y-6" role="group" aria-labelledby="demo-apps-title">
            <div className="max-w-2xl space-y-2">
              <h2 id="demo-apps-title" className="text-h2 text-balance">{t("demo.apps.title")}</h2>
              <p className="text-muted-foreground">{t("demo.apps.sub")}</p>
            </div>
            <DemoAppCards t={t} locale={locale} />
            <p className="max-w-3xl rounded-2xl border bg-tint p-5 text-sm text-muted-foreground">{t("demo.note")}</p>
          </div>
        </Container>
      </section>
      <CtaBand t={t} />
    </>
  );
}
