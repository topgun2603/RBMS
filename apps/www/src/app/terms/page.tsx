import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "@/components/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: t("legal.terms"), description: t("legal.placeholderBody"), path: "/terms", locale, noindex: true });
}

export default async function TermsPage() {
  const { t } = await getT();
  return (
    <LegalPage
      t={t}
      title={t("legal.terms")}
      sections={[
        { h: "1. Who we are", p: "Srirealtime provides billing and online store software to businesses. These terms will describe the agreement between Srirealtime and the business using the service." },
        { h: "2. Your account", p: "You sign in with a one-time code sent to your phone or email. You are responsible for the people you give access to your shop." },
        { h: "3. Plans, trials and payment", p: "Paid plans start with a 14-day free trial. After the trial, plans renew monthly or yearly until cancelled. Prices exclude GST." },
        { h: "4. Your data", p: "You own the data you put into Srirealtime. We will describe here how you can export it and what happens when you close your account." },
        { h: "5. Acceptable use", p: "Rules on lawful use, messaging consent for WhatsApp and SMS, and limits on automated access will be set out here." },
        { h: "6. Liability and governing law", p: "Limits of liability and the courts with jurisdiction (Tamil Nadu, India) will be set out in the final version." },
      ]}
    />
  );
}
