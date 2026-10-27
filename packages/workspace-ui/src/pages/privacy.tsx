"use client";

import * as React from "react";
import { EyeIcon, Loader2Icon, PlayIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Card, CardContent, ChipGroup, EmptyState, Field, FieldControl, FieldHint, FieldLabel, Input, Skeleton, StatusPill, Switch, Textarea, toast } from "@srirealtime/ui";
import { ConfirmDialog, describeError, Page, PageHeading, SettingsNav, useI18n } from "@srirealtime/web";
import { NoPermission } from "../components/bits";
import { BreachesTab } from "../components/privacy/breaches";
import { RequestsTab } from "../components/privacy/requests";
import { useHasPermission } from "../lib/access";
import {
  useNoticePreview,
  usePrivacySettings,
  useRetention,
  useRetentionActions,
  useSavePrivacySettings,
  type NoticeText,
  type PrivacySettings,
  type RetentionItem,
} from "../lib/queries-privacy";

/**
 * Settings > Privacy & data (DPDP, docs/privacy-dpdp.md): the generated notice and grievance contact, customers' data requests,
 * retention rules with a dry-run preview, and the data breach register. Owners, admins and people with `privacy.manage`.
 */
type Tab = "notice" | "requests" | "retention" | "breaches";

export default function PrivacyPage() {
  const { t } = useI18n();
  const allowed = useHasPermission("privacy.manage");
  const [tab, setTab] = React.useState<Tab>("notice");
  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={ShieldCheckIcon} title={t("workspace.nav.privacy")} description={t("workspace.privacy.subtitle")} />
      {!allowed ? (
        <NoPermission permission="privacy.manage" />
      ) : (
        <>
          <Alert className="mb-3">
            <TriangleAlertIcon />
            <AlertDescription>{t("workspace.privacy.legal")}</AlertDescription>
          </Alert>
          <ChipGroup
            aria-label={t("workspace.privacy.tab")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "notice", label: t("workspace.privacy.tab.notice") },
              { value: "requests", label: t("workspace.privacy.tab.requests") },
              { value: "retention", label: t("workspace.privacy.tab.retention") },
              { value: "breaches", label: t("workspace.privacy.tab.breaches") },
            ]}
          />
          <div className="mt-4 grid gap-4">
            {tab === "notice" && <NoticeTab />}
            {tab === "requests" && <RequestsTab />}
            {tab === "retention" && <RetentionTab />}
            {tab === "breaches" && <BreachesTab />}
          </div>
        </>
      )}
    </Page>
  );
}

// ------------------------------------------------------------------ notice and contact

function NoticeText({ text }: { text: NoticeText }) {
  return (
    <div className="grid gap-4 text-sm leading-relaxed" data-testid="privacy-notice-text">
      <p>{text.intro}</p>
      {text.sections.map((s) => (
        <div key={s.id} className="grid gap-1">
          <h4 className="font-semibold">{s.heading}</h4>
          {s.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {s.items && (
            <ul className="list-disc space-y-0.5 pl-5">
              {s.items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function NoticeTab() {
  const { t, formatDate } = useI18n();
  const preview = useNoticePreview();
  const settings = usePrivacySettings();
  const save = useSavePrivacySettings();
  const [lang, setLang] = React.useState<"en" | "ta">("en");
  const [draft, setDraft] = React.useState<PrivacySettings | null>(null);
  React.useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);

  if (preview.isLoading || settings.isLoading || !draft) return <Skeleton className="h-64" />;
  if (preview.isError || settings.isError) return <p className="text-sm text-destructive">{t("workspace.privacy.loadError")}</p>;
  const n = preview.data!;
  const set = <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) => setDraft({ ...draft, [key]: value });
  const text = (key: keyof PrivacySettings, label: string, hint?: string) => (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        <Input value={String(draft[key] ?? "")} onChange={(e) => set(key, e.target.value as never)} />
      </FieldControl>
      {hint && <FieldHint>{hint}</FieldHint>}
    </Field>
  );

  return (
    <>
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div>
            <h3 className="font-semibold">{t("workspace.privacy.contact.title")}</h3>
            <p className="text-sm text-muted-foreground">{t("workspace.privacy.contact.hint")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("grievanceName", t("workspace.privacy.contact.name"))}
            {text("grievanceRole", t("workspace.privacy.contact.role"))}
            {text("grievancePhone", t("workspace.privacy.contact.phone"))}
            {text("grievanceEmail", t("workspace.privacy.contact.email"))}
          </div>
          {text("grievanceAddress", t("workspace.privacy.contact.address"))}
          <Field>
            <FieldLabel>{t("workspace.privacy.contact.responseDays")}</FieldLabel>
            <FieldControl>
              <Input type="number" min={1} max={90} className="w-28" value={draft.responseDays} onChange={(e) => set("responseDays", Math.max(1, Math.min(90, Number(e.target.value) || 30)))} />
            </FieldControl>
            <FieldHint>{t("workspace.privacy.contact.responseDaysHint")}</FieldHint>
          </Field>
          <Field>
            <FieldLabel>{t("workspace.privacy.contact.extra")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} maxLength={1000} value={draft.noticeExtra} onChange={(e) => set("noticeExtra", e.target.value)} />
            </FieldControl>
            <FieldHint>{t("workspace.privacy.contact.extraHint")}</FieldHint>
          </Field>
          <Button
            className="justify-self-start"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  grievanceName: draft.grievanceName,
                  grievanceRole: draft.grievanceRole,
                  grievancePhone: draft.grievancePhone,
                  grievanceEmail: draft.grievanceEmail,
                  grievanceAddress: draft.grievanceAddress,
                  responseDays: draft.responseDays,
                  noticeExtra: draft.noticeExtra,
                },
                { onSuccess: () => toast.success(t("workspace.privacy.saved")), onError: (e) => toast.error(describeError(e, t)) },
              )
            }
          >
            {save.isPending && <Loader2Icon className="animate-spin" />}
            {t("workspace.privacy.save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t("workspace.privacy.notice.title")}</h3>
            <ChipGroup
              aria-label={t("workspace.privacy.notice.title")}
              value={lang}
              onChange={setLang}
              options={[
                { value: "en", label: t("workspace.privacy.notice.english") },
                { value: "ta", label: t("workspace.privacy.notice.tamil") },
              ]}
            />
          </div>
          <Alert>
            <TriangleAlertIcon />
            <AlertDescription>{n.content[lang].reviewNote || t("workspace.privacy.notice.review")}</AlertDescription>
          </Alert>
          <p className="text-xs text-muted-foreground">
            {t("workspace.privacy.notice.version", { version: n.current.version, date: formatDate(n.current.createdAt) })} {t("workspace.privacy.notice.where")}
          </p>
          <NoticeText text={n.content[lang]} />
          {n.versions.length > 1 && <p className="text-xs text-muted-foreground">{t("workspace.privacy.notice.versions", { list: n.versions.slice(1).map((v) => `v${v.version} (${formatDate(v.createdAt)})`).join(", ") })}</p>}
        </CardContent>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ retention

function RetentionTab() {
  const { t, formatDate } = useI18n();
  const formatDateTime = (d: string) => formatDate(d, { dateStyle: "medium", timeStyle: "short" });
  const q = useRetention();
  const settings = usePrivacySettings();
  const save = useSavePrivacySettings();
  const actions = useRetentionActions();
  const [local, setLocal] = React.useState<Record<string, { enabled: boolean; days: number }>>({});
  const [preview, setPreview] = React.useState<Record<string, RetentionItem>>({});
  const [confirmRun, setConfirmRun] = React.useState(false);

  if (q.isLoading || settings.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <p className="text-sm text-destructive">{t("workspace.privacy.loadError")}</p>;
  const items = q.data.items;
  const value = (i: RetentionItem) => local[i.key] ?? { enabled: i.enabled, days: i.days };
  const dirty = Object.keys(local).length > 0;
  const saveAll = () => {
    const next = { ...(settings.data?.retention ?? {}), ...local };
    save.mutate(
      { retention: next },
      {
        onSuccess: () => {
          setLocal({});
          void q.refetch();
          toast.success(t("workspace.privacy.saved"));
        },
        onError: (e) => toast.error(describeError(e, t)),
      },
    );
  };

  return (
    <>
      <Card>
        <CardContent className="grid gap-3 pt-6">
          <h3 className="font-semibold">{t("workspace.privacy.ret.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("workspace.privacy.ret.hint")}</p>
          <p className="text-sm font-medium">{t("workspace.privacy.ret.tax")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={actions.preview.isPending}
              onClick={() =>
                actions.preview.mutate(undefined, {
                  onSuccess: (r) => {
                    setPreview(Object.fromEntries(r.items.map((i) => [i.key, i])));
                    toast.success(t("workspace.privacy.ret.previewDone"));
                  },
                  onError: (e) => toast.error(describeError(e, t)),
                })
              }
            >
              {actions.preview.isPending ? <Loader2Icon className="animate-spin" /> : <EyeIcon />}
              {t("workspace.privacy.ret.preview")}
            </Button>
            <Button variant="outline" onClick={() => setConfirmRun(true)}>
              <PlayIcon />
              {t("workspace.privacy.ret.run")}
            </Button>
            {dirty && (
              <Button disabled={save.isPending} onClick={saveAll}>
                {save.isPending && <Loader2Icon className="animate-spin" />}
                {t("workspace.privacy.save")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {items.map((i) => {
          const v = value(i);
          const p = preview[i.key];
          return (
            <Card key={i.key}>
              <CardContent className="grid gap-2 pt-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{t(`workspace.privacy.ret.cat.${i.key}`)}</p>
                    <p className="text-sm text-muted-foreground">{t(`workspace.privacy.ret.cat.${i.key}.desc`)}</p>
                  </div>
                  <StatusPill tone={i.action === "delete" ? "warning" : "info"}>{t(`workspace.privacy.ret.action.${i.action}`)}</StatusPill>
                </div>
                {i.managedBy ? (
                  <p className="text-xs text-muted-foreground">{t("workspace.privacy.ret.managed", { job: i.managedBy.job, days: i.managedBy.days })}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={v.enabled} onCheckedChange={(on) => setLocal({ ...local, [i.key]: { ...v, enabled: on } })} aria-label={t("workspace.privacy.ret.on")} />
                      {t("workspace.privacy.ret.on")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      {t("workspace.privacy.ret.days")}
                      <Input type="number" className="w-24" min={i.minDays} value={v.days} onChange={(e) => setLocal({ ...local, [i.key]: { ...v, days: Math.max(i.minDays, Number(e.target.value) || i.defaultDays) } })} />
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {t("workspace.privacy.ret.default", { days: i.defaultDays })}
                      {i.minDays > 1 ? ` · ${t("workspace.privacy.ret.min", { days: i.minDays })}` : ""}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{i.lastRun ? t("workspace.privacy.ret.last", { date: formatDateTime(i.lastRun.at), count: i.lastRun.affected }) : t("workspace.privacy.ret.never")}</span>
                  {p && p.affected != null && <StatusPill tone={p.affected > 0 ? "warning" : "success"}>{t("workspace.privacy.ret.affected", { count: p.affected })}</StatusPill>}
                  {p?.error && <span className="text-destructive">{p.error}</span>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="grid gap-2 pt-6">
          <h3 className="font-semibold">{t("workspace.privacy.ret.runs")}</h3>
          {q.data.runs.length === 0 ? (
            <EmptyState compact title={t("workspace.privacy.ret.never")} />
          ) : (
            <ul className="divide-y text-sm">
              {q.data.runs.slice(0, 15).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {t(`workspace.privacy.ret.cat.${r.category}`)}
                    {r.dryRun ? ` (${t("workspace.privacy.ret.dry")})` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.status === "failed" ? t("workspace.privacy.ret.failed") : r.affected} · {formatDate(r.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmRun}
        onOpenChange={setConfirmRun}
        title={t("workspace.privacy.ret.runTitle")}
        description={t("workspace.privacy.ret.runBody")}
        confirmLabel={t("workspace.privacy.ret.run")}
        onConfirm={async () => {
          await actions.run.mutateAsync();
          setPreview({});
          toast.success(t("workspace.privacy.ret.runDone"));
        }}
      />
    </>
  );
}
