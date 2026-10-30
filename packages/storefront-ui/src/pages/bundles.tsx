import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PackageIcon } from "lucide-react";
import { STORE_PATHS } from "@rbms/cms/seo";
import { apiGetSafe, getRequestInfo, requireStore } from "../server/api";
import { Breadcrumbs, Container, Empty } from "../components/bits";
import { BundleList } from "../client/offers";
import type { BundleView, List } from "../types";

export async function bundlesMetadata(): Promise<Metadata> {
  const [{ t }, config] = await Promise.all([getRequestInfo(), requireStore()]);
  return { title: `${t("bundle.pageTitle")} · ${config.shop.name}`, description: t("bundle.pageBody") };
}

/** `/bundles`: the shop's live combos (bundles), each added to the cart in one tap; the cart applies the combo price. */
export async function BundlesPage() {
  const [{ t }] = await Promise.all([getRequestInfo(), requireStore()]);
  const list = await apiGetSafe<List<BundleView>>("/store/bundles", { items: [], total: 0 }, { revalidate: 60, query: { limit: 48 } });
  return (
    <Container className="py-8">
      <Breadcrumbs items={[{ name: t("nav.home"), href: "/" }, { name: t("bundle.pageTitle") }]} />
      <header className="mt-4 mb-8 max-w-2xl">
        <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">{t("bundle.pageEyebrow")}</p>
        <h1 className="mt-2 font-display text-h1 font-semibold text-balance">{t("bundle.pageTitle")}</h1>
        <p className="mt-2 text-muted-foreground">{t("bundle.pageBody")}</p>
      </header>
      {list.items.length ? (
        <BundleList bundles={list.items} />
      ) : (
        <Empty
          className="mx-auto max-w-lg"
          icon={<PackageIcon className="size-8" />}
          title={t("bundle.empty")}
          body={t("bundle.emptyBody")}
          action={
            <Link href={STORE_PATHS.products} className="text-sm font-semibold text-primary hover:underline">
              {t("cart.startShopping")}
            </Link>
          }
        />
      )}
    </Container>
  );
}
