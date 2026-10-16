import type { Metadata } from "next";
import { BarChart3Icon, BookOpenCheckIcon, BoxesIcon, ReceiptIndianRupeeIcon, ScanBarcodeIcon, UsersIcon } from "lucide-react";
import { getT } from "@/lib/i18n-server";
import { pageMetadata } from "@/lib/seo";
import { ProductPage } from "@/components/product-page";
import { InvoiceMockup } from "@/components/mockups";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: t("billing.meta.title"), description: t("billing.meta.description"), path: "/billing", locale });
}

export default async function BillingPage() {
  const { t } = await getT();
  const icons = [<ReceiptIndianRupeeIcon key="1" />, <BookOpenCheckIcon key="2" />, <ScanBarcodeIcon key="3" />, <BoxesIcon key="4" />, <BarChart3Icon key="5" />, <UsersIcon key="6" />];
  const tones = [undefined, "bg-marigold/20 text-marigold-ink", undefined, "bg-leaf/15 text-leaf", undefined, "bg-marigold/20 text-marigold-ink"];
  const features = icons.map((icon, i) => ({ icon, title: t(`billing.f.${i + 1}.title`), body: t(`billing.f.${i + 1}.body`), tone: tones[i] }));
  const faq = [1, 3, 4, 6].map((n) => ({ q: t(`faq.home.${n}.q`), a: t(`faq.home.${n}.a`) }));
  return <ProductPage t={t} product="billing" path="/billing" features={features} faq={faq} mock={<InvoiceMockup className="w-full max-w-[380px]" />} />;
}
