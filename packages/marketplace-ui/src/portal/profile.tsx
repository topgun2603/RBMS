"use client";

import * as React from "react";
import { ExternalLinkIcon, StoreIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, FadeIn, toast } from "@srirealtime/ui";
import { describeError, Page, PageHeading, useI18n } from "@srirealtime/web";
import { SubmitButton } from "../components/account";
import { VendorLogo } from "../components/bits";
import { ProfileFields, profileErrors, profileFromVendor, profilePatch, type ProfileDraft } from "../components/profile";
import { useUpdateProfile, useVendor } from "../lib/vendor";

/** The seller's public store page fields (name, description, logo) and contact details. */
export default function StoreProfilePage() {
  const { t } = useI18n();
  const { self } = useVendor();
  const update = useUpdateProfile();
  const [draft, setDraft] = React.useState<ProfileDraft | null>(() => (self ? profileFromVendor(self) : null));
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    if (self && !draft) setDraft(profileFromVendor(self));
  }, [self, draft]);
  if (!self || !draft) return null;
  const errors = profileErrors(draft);
  const suspended = self.status === "suspended";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) {
      toast.error(t("marketplace.validation.fixErrors"));
      return;
    }
    try {
      const v = await update.mutateAsync(profilePatch(draft));
      setDraft(profileFromVendor(v));
      setTried(false);
      toast.success(t("marketplace.common.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const storeUrl = typeof window !== "undefined" ? storeLink(self.slug) : null;

  return (
    <Page className="max-w-5xl">
      <PageHeading icon={StoreIcon} title={t("marketplace.profile.title")} description={t("marketplace.profile.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="py-5">
          <CardContent className="px-4 sm:px-6">
            <form onSubmit={submit} noValidate className="grid gap-5">
              <fieldset disabled={suspended} className="contents">
                <ProfileFields value={draft} onChange={setDraft} errors={tried ? errors : {}} />
              </fieldset>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDraft(profileFromVendor(self))} disabled={update.isPending}>
                  {t("marketplace.common.reset")}
                </Button>
                <SubmitButton pending={update.isPending} disabled={suspended}>
                  {t("marketplace.common.save")}
                </SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Live preview of the public seller page header. */}
        <div className="grid content-start gap-3 lg:sticky lg:top-20">
          <Card className="gap-3 overflow-hidden py-0">
            <div className="h-20 bg-gradient-to-br from-primary/25 via-primary/10 to-transparent" />
            <CardHeader className="-mt-12 px-4 sm:px-5">
              <FadeIn key={draft.logoUrl}>
                <VendorLogo name={draft.name || self.name} url={draft.logoUrl || null} className="size-16 rounded-2xl ring-4 ring-card" />
              </FadeIn>
              <CardTitle className="pt-2 text-lg">{draft.name || self.name}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-5 sm:px-5">
              <p className="line-clamp-5 text-sm whitespace-pre-line text-muted-foreground">{draft.description || t("marketplace.profile.previewEmpty")}</p>
              <p className="mt-3 text-xs text-muted-foreground">{t("marketplace.profile.products", { count: self.productCount ?? 0 })}</p>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">{t("marketplace.profile.previewNote")}</p>
          {storeUrl && self.status === "active" && (
            <Button asChild variant="outline">
              <a href={storeUrl} target="_blank" rel="noreferrer">
                <ExternalLinkIcon /> {t("marketplace.profile.viewPage")}
              </a>
            </Button>
          )}
        </div>
      </div>
    </Page>
  );
}

/**
 * The storefront's seller page, when the host sets NEXT_PUBLIC_STORE_URL (e.g. "http://{slug}.localhost:3003"; {slug} =
 * this shop's subdomain). The storefront's seller page lives at /sellers/<seller slug>.
 */
function storeLink(slug: string): string | null {
  const tpl = process.env.NEXT_PUBLIC_STORE_URL;
  const sub = window.location.hostname.split(".")[0];
  if (!tpl || !sub) return null;
  return `${tpl.replace("{slug}", sub).replace(/\/+$/, "")}/sellers/${slug}`;
}
