import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";
import { pageMetadata } from "@/lib/seo";
import { parseInterval, visiblePlans } from "@/lib/plans";
import { fetchPlans } from "@/lib/plans-server";
import { parseApp } from "@/lib/site";
import { SignupWizard } from "@/components/signup-wizard";
import { HeroBackdrop } from "@/components/hero";
import { Container } from "@/components/sections";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: t("signup.meta.title"), description: t("signup.meta.description"), path: "/signup", locale });
}

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SignupPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { t } = await getT();
  const all = await fetchPlans();
  const plans = all ? visiblePlans(all) : null;
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBackdrop />
      <Container className="max-w-6xl pt-8 pb-20 sm:pt-12">
        <h1 className="mb-6 text-center font-display text-3xl font-bold text-balance sm:mb-8 sm:text-4xl">{t("signup.title")}</h1>
        <SignupWizard plans={plans} initialPlan={one(sp.plan) ?? null} initialInterval={parseInterval(one(sp.interval))} initialApp={parseApp(one(sp.app))} />
      </Container>
    </section>
  );
}
