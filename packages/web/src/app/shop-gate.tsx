"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, RefreshCwIcon, StoreIcon } from "lucide-react";
import {
  AuthLayout,
  Button,
  FadeIn,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@srirealtime/ui";
import { LocaleSwitcher } from "../components/locale-switcher";
import { Splash } from "../components/splash";
import { ThemeToggle } from "../components/theme-toggle";
import { api, ApiError } from "../lib/api";
import { ShopProvider } from "../lib/branding";
import { describeError, useI18n } from "../lib/i18n";
import { setStoredTenant } from "../lib/session";
import { getTenantStrategy, isValidShopSlug, rootDomain, rootUrl, shopUrl, useTenantSlug } from "../lib/tenant";
import type { Tenant } from "../lib/types";

/**
 * Resolves the shop (subdomain or stored slug, see TenantStrategy), checks it with GET /v1/tenancy/current and
 * provides it (plus its branding) to everything below.
 */
export function ShopGate({ appName, children }: { appName?: string; children: React.ReactNode }) {
  const slug = useTenantSlug();
  if (slug === undefined) return <Splash />;
  if (slug === null) return <OpenShop />;
  return (
    <ResolvedShop slug={slug} appName={appName}>
      {children}
    </ResolvedShop>
  );
}

function ResolvedShop({ slug, appName, children }: { slug: string; appName?: string; children: React.ReactNode }) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["tenancy", "current", slug],
    queryFn: () => api<Tenant>("/tenancy/current", { anonymous: true }),
    staleTime: 5 * 60_000,
  });

  if (q.isPending) return <Splash />;
  if (q.isError) {
    const err = q.error;
    const network = err instanceof ApiError && (err.status === 0 || err.status >= 500);
    return (
      <AuthLayout corner={<Corner />}>
        <FadeIn className="grid gap-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <StoreIcon className="size-6" />
          </div>
          {network ? (
            <>
              <h1 className="font-heading text-xl font-semibold">{t("web.shop.unreachableTitle")}</h1>
              <p className="text-sm text-muted-foreground">{describeError(err, t)}</p>
              <Button size="lg" onClick={() => void q.refetch()}>
                <RefreshCwIcon /> {t("web.common.retry")}
              </Button>
            </>
          ) : (
            <>
              <h1 className="font-heading text-xl font-semibold">{t("web.shop.notFoundTitle")}</h1>
              <p className="text-sm text-muted-foreground">
                {err instanceof ApiError && err.status === 403 ? t("web.shop.suspended", { slug }) : t("web.shop.notFound", { slug })}
              </p>
              <OpenAnother />
            </>
          )}
        </FadeIn>
      </AuthLayout>
    );
  }
  if (q.data.status === "suspended") {
    return (
      <AuthLayout corner={<Corner />}>
        <div className="grid gap-3 text-center">
          <h1 className="font-heading text-xl font-semibold">{t("web.shop.notFoundTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("web.shop.suspended", { slug })}</p>
          <OpenAnother />
        </div>
      </AuthLayout>
    );
  }
  return (
    <ShopProvider tenant={q.data} appName={appName}>
      {children}
    </ShopProvider>
  );
}

function OpenAnother() {
  const { t } = useI18n();
  if (getTenantStrategy().from === "storage") {
    return (
      <Button variant="outline" size="lg" onClick={() => setStoredTenant(null)}>
        {t("web.shop.openAnother")}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="lg">
      <a href={rootUrl()}>{t("web.shop.openAnother")}</a>
    </Button>
  );
}

function Corner() {
  return (
    <>
      <LocaleSwitcher />
      <ThemeToggle />
    </>
  );
}

/** No shop yet: on the bare domain jump to <slug>.<root>; with stored tenants remember the slug. */
function OpenShop() {
  const { t } = useI18n();
  const [slug, setSlug] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const clean = slug.trim().toLowerCase();
  const valid = isValidShopSlug(clean);
  const storage = getTenantStrategy().from === "storage";
  const root = rootDomain();

  return (
    <AuthLayout
      corner={<Corner />}
      logo={
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <StoreIcon className="size-6" />
        </div>
      }
      footer={t("web.open.footer")}
    >
      <div className="mb-6 space-y-1.5 text-center">
        <h1 className="font-heading text-xl font-semibold tracking-tight">{t("web.open.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("web.open.subtitle")}</p>
      </div>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!valid) return;
          if (storage) setStoredTenant(clean);
          else window.location.assign(shopUrl(clean));
        }}
      >
        <Field id="shop-slug">
          <FieldLabel>{t("web.open.slugLabel")}</FieldLabel>
          <InputGroup size="lg">
            <FieldControl>
              <InputGroupInput
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="raja"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </FieldControl>
            {!storage && <InputGroupAddon>.{root}</InputGroupAddon>}
          </InputGroup>
          {touched && !valid ? <FieldError>{t("web.open.slugInvalid")}</FieldError> : <FieldHint>{t("web.open.slugHint")}</FieldHint>}
        </Field>
        <Button type="submit" size="lg">
          {t("web.open.go")} <ArrowRightIcon />
        </Button>
      </form>
      <div className="mt-6 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
        {storage ? t("web.open.explainStorage") : t("web.open.explain", { example: `raja.${root}` })}
      </div>
    </AuthLayout>
  );
}
