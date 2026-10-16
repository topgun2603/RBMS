"use client";

import * as React from "react";
import { BadgeIndianRupeeIcon, LogOutIcon, PackageIcon, ShieldCheckIcon, StoreIcon } from "lucide-react";
import { Button, Card, CardContent, FadeIn, Stagger, StaggerItem, SuccessCheck, toast } from "@srirealtime/ui";
import { ApiError, BrandMark, describeError, displayName, LocaleSwitcher, ThemeToggle, useI18n, useMe, useShop, useSignOut, useWebApp } from "@srirealtime/web";
import { SubmitButton } from "../components/account";
import { emptyProfile, ProfileFields, profileErrors, profilePatch, type ProfileDraft } from "../components/profile";
import { useApply } from "../lib/vendor";

/** For signed-in users who aren't a seller in this shop yet: why sell here, and the application form. */
export default function ApplyScreen() {
  const { t } = useI18n();
  const app = useWebApp();
  const { shopName } = useShop();
  const me = useMe();
  const signOut = useSignOut(app.loginPath);
  const apply = useApply();
  const [draft, setDraft] = React.useState<ProfileDraft>(() => ({ ...emptyProfile(), contactName: me.data?.user.name ?? "", contactPhone: me.data?.user.phone ?? "", contactEmail: me.data?.user.email ?? "" }));
  const [tried, setTried] = React.useState(false);
  const [closed, setClosed] = React.useState(false);
  const errors = profileErrors(draft, true);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) {
      toast.error(t("marketplace.validation.fixErrors"));
      return;
    }
    try {
      await apply.mutateAsync(profilePatch(draft));
      toast.success(t("marketplace.apply.sent"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setClosed(true);
      else toast.error(describeError(err, t));
    }
  };

  const perks = [
    { icon: StoreIcon, title: t("marketplace.apply.perk1Title"), body: t("marketplace.apply.perk1Body") },
    { icon: BadgeIndianRupeeIcon, title: t("marketplace.apply.perk2Title"), body: t("marketplace.apply.perk2Body") },
    { icon: ShieldCheckIcon, title: t("marketplace.apply.perk3Title"), body: t("marketplace.apply.perk3Body") },
  ];

  return (
    <div className="min-h-dvh bg-page">
      <header className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <BrandMark />
        <div className="flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            <LogOutIcon /> <span className="hidden sm:inline">{t("web.user.signOut")}</span>
          </Button>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 pb-12 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-10 lg:pt-6">
        <FadeIn className="grid content-start gap-5">
          <div className="space-y-2">
            <span className="icon-chip size-12 rounded-2xl text-primary">
              <PackageIcon className="size-6" />
            </span>
            <h1 className="font-heading text-3xl font-bold tracking-tight">{t("marketplace.apply.title", { shop: shopName })}</h1>
            <p className="text-muted-foreground">{t("marketplace.apply.subtitle", { name: displayName(me.data?.user, "") })}</p>
          </div>
          <Stagger className="grid gap-3">
            {perks.map((p) => (
              <StaggerItem key={p.title} className="flex gap-3">
                <span className="icon-chip size-10 shrink-0 rounded-xl text-primary">
                  <p.icon className="size-5" />
                </span>
                <div>
                  <p className="font-medium">{p.title}</p>
                  <p className="text-sm text-muted-foreground">{p.body}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </FadeIn>
        <FadeIn delay={0.05}>
          <Card>
            <CardContent>
              {apply.isSuccess ? (
                <div className="grid justify-items-center gap-3 py-8 text-center">
                  <SuccessCheck size={56} />
                  <h2 className="font-heading text-xl font-semibold">{t("marketplace.apply.sentTitle")}</h2>
                  <p className="max-w-sm text-sm text-muted-foreground">{t("marketplace.apply.sentBody")}</p>
                </div>
              ) : closed ? (
                <div className="grid justify-items-center gap-2 py-8 text-center">
                  <h2 className="font-heading text-xl font-semibold">{t("marketplace.apply.closedTitle")}</h2>
                  <p className="max-w-sm text-sm text-muted-foreground">{t("marketplace.apply.closedBody", { shop: shopName })}</p>
                </div>
              ) : (
                <form onSubmit={submit} noValidate className="grid gap-5">
                  <div>
                    <h2 className="font-heading text-lg font-semibold">{t("marketplace.apply.formTitle")}</h2>
                    <p className="text-sm text-muted-foreground">{t("marketplace.apply.formBody")}</p>
                  </div>
                  <ProfileFields value={draft} onChange={setDraft} errors={tried ? errors : {}} requireContact showAddress={false} />
                  <SubmitButton size="lg" pending={apply.isPending} className="w-full">
                    {t("marketplace.apply.submit")}
                  </SubmitButton>
                </form>
              )}
            </CardContent>
          </Card>
        </FadeIn>
      </main>
    </div>
  );
}
