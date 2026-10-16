import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";
import { pageMetadata } from "@/lib/seo";
import { LoginView } from "@/components/login-view";
import { HeroBackdrop } from "@/components/hero";
import { Container } from "@/components/sections";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: t("login.meta.title"), description: t("login.meta.description"), path: "/login", locale, noindex: true });
}

export default function LoginPage() {
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBackdrop />
      <Container className="max-w-lg py-12 sm:py-20">
        <LoginView />
      </Container>
    </section>
  );
}
