"use client";

import Link from "next/link";
import { CompassIcon, LockIcon, PowerOffIcon, SparklesIcon } from "lucide-react";
import { Button, EmptyState } from "@srirealtime/ui";
import { Page } from "../components/page";
import { humanizeKey } from "../lib/format";
import type { FeatureCheck } from "../lib/features";
import { tOr, useI18n, type Translator } from "../lib/i18n";
import type { FeatureState } from "../lib/types";
import { useSettingsHref } from "./navigation";
import { useOptionalSession } from "./session";

/** Translated feature name (web.features.names.<key>), else the server's English label. */
export const featureName = (t: Translator, key: string, state?: Pick<FeatureState, "label">) =>
  tOr(t, `web.features.names.${key}`, state?.label || humanizeKey(key));

/** Translated module name (web.features.modules.<id>), else the base feature's label. */
export const featureModuleName = (t: Translator, module: string, base?: Pick<FeatureState, "label">) =>
  tOr(t, `web.features.modules.${module}`, base?.label || humanizeKey(module));

/** "Page not found" inside the shell (or full screen with `standalone`). */
export function NotFound({ standalone }: { standalone?: boolean }) {
  const { t } = useI18n();
  const body = (
    <EmptyState
      className="w-full max-w-md"
      icon={CompassIcon}
      title={t("web.notFound.title")}
      description={t("web.notFound.description")}
      action={
        <Button asChild size="lg">
          <Link href="/">{t("web.notFound.home")}</Link>
        </Button>
      }
    />
  );
  if (standalone) return <div className="flex min-h-dvh items-center justify-center p-4">{body}</div>;
  return (
    <Page className="flex max-w-3xl justify-center pt-16">
      {body}
    </Page>
  );
}

/**
 * Shown instead of a screen whose feature is off. Reason plan → upgrade hint; shop → "Turned off" (owners get a link to
 * Settings → Features); app (or the module's own restriction) → plain not found.
 */
export function FeatureGatePage({ check }: { check: Extract<FeatureCheck, { ok: false }> }) {
  const { t } = useI18n();
  const session = useOptionalSession();
  const settingsHref = useSettingsHref();
  const owner = !!session?.canManage;
  if (check.reason === "app") return <NotFound />;
  const feature = featureName(t, check.cause, check.causeState ?? check.state);
  const plan = check.reason === "plan";
  return (
    <Page className="flex max-w-3xl justify-center pt-16">
      <EmptyState
        className="w-full max-w-md"
        icon={plan ? SparklesIcon : PowerOffIcon}
        title={t(plan ? "web.gate.planTitle" : "web.gate.shopTitle")}
        description={
          <>
            {t(plan ? "web.gate.planBody" : "web.gate.shopBody", { feature })}{" "}
            {t(plan ? (owner ? "web.gate.planOwner" : "web.gate.planStaff") : owner ? "web.gate.shopOwner" : "web.gate.shopStaff")}
          </>
        }
        action={
          owner && !plan ? (
            <Button asChild size="lg">
              <Link href={settingsHref("features")}>{t("web.gate.openFeatures")}</Link>
            </Button>
          ) : undefined
        }
      />
    </Page>
  );
}

/** A screen the user's role may not open. */
export function RoleGatePage() {
  const { t } = useI18n();
  return (
    <Page className="flex max-w-3xl justify-center pt-16">
      <EmptyState className="w-full max-w-md" icon={LockIcon} title={t("web.gate.roleTitle")} description={t("web.gate.roleBody")} />
    </Page>
  );
}

/** A screen that needs a permission the member's role doesn't include (Gated.permission). */
export function PermissionGatePage() {
  const { t } = useI18n();
  return (
    <Page className="flex max-w-3xl justify-center pt-16">
      <EmptyState
        className="w-full max-w-md"
        icon={LockIcon}
        title={t("web.gate.permissionTitle")}
        description={t("web.gate.permissionBody")}
        action={
          <Button asChild size="lg" variant="outline">
            <Link href="/">{t("web.notFound.home")}</Link>
          </Button>
        }
      />
    </Page>
  );
}

