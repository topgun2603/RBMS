"use client";

import * as React from "react";
import { BanIcon, CheckCircle2Icon, InfoIcon, LinkIcon, Loader2Icon, LockIcon, SparklesIcon, ToggleRightIcon } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle, cn, EmptyState, Skeleton, StatusPill, Switch, toast } from "@rbms/ui";
import { Page, PageHeading } from "../components/page";
import { QueryError } from "../components/query-state";
import { SettingsNav } from "../components/settings-nav";
import { humanizeKey } from "../lib/format";
import { useFeatures, useToggleFeature } from "../lib/features";
import { describeError, tOr, useI18n, type Translator } from "../lib/i18n";
import type { FeatureState } from "../lib/types";
import { featureModuleName, featureName } from "./gate";
import { useSession } from "./session";

interface Group {
  module: string;
  items: FeatureState[];
}

/** Server order, grouped by module; the module's base feature first. */
function groupByModule(items: FeatureState[]): Group[] {
  const map = new Map<string, FeatureState[]>();
  for (const f of items) map.set(f.module, [...(map.get(f.module) ?? []), f]);
  return [...map.entries()].map(([module, list]) => ({
    module,
    items: [...list].sort((a, b) => Number(b.key === module) - Number(a.key === module)),
  }));
}

const describe = (t: Translator, f: FeatureState) => tOr(t, `web.features.descriptions.${f.key}`, f.description);

/** Settings → Features: shop owners switch shopToggle features; everyone sees what's on and why the rest is off. */
export default function FeaturesSettingsPage() {
  const { t } = useI18n();
  const features = useFeatures();
  const { canManage } = useSession();
  const groups = React.useMemo(() => groupByModule(features.features), [features.features]);
  const planId = features.data?.planId;

  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading
        icon={ToggleRightIcon}
        title={t("web.features.title")}
        description={t("web.features.description")}
        actions={planId ? <Badge variant="secondary" className="h-7 px-3 text-xs">{t("web.features.plan", { plan: humanizeKey(planId) })}</Badge> : undefined}
      />
      {!canManage && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <LockIcon className="size-4 shrink-0" /> {t("web.features.readOnly")}
        </p>
      )}
      {features.error && !features.data ? (
        <QueryError error={features.error} onRetry={features.refetch} />
      ) : !features.data ? (
        <div className="grid gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={ToggleRightIcon} title={t("web.features.empty")} />
      ) : (
        <div className="grid gap-4">
          {groups.map((g) => (
            <Card key={g.module} className="gap-1">
              <CardHeader>
                <CardTitle className="text-base">{featureModuleName(t, g.module, g.items.find((i) => i.key === g.module))}</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {g.items.map((f) => (
                  <FeatureRow key={f.key} feature={f} all={features.features} canManage={canManage} />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

function FeatureRow({ feature: f, all, canManage }: { feature: FeatureState; all: FeatureState[]; canManage: boolean }) {
  const { t } = useI18n();
  const toggle = useToggleFeature();
  const name = featureName(t, f.key, f);
  const id = `feature-${f.key.replace(/[^a-z0-9-]/gi, "-")}`;
  const switchable = f.shopToggle && f.available;
  const busy = toggle.isPending && toggle.variables?.key === f.key;

  const onChange = (enabled: boolean) => {
    toggle.mutate(
      { key: f.key, enabled },
      {
        onSuccess: () => toast.success(t(enabled ? "web.features.turnedOn" : "web.features.turnedOff", { feature: name })),
        onError: (err) => toast.error(describeError(err, t)),
      },
    );
  };

  let status: React.ReactNode = null;
  if (!f.available) {
    const reason = f.reason ?? "app";
    if (reason === "dependency") {
      const dep = f.dependsOn.map((k) => all.find((x) => x.key === k)).find((x) => x && !x.enabled);
      status = (
        <StatusPill tone="neutral" icon={LinkIcon}>
          {t("web.features.reason.dependency", { feature: dep ? featureName(t, dep.key, dep) : humanizeKey(f.dependsOn[0] ?? "") })}
        </StatusPill>
      );
    } else if (reason === "plan") {
      status = (
        <StatusPill tone="warning" icon={SparklesIcon}>
          {t("web.features.reason.plan")}
        </StatusPill>
      );
    } else {
      status = (
        <StatusPill tone="neutral" icon={BanIcon}>
          {t("web.features.reason.app")}
        </StatusPill>
      );
    }
  } else if (!f.shopToggle) {
    status = (
      <StatusPill tone="success" icon={CheckCircle2Icon}>
        {t("web.features.alwaysOn")}
      </StatusPill>
    );
  }

  return (
    <div className={cn("flex items-start gap-3 py-3.5", !f.available && "opacity-80")}>
      <div className="min-w-0 flex-1 space-y-1">
        <label htmlFor={switchable ? id : undefined} className="block font-medium">
          {name}
        </label>
        <p className="text-sm text-muted-foreground">{describe(t, f)}</p>
        {status && <div className="pt-1">{status}</div>}
      </div>
      {f.shopToggle && (
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {busy && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
          <span className="hidden text-xs text-muted-foreground sm:inline">{t(f.enabled ? "web.features.on" : "web.features.off")}</span>
          <Switch
            id={id}
            checked={f.enabled}
            disabled={!switchable || !canManage || busy}
            onCheckedChange={onChange}
            aria-label={t("web.features.toggle", { feature: name })}
          />
        </div>
      )}
      {!f.shopToggle && !f.available && <InfoIcon className="mt-1 size-4 shrink-0 text-muted-foreground/60" aria-hidden />}
    </div>
  );
}
