import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";
import { pageMetadata } from "@/lib/seo";
import { StoreSignIn } from "@/components/store-sign-in";
import { HeroBackdrop } from "@/components/hero";
import { Container } from "@/components/sections";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: t("store.meta.title"), description: t("store.meta.description"), path: "/auth/store", locale, noindex: true });
}

/** Central shopper sign-in for storefronts (Google + phone through Firebase): `?shop=<slug>&origin=<store origin>&mode=popup|redirect&return=<url>`. */
export default function StoreSignInPage() {
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBackdrop />
      <Container className="max-w-lg py-10 sm:py-20">
        <StoreSignIn />
      </Container>
    </section>
  );
}
