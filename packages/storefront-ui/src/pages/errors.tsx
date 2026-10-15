import * as React from "react";
import Link from "next/link";
import { StoreIcon } from "lucide-react";
import { LostArt } from "../components/illustrations";
import { getConfig, getRequestInfo } from "../server/api";
import { Container, Empty } from "../components/bits";
import { SearchBox } from "../client/search-box";

export async function StoreNotFound() {
  const { t } = await getRequestInfo();
  const config = await getConfig().catch(() => null);
  if (!config) return <Empty icon={<StoreIcon />} title={t("store.notFoundTitle")} body={t("store.notFoundBody")} className="max-w-md" />;
  return (
    <Container className="flex max-w-xl flex-col items-center py-20 text-center">
      <span className="relative block w-56 text-primary sm:w-64">
        <LostArt className="sf-float" />
        <span aria-hidden className="absolute top-2 right-2 rounded-full bg-[image:var(--sf-gradient)] px-3 py-1 font-display text-sm font-semibold text-primary-foreground shadow-md">
          404
        </span>
      </span>
      <h1 className="mt-6 font-display text-h1 font-semibold">{t("common.notFoundTitle")}</h1>
      <p className="mt-2 text-muted-foreground">{t("common.notFoundBody")}</p>
      <SearchBox className="mt-8 w-full max-w-sm text-left" />
      <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        {t("common.backHome")}
      </Link>
    </Container>
  );
}
