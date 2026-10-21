import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRequestInfo, requireStore, themeView } from "../server/api";
import { Breadcrumbs, Container } from "../components/bits";
import { CompareView } from "../client/compare";

export async function compareMetadata(): Promise<Metadata> {
  const { t } = await getRequestInfo();
  // The list lives in the shopper's browser: nothing here for search engines.
  return { title: t("compare.title"), robots: { index: false, follow: true } };
}

/** `/compare`: the side-by-side table for the products in this browser's compare list (theme `compare: on`). */
export async function ComparePage() {
  const [{ t }, config] = await Promise.all([getRequestInfo(), requireStore()]);
  if (themeView(config.shop.theme).compare !== "on") notFound();
  return (
    <Container className="py-8">
      <Breadcrumbs items={[{ name: t("nav.home"), href: "/" }, { name: t("compare.title") }]} />
      <h1 className="mt-4 mb-6 font-display text-h1 font-semibold">{t("compare.title")}</h1>
      <CompareView />
    </Container>
  );
}
