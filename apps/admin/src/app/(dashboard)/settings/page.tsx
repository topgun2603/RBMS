"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, GlobeIcon, Loader2Icon, SaveIcon, SlidersHorizontalIcon, UserCogIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  Switch,
  Textarea,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@srirealtime/ui";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { api } from "@/lib/api";
import { humanizeKey } from "@/lib/format";
import { describeError, tOr, useI18n } from "@/lib/i18n";
import { qk } from "@/lib/queries";
import type { SettingsNamespace, SettingsValues } from "@/lib/types";

type Kind = "boolean" | "number" | "string" | "json";
const kindOf = (v: unknown): Kind =>
  typeof v === "boolean" ? "boolean" : typeof v === "number" ? "number" : typeof v === "string" || v === null || v === undefined ? "string" : "json";

/** Editable representation: JSON values are edited as text. */
const toDraft = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, kindOf(v) === "json" ? JSON.stringify(v, null, 2) : v]));

export default function SettingsPage() {
  const { t } = useI18n();
  const namespaces = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<{ items: SettingsNamespace[] }>("/settings").then((r) => r.items),
  });
  const [selected, setSelected] = React.useState<string | null>(null);
  const active = selected ?? namespaces.data?.[0]?.namespace ?? null;
  const activeInfo = namespaces.data?.find((n) => n.namespace === active);

  return (
    <Page>
      <PageHeader title={t("admin.settings.title")} description={t("admin.settings.subtitle")} />
      {namespaces.isError ? (
        <QueryError error={namespaces.error} onRetry={() => void namespaces.refetch()} />
      ) : (
        <div className="grid items-start gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
          <nav className="flex gap-1 overflow-x-auto md:sticky md:top-20 md:flex-col" aria-label={t("admin.settings.namespaces")}>
            {namespaces.isLoading
              ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)
              : namespaces.data?.map((n) => (
                  <button
                    key={n.namespace}
                    type="button"
                    onClick={() => setSelected(n.namespace)}
                    aria-current={n.namespace === active ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      n.namespace === active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
                    )}
                  >
                    <span className="truncate">{tOr(t, `admin.settings.ns.${n.namespace}`, humanizeKey(n.namespace))}</span>
                    <ChevronRightIcon className="hidden size-4 opacity-50 md:block" />
                  </button>
                ))}
          </nav>
          {active && activeInfo ? (
            <NamespaceEditor key={active} info={activeInfo} />
          ) : (
            !namespaces.isLoading && <EmptyState icon={SlidersHorizontalIcon} title={t("admin.settings.empty")} />
          )}
        </div>
      )}
    </Page>
  );
}

function NamespaceEditor({ info }: { info: SettingsNamespace }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const ns = info.namespace;
  const values = useQuery({
    queryKey: qk.settingsNs(ns),
    queryFn: () => api.get<SettingsValues>(`/settings/${encodeURIComponent(ns)}`).then((r) => r.values ?? {}),
  });
  const [draft, setDraft] = React.useState<Record<string, unknown> | null>(null);
  const [jsonErrors, setJsonErrors] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (values.data) setDraft(toDraft(values.data));
  }, [values.data]);

  const original = React.useMemo(() => (values.data ? toDraft(values.data) : null), [values.data]);
  const changedKeys = draft && original ? Object.keys(draft).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(original[k])) : [];
  const hasErrors = Object.values(jsonErrors).some(Boolean);

  const save = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {};
      for (const k of changedKeys) {
        const kind = kindOf(values.data?.[k]);
        patch[k] = kind === "json" ? JSON.parse(String(draft![k])) : draft![k];
      }
      return api.put<SettingsValues>(`/settings/${encodeURIComponent(ns)}/tenant`, patch);
    },
    onSuccess: (res) => {
      qc.setQueryData(qk.settingsNs(ns), res.values);
      toast.success(t("admin.settings.saved"));
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const set = (k: string, v: unknown) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="font-mono text-base">{ns}</CardTitle>
        <CardDescription>{t("admin.settings.namespaceHint")}</CardDescription>
        <CardAction className="flex gap-2">
          <Button variant="outline" size="sm" disabled={changedKeys.length === 0} onClick={() => original && setDraft(original)}>
            {t("admin.common.discard")}
          </Button>
          <Button size="sm" disabled={changedKeys.length === 0 || hasErrors || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            {t("admin.common.save")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {values.isError ? (
          <QueryError compact error={values.error} onRetry={() => void values.refetch()} />
        ) : !draft ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : Object.keys(draft).length === 0 ? (
          <EmptyState compact icon={SlidersHorizontalIcon} title={t("admin.settings.noKeys")} />
        ) : (
          <div className="divide-y">
            {Object.keys(draft)
              .sort()
              .map((k) => {
                const kind = kindOf(values.data?.[k]);
                const id = `setting-${ns}-${k}`;
                const changed = changedKeys.includes(k);
                return (
                  <div key={k} className="grid gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-6">
                    <div className="space-y-1">
                      <Label htmlFor={id} className="flex flex-wrap items-center gap-1.5">
                        {tOr(t, `admin.settings.key.${ns}.${k}`, humanizeKey(k))}
                        {changed && <span className="size-1.5 rounded-full bg-primary" aria-label={t("admin.settings.changed")} />}
                      </Label>
                      <div className="flex flex-wrap items-center gap-1">
                        <code className="text-xs text-muted-foreground">{k}</code>
                        {info.publicKeys?.includes(k) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="h-5 px-1.5">
                                <GlobeIcon />
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>{t("admin.settings.public")}</TooltipContent>
                          </Tooltip>
                        )}
                        {info.userOverridable?.includes(k) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="h-5 px-1.5">
                                <UserCogIcon />
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>{t("admin.settings.userOverridable")}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                    <div>
                      {kind === "boolean" ? (
                        <Switch id={id} checked={!!draft[k]} onCheckedChange={(v) => set(k, v)} />
                      ) : kind === "number" ? (
                        <Input
                          id={id}
                          type="number"
                          className="max-w-48"
                          value={String(draft[k] ?? "")}
                          onChange={(e) => set(k, e.target.value === "" ? 0 : Number(e.target.value))}
                        />
                      ) : kind === "json" ? (
                        <>
                          <Textarea
                            id={id}
                            rows={4}
                            spellCheck={false}
                            className="font-mono text-xs"
                            value={String(draft[k] ?? "")}
                            aria-invalid={jsonErrors[k] || undefined}
                            onChange={(e) => {
                              set(k, e.target.value);
                              let bad = false;
                              try {
                                JSON.parse(e.target.value);
                              } catch {
                                bad = true;
                              }
                              setJsonErrors((s) => ({ ...s, [k]: bad }));
                            }}
                          />
                          {jsonErrors[k] && <p className="mt-1 text-xs text-destructive">{t("admin.validation.json")}</p>}
                        </>
                      ) : (
                        <Input id={id} value={String(draft[k] ?? "")} onChange={(e) => set(k, e.target.value)} />
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
