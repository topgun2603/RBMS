"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LanguagesIcon, Loader2Icon, PencilIcon, PlusIcon, RotateCcwIcon, SearchIcon } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  type DataTableColumn,
} from "@rbms/ui";
import type { Messages } from "@rbms/i18n/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { api } from "@/lib/api";
import { describeError, LOCALE_NAMES, SUPPORTED_LOCALES, useI18n, type Locale } from "@/lib/i18n";
import { qk } from "@/lib/queries";
import type { I18nOverride } from "@/lib/types";

interface Row {
  key: string;
  value: string;
  override: I18nOverride | null;
}

const KEY_RE = /^[A-Za-z0-9_.-]+$/;

export default function TranslationsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [locale, setLocale] = React.useState<Locale>("en");
  const [q, setQ] = React.useState("");
  const [onlyOverridden, setOnlyOverridden] = React.useState(false);
  const [editing, setEditing] = React.useState<{ key: string; value: string; isNew: boolean } | null>(null);
  const [resetting, setResetting] = React.useState<Row | null>(null);

  const messages = useQuery({
    queryKey: qk.messages(locale),
    queryFn: () => api.get<{ messages: Messages }>("/i18n/messages", { locale }).then((r) => r.messages),
  });
  const overrides = useQuery({
    queryKey: qk.overrides,
    queryFn: () => api.get<{ items: I18nOverride[] }>("/i18n/overrides").then((r) => r.items),
  });

  const rows = React.useMemo<Row[]>(() => {
    const own = (overrides.data ?? []).filter((o) => o.locale === locale && !o.appId);
    const byKey = new Map(own.map((o) => [o.key, o]));
    const keys = new Set([...Object.keys(messages.data ?? {}), ...byKey.keys()]);
    const needle = q.trim().toLowerCase();
    return [...keys]
      .sort()
      .map((key) => {
        const o = byKey.get(key) ?? null;
        return { key, value: o?.value ?? messages.data?.[key] ?? "", override: o };
      })
      .filter((r) => (!onlyOverridden || r.override) && (!needle || r.key.toLowerCase().includes(needle) || r.value.toLowerCase().includes(needle)));
  }, [messages.data, overrides.data, locale, q, onlyOverridden]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["i18n"] });
  };

  const save = useMutation({
    mutationFn: (v: { key: string; value: string }) => api.put("/i18n/overrides", { locale, key: v.key, value: v.value }),
    onSuccess: () => {
      toast.success(t("admin.translations.saved"));
      invalidate();
      setEditing(null);
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const reset = useMutation({
    mutationFn: (r: Row) => api.delete("/i18n/overrides", { locale, key: r.key }),
    onSuccess: () => {
      toast.success(t("admin.translations.reset"));
      invalidate();
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const columns: DataTableColumn<Row>[] = [
    {
      id: "key",
      header: t("admin.translations.key"),
      width: "34%",
      cell: (r) => <code className="text-xs break-all whitespace-normal">{r.key}</code>,
    },
    {
      id: "value",
      header: t("admin.translations.value"),
      className: "whitespace-normal",
      cell: (r) => (
        <div className="flex items-start gap-2" lang={locale}>
          <span className="line-clamp-2">{r.value || <span className="text-muted-foreground italic">{t("admin.translations.empty")}</span>}</span>
          {r.override && (
            <Badge variant="secondary" className="shrink-0">
              {t("admin.translations.overridden")}
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("admin.common.actions")}</span>,
      align: "right",
      width: "96px",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={t("admin.common.edit")} onClick={() => setEditing({ key: r.key, value: r.value, isNew: false })}>
            <PencilIcon />
          </Button>
          {r.override && (
            <Button variant="ghost" size="icon-sm" aria-label={t("admin.translations.resetOne")} onClick={() => setResetting(r)}>
              <RotateCcwIcon />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const error = messages.error ?? overrides.error;

  return (
    <Page>
      <PageHeader
        title={t("admin.translations.title")}
        description={t("admin.translations.subtitle")}
        actions={
          <Button onClick={() => setEditing({ key: "", value: "", isNew: true })}>
            <PlusIcon /> {t("admin.translations.add")}
          </Button>
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Tabs value={locale} onValueChange={(v) => setLocale(v as Locale)}>
          <TabsList>
            {SUPPORTED_LOCALES.map((l) => (
              <TabsTrigger key={l} value={l} lang={l}>
                {LOCALE_NAMES[l]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("admin.translations.search")}
            size="sm"
            className="pl-8"
            aria-label={t("admin.common.search")}
          />
        </div>
        <Label className="flex items-center gap-2 text-sm font-normal text-muted-foreground sm:ml-auto">
          <Switch checked={onlyOverridden} onCheckedChange={setOnlyOverridden} />
          {t("admin.translations.onlyOverridden")}
        </Label>
      </div>

      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            void messages.refetch();
            void overrides.refetch();
          }}
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={messages.isLoading || overrides.isLoading}
          getRowId={(r) => r.key}
          pageSize={30}
          labels={{
            previous: t("admin.table.previous"),
            next: t("admin.table.next"),
            range: ({ from, to, total }) => t("admin.table.range", { from, to, total: total ?? to }),
          }}
          empty={<EmptyState compact icon={LanguagesIcon} title={q || onlyOverridden ? t("admin.common.noResults") : t("admin.translations.none")} />}
        />
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && !save.isPending && setEditing(null)}>
        <DialogContent closeLabel={t("admin.common.close")}>
          <DialogHeader>
            <DialogTitle>{editing?.isNew ? t("admin.translations.add") : t("admin.translations.edit")}</DialogTitle>
            <DialogDescription>{t("admin.translations.editHint", { locale: LOCALE_NAMES[locale] })}</DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (KEY_RE.test(editing.key)) save.mutate({ key: editing.key, value: editing.value });
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="tr-key">{t("admin.translations.key")}</Label>
                <Input
                  id="tr-key"
                  value={editing.key}
                  readOnly={!editing.isNew}
                  className="font-mono text-xs"
                  list="tr-keys"
                  placeholder="common.save"
                  aria-invalid={(editing.key !== "" && !KEY_RE.test(editing.key)) || undefined}
                  onChange={(e) => {
                    const key = e.target.value.trim();
                    setEditing({ ...editing, key, value: editing.value || messages.data?.[key] || "" });
                  }}
                />
                {editing.isNew && (
                  <datalist id="tr-keys">
                    {Object.keys(messages.data ?? {})
                      .slice(0, 500)
                      .map((k) => (
                        <option key={k} value={k} />
                      ))}
                  </datalist>
                )}
              </div>
              {!editing.isNew && messages.data?.[editing.key] !== undefined && (
                <div className="grid gap-1 rounded-md bg-muted/50 p-3 text-sm">
                  <span className="text-xs text-muted-foreground">{t("admin.translations.current")}</span>
                  <span lang={locale}>{messages.data[editing.key]}</span>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="tr-value">{t("admin.translations.value")}</Label>
                <Textarea
                  id="tr-value"
                  rows={4}
                  lang={locale}
                  maxLength={2000}
                  value={editing.value}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t("admin.translations.placeholdersHint")}</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={save.isPending}>
                  {t("admin.common.cancel")}
                </Button>
                <Button type="submit" disabled={save.isPending || !KEY_RE.test(editing.key)}>
                  {save.isPending && <Loader2Icon className="animate-spin" />}
                  {t("admin.common.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={resetting !== null}
        onOpenChange={(o) => !o && setResetting(null)}
        title={t("admin.translations.resetTitle")}
        description={t("admin.translations.resetDescription", { key: resetting?.key ?? "" })}
        confirmLabel={t("admin.translations.resetOne")}
        onConfirm={() => (resetting ? reset.mutateAsync(resetting) : undefined)}
      />
    </Page>
  );
}
