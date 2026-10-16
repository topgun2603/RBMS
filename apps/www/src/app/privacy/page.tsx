import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "@/components/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: t("legal.privacy"), description: t("legal.placeholderBody"), path: "/privacy", locale, noindex: true });
}

export default async function PrivacyPage() {
  const { t } = await getT();
  return (
    <LegalPage
      t={t}
      title={t("legal.privacy")}
      sections={[
        { h: "1. What we collect", p: "Your phone number or email for sign-in, your shop details, and the business records you create (bills, products, customers)." },
        { h: "2. Why we use it", p: "To run the service, send the messages you ask us to send, bill you for your plan and keep the service secure." },
        { h: "3. Your customers' data", p: "You control your customers' details. We process them on your behalf, in line with India's Digital Personal Data Protection Act, 2023." },
        { h: "4. Sharing", p: "Payment, messaging and hosting providers we rely on will be listed here, with what each receives." },
        { h: "5. Your choices", p: "How to access, correct, export or delete your data, and how to contact our grievance officer." },
      ]}
    />
  );
}
