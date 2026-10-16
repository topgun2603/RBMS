import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "@/components/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: t("legal.refunds"), description: t("legal.placeholderBody"), path: "/refunds", locale, noindex: true });
}

export default async function RefundsPage() {
  const { t } = await getT();
  return (
    <LegalPage
      t={t}
      title={t("legal.refunds")}
      sections={[
        { h: "1. Free trial", p: "You are not charged during the 14-day trial. If you don't add a payment method, your shop moves to the Free plan when the trial ends." },
        { h: "2. Cancelling", p: "You can cancel at any time from Settings. Your plan stays active until the end of the period you paid for." },
        { h: "3. Refunds", p: "When a refund applies (for example a duplicate charge) and how long it takes to reach your UPI or card will be set out here." },
        { h: "4. Plan changes", p: "Upgrades apply immediately; downgrades apply at the end of the current period." },
      ]}
    />
  );
}
