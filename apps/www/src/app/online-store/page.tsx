import type { Metadata } from "next";
import { DownloadIcon, GiftIcon, GlobeIcon, LanguagesIcon, LayoutGridIcon, LayoutTemplateIcon, LogInIcon, MapPinIcon, MessageCircleIcon, SearchCheckIcon, UtensilsCrossedIcon, WalletIcon } from "lucide-react";
import { getT } from "@/lib/i18n-server";
import { pageMetadata } from "@/lib/seo";
import { ProductPage } from "@/components/product-page";
import { PhoneStoreMockup } from "@/components/mockups";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return pageMetadata({ title: t("store.meta.title"), description: t("store.meta.description"), path: "/online-store", locale });
}

export default async function OnlineStorePage() {
  const { t } = await getT();
  const icons = [<GlobeIcon key="1" />, <LayoutGridIcon key="2" />, <WalletIcon key="3" />, <MessageCircleIcon key="4" />, <SearchCheckIcon key="5" />, <GiftIcon key="6" />, <LayoutTemplateIcon key="7" />, <MapPinIcon key="8" />, <LogInIcon key="9" />, <DownloadIcon key="10" />, <UtensilsCrossedIcon key="11" />, <LanguagesIcon key="12" />];
  const tones = [undefined, "bg-marigold/20 text-marigold-ink", "bg-leaf/15 text-leaf", "bg-[#25D366]/15 text-[#128C7E] dark:text-[#25D366]", undefined, "bg-marigold/20 text-marigold-ink", undefined, "bg-leaf/15 text-leaf", undefined, "bg-marigold/20 text-marigold-ink", "bg-leaf/15 text-leaf", undefined];
  const features = icons.map((icon, i) => ({ icon, title: t(`store.f.${i + 1}.title`), body: t(`store.f.${i + 1}.body`), tone: tones[i] }));
  const faq = [1, 2, 9, 4].map((n) => ({ q: t(`faq.home.${n}.q`), a: t(`faq.home.${n}.a`) }));
  return <ProductPage t={t} product="store" path="/online-store" features={features} faq={faq} mock={<PhoneStoreMockup />} />;
}
