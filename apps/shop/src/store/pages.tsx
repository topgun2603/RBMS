"use client";

import Link from "next/link";
import { ArrowRightIcon, ShoppingBagIcon } from "lucide-react";
import { Button, EmptyState } from "@srirealtime/ui";
import { Page, PageHeading, useI18n, useWebApp, type IconType } from "@srirealtime/web";

function Placeholder({ icon, title, subtitle, module }: { icon: IconType; title: string; subtitle: string; module: string }) {
  const { t } = useI18n();
  const app = useWebApp();
  const billing = app.modules.find((m) => m.id === "billing");
  return (
    <Page className="max-w-4xl">
      <PageHeading icon={icon} title={t(title)} description={t(subtitle)} />
      <EmptyState
        icon={icon}
        title={t("store.placeholder.title", { module: t(module) })}
        description={t("store.placeholder.body", { module: t(module) })}
        action={
          billing ? (
            <Button asChild variant="outline" size="lg">
              <Link href={billing.basePath}>
                {t("store.placeholder.openBilling")} <ArrowRightIcon />
              </Link>
            </Button>
          ) : undefined
        }
      />
    </Page>
  );
}

export function OrdersPage() {
  return <Placeholder icon={ShoppingBagIcon} title="store.orders.title" subtitle="store.orders.subtitle" module="store.placeholder.orders" />;
}
