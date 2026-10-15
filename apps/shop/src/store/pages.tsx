"use client";

import Link from "next/link";
import { ArrowRightIcon, ShoppingBagIcon, StoreIcon } from "lucide-react";
import { Button, Card, CardContent, EmptyState } from "@srirealtime/ui";
import { Page, PageHeading, useI18n, useQuickActions, useSession, useShop, useWebApp, type IconType } from "@srirealtime/web";

/** Dashboard welcome card; its quick actions come from every mounted module (billing's "New bill" etc.). */
export function WelcomeWidget() {
  const { t } = useI18n();
  const { shopName } = useShop();
  const { me } = useSession();
  const actions = useQuickActions();
  const first = me.user.name?.split(" ")[0];
  return (
    <Card className="relative overflow-hidden py-5">
      <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      <CardContent className="relative grid gap-4 px-5 sm:px-6">
        <div className="flex items-start gap-3">
          <span className="icon-chip size-11 shrink-0 rounded-xl text-primary">
            <StoreIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">{first ? t("store.welcome.greetingName", { name: first }) : t("store.welcome.greeting")}</p>
            <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">{t("store.welcome.title", { shop: shopName })}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("store.welcome.body")}</p>
          </div>
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label={t("store.welcome.quick")}>
            {actions.map((a) => {
              const Icon: IconType = a.icon ?? ArrowRightIcon;
              return (
                <Button key={`${a.module.id}:${a.id}`} asChild variant={a.primary ? "default" : "outline"} size="lg" className="h-11">
                  <Link href={a.absHref}>
                    <Icon /> {t(a.label)}
                  </Link>
                </Button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
