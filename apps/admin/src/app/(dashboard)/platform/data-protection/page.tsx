"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, CheckIcon, ClipboardCopyIcon, EyeIcon, Loader2Icon, PlayIcon, PlusIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Card, CardContent, EmptyState, Input, PageHeader, Skeleton, StatusPill, Switch, Textarea, toast } from "@srirealtime/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Page } from "@/components/page";
import { SuperAdminOnly } from "@/components/superadmin-only";
import { api } from "@/lib/api";
import { describeError, useI18n } from "@/lib/i18n";

/**
 * Platform > Data protection (DPDP, docs/privacy-dpdp.md): RBMS's notice for shop owners and grievance contact, platform data
 * retention, and the breach register (RBMS's own incidents and every shop's). Super-admins only.
 */
const P = { tenant: null } as const;
const BREACH_TYPES = ["phone", "email", "address", "purchases", "health", "id_documents", "payment", "staff", "credentials", "other"] as const;
const CHECK = ["contain", "preserve_evidence", "assess", "intimate_board", "notify_people", "report_board", "fix_cause", "review"] as const;

interface Settings {
  grievanceName: string;
  grievanceRole: string;
  grievancePhone: string;
  grievanceEmail: string;
  grievanceAddress: string;
  responseDays: number;
  retention: Record<string, { enabled: boolean; days: number }>;
  noticeExtra: string;
}
interface Notice {
  content: { en: NoticeText; ta: NoticeText };
  current: { version: number; createdAt: string };
}
interface NoticeText {
  intro: string;
  reviewNote: string;
  sections: { id: string; heading: string; paragraphs: string[]; items?: string[] }[];
}
interface RetItem {
  key: string;
  action: "delete" | "anonymise";
  enabled: boolean;
  days: number;
  defaultDays: number;
  minDays: number;
  managedBy: { job: string; days: number } | null;
  lastRun: { at: string; affected: number } | null;
  affected?: number | null;
}
interface Breach {
  id: string;
  tenantId: string | null;
  reference: string;
  title: string;
  description: string;
  status: "open" | "contained" | "reported" | "closed";
  discoveredAt: string;
  dataTypes: string[];
  boardIntimatedAt: string | null;
  boardReportedAt: string | null;
  boardReference: string | null;
  peopleNotifiedAt: string | null;
  checklist: Record<string, string>;
  countdown: { deadlineAt: string; hoursLeft: number | null; state: "ok" | "due_soon" | "overdue" | "done" };
}
interface BreachDetail {
  incident: Breach;
  drafts: { people: { en: string; ta: string }; board: { en: string; ta: string } };
}

const K = ["admin-dp"] as const;
const CLOCK_TONE = { ok: "success", due_soon: "warning", overdue: "danger", done: "success" } as const;

export default function DataProtectionPage() {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<"notice" | "retention" | "breaches">("notice");
  return (
    <SuperAdminOnly>
      <Page className="max-w-4xl">
        <PageHeader title={t("admin.dp.platformTitle")} description={t("admin.dp.platformSubtitle")} />
        <Alert className="mb-4">
          <TriangleAlertIcon />
          <AlertDescription>{t("admin.dp.legal")}</AlertDescription>
        </Alert>
        <div role="tablist" aria-label={t("admin.dp.tab")} className="mb-4 flex flex-wrap gap-2">
          {(["notice", "retention", "breaches"] as const).map((k) => (
            <Button key={k} role="tab" aria-selected={tab === k} size="sm" variant={tab === k ? "default" : "outline"} onClick={() => setTab(k)}>
              {t(`admin.dp.tab.${k}`)}
            </Button>
          ))}
        </div>
        <div className="grid gap-4">
          {tab === "notice" && <NoticeTab />}
          {tab === "retention" && <RetentionTab />}
          {tab === "breaches" && <BreachesTab />}
        </div>
      </Page>
    </SuperAdminOnly>
  );
}

function NoticeTab() {
  const { t, formatDate } = useI18n();
  const qc = useQueryClient();
  const notice = useQuery({ queryKey: [...K, "notice"], queryFn: () => api.get<Notice>("/consent/notice/preview", undefined, P) });
  const settings = useQuery({ queryKey: [...K, "settings"], queryFn: () => api.get<{ values: Settings }>("/settings/privacy", undefined, P).then((r) => r.values) });
  const [draft, setDraft] = React.useState<Settings | null>(null);
  const [lang, setLang] = React.useState<"en" | "ta">("en");
  React.useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);
  const save = useMutation({
    mutationFn: (b: Partial<Settings>) => api.put("/settings/privacy/app", b, P),
    onSuccess: () => {
      toast.success(t("admin.dp.saved"));
      void qc.invalidateQueries({ queryKey: K });
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  if (!draft || !notice.data) return <Skeleton className="h-64" />;
  const set = <K2 extends keyof Settings>(k: K2, v: Settings[K2]) => setDraft({ ...draft, [k]: v });
  const field = (k: keyof Settings, label: string) => (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <Input value={String(draft[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} />
    </label>
  );
  const text = notice.data.content[lang];
  return (
    <>
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <h3 className="font-semibold">{t("admin.dp.platformContact")}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("grievanceName", t("admin.dp.contact.name"))}
            {field("grievanceRole", t("admin.dp.contact.role"))}
            {field("grievancePhone", t("admin.dp.contact.phone"))}
            {field("grievanceEmail", t("admin.dp.contact.email"))}
          </div>
          {field("grievanceAddress", t("admin.dp.contact.address"))}
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{t("admin.dp.contact.responseDays")}</span>
            <Input type="number" min={1} max={90} className="w-28" value={draft.responseDays} onChange={(e) => set("responseDays", Math.max(1, Math.min(90, Number(e.target.value) || 30)))} />
            <span className="text-xs text-muted-foreground">{t("admin.dp.contact.responseDaysHint")}</span>
          </label>
          <Button
            className="justify-self-start"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                grievanceName: draft.grievanceName,
                grievanceRole: draft.grievanceRole,
                grievancePhone: draft.grievancePhone,
                grievanceEmail: draft.grievanceEmail,
                grievanceAddress: draft.grievanceAddress,
                responseDays: draft.responseDays,
              })
            }
          >
            {save.isPending && <Loader2Icon className="animate-spin" />}
            {t("admin.dp.save")}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t("admin.dp.platformNotice")}</h3>
            <div className="flex gap-1">
              {(["en", "ta"] as const).map((l) => (
                <Button key={l} size="sm" variant={lang === l ? "default" : "outline"} onClick={() => setLang(l)}>
                  {l === "en" ? t("admin.dp.notice.english") : t("admin.dp.notice.tamil")}
                </Button>
              ))}
            </div>
          </div>
          <Alert>
            <TriangleAlertIcon />
            <AlertDescription>{text.reviewNote}</AlertDescription>
          </Alert>
          <p className="text-xs text-muted-foreground">{t("admin.dp.notice.version", { version: notice.data.current.version, date: formatDate(notice.data.current.createdAt) })}</p>
          <div className="grid gap-3 text-sm leading-relaxed">
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
        </CardContent>
      </Card>
    </>
  );
}

function RetentionTab() {
  const { t, formatDateTime } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...K, "retention"], queryFn: () => api.get<{ items: RetItem[] }>("/consent/retention", undefined, P) });
  const settings = useQuery({ queryKey: [...K, "settings"], queryFn: () => api.get<{ values: Settings }>("/settings/privacy", undefined, P).then((r) => r.values) });
  const [local, setLocal] = React.useState<Record<string, { enabled: boolean; days: number }>>({});
  const [preview, setPreview] = React.useState<Record<string, number | null>>({});
  const [confirm, setConfirm] = React.useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: K });
  const save = useMutation({
    mutationFn: () => api.put("/settings/privacy/app", { retention: { ...(settings.data?.retention ?? {}), ...local } }, P),
    onSuccess: () => {
      setLocal({});
      toast.success(t("admin.dp.saved"));
      refresh();
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  const dry = useMutation({
    mutationFn: () => api.post<{ items: RetItem[] }>("/consent/retention/preview", {}, P),
    onSuccess: (r) => {
      setPreview(Object.fromEntries(r.items.map((i) => [i.key, i.affected ?? null])));
      toast.success(t("admin.dp.ret.previewDone"));
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  const run = useMutation({ mutationFn: () => api.post("/consent/retention/run", { confirm: true }, P), onSuccess: () => { setPreview({}); toast.success(t("admin.dp.ret.runDone")); refresh(); } });
  if (!q.data) return <Skeleton className="h-64" />;
  return (
    <>
      <Card>
        <CardContent className="grid gap-3 pt-6">
          <h3 className="font-semibold">{t("admin.dp.ret.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("admin.dp.ret.hint")}</p>
          <p className="text-sm text-muted-foreground">{t("admin.dp.retention.platformOnly")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={dry.isPending} onClick={() => dry.mutate()}>
              {dry.isPending ? <Loader2Icon className="animate-spin" /> : <EyeIcon />} {t("admin.dp.ret.preview")}
            </Button>
            <Button variant="outline" onClick={() => setConfirm(true)}>
              <PlayIcon /> {t("admin.dp.ret.run")}
            </Button>
            {Object.keys(local).length > 0 && (
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                {t("admin.dp.save")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      {q.data.items.map((i) => {
        const v = local[i.key] ?? { enabled: i.enabled, days: i.days };
        return (
          <Card key={i.key}>
            <CardContent className="grid gap-2 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{t(`admin.dp.ret.cat.${i.key}`)}</p>
                  <p className="text-sm text-muted-foreground">{t(`admin.dp.ret.cat.${i.key}.desc`)}</p>
                </div>
                <StatusPill tone={i.action === "delete" ? "warning" : "info"}>{t(`admin.dp.ret.action.${i.action}`)}</StatusPill>
              </div>
              {i.managedBy ? (
                <p className="text-xs text-muted-foreground">{t("admin.dp.ret.managed", { job: i.managedBy.job, days: i.managedBy.days })}</p>
              ) : (
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={v.enabled} onCheckedChange={(on) => setLocal({ ...local, [i.key]: { ...v, enabled: on } })} aria-label={t("admin.dp.ret.on")} />
                    {t("admin.dp.ret.on")}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    {t("admin.dp.ret.days")}
                    <Input type="number" className="w-24" min={i.minDays} value={v.days} onChange={(e) => setLocal({ ...local, [i.key]: { ...v, days: Math.max(i.minDays, Number(e.target.value) || i.defaultDays) } })} />
                  </label>
                  <span className="text-xs text-muted-foreground">{t("admin.dp.ret.default", { days: i.defaultDays })}</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{i.lastRun ? t("admin.dp.ret.last", { date: formatDateTime(i.lastRun.at), count: i.lastRun.affected }) : t("admin.dp.ret.never")}</span>
                {preview[i.key] != null && <StatusPill tone={preview[i.key]! > 0 ? "warning" : "success"}>{t("admin.dp.ret.affected", { count: preview[i.key]! })}</StatusPill>}
              </div>
            </CardContent>
          </Card>
        );
      })}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("admin.dp.ret.runTitle")}
        description={t("admin.dp.ret.runBody")}
        confirmLabel={t("admin.dp.ret.run")}
        onConfirm={() => run.mutateAsync()}
      />
    </>
  );
}

function BreachesTab() {
  const { t } = useI18n();
  const list = useQuery({ queryKey: [...K, "breaches"], queryFn: () => api.get<{ items: Breach[]; openOverdue: number }>("/consent/breaches", { all: 1 }, P) });
  const [open, setOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  if (open) return <BreachView id={open} onBack={() => setOpen(null)} />;
  if (adding) return <NewBreach onDone={() => setAdding(false)} />;
  return (
    <>
      <Card>
        <CardContent className="grid gap-2 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{t("admin.dp.br.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("admin.dp.br.hint")}</p>
              <p className="text-xs text-muted-foreground">{t("admin.dp.allShops")}</p>
            </div>
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> {t("admin.dp.br.new")}
            </Button>
          </div>
          {!!list.data?.openOverdue && <StatusPill tone="danger">{t("admin.dp.br.overdueCount", { count: list.data.openOverdue })}</StatusPill>}
        </CardContent>
      </Card>
      {!list.data ? (
        <Skeleton className="h-32" />
      ) : list.data.items.length === 0 ? (
        <EmptyState compact icon={ShieldCheckIcon} title={t("admin.dp.br.none")} />
      ) : (
        <ul className="grid gap-2">
          {list.data.items.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => setOpen(b.id)} className="grid w-full gap-1 rounded-xl border bg-card p-4 text-left hover:bg-accent/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {b.reference} · {b.title}
                  </span>
                  <StatusPill tone="neutral">{t(`admin.dp.br.status.${b.status}`)}</StatusPill>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Clock b={b} />
                  <span>{b.tenantId ? t("admin.dp.scope.shop", { id: b.tenantId.slice(0, 8) }) : t("admin.dp.scope.platform")}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Clock({ b }: { b: Breach }) {
  const { t } = useI18n();
  const c = b.countdown;
  return <StatusPill tone={CLOCK_TONE[c.state]}>{t(`admin.dp.br.clock.${c.state}`, { hours: c.hoursLeft === null ? "" : String(Math.abs(Math.round(c.hoursLeft))) })}</StatusPill>;
}

function NewBreach({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [people, setPeople] = React.useState("");
  const [containment, setContainment] = React.useState("");
  const [types, setTypes] = React.useState<string[]>([]);
  const create = useMutation({
    mutationFn: () =>
      api.post(
        "/consent/breaches",
        { title: title.trim(), description: description.trim(), containment: containment.trim(), dataTypes: types, ...(people !== "" ? { peopleAffected: Number(people) } : {}) },
        P,
      ),
    onSuccess: () => {
      toast.success(t("admin.dp.br.created"));
      void qc.invalidateQueries({ queryKey: K });
      onDone();
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <Button variant="ghost" className="justify-self-start" onClick={onDone}>
          <ArrowLeftIcon /> {t("admin.dp.br.back")}
        </Button>
        <Alert>
          <AlertDescription>{t("admin.dp.br.nosend")}</AlertDescription>
        </Alert>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t("admin.dp.br.field.title")}</span>
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t("admin.dp.br.field.description")}</span>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <fieldset className="flex flex-wrap gap-3">
          <legend className="mb-1 text-sm font-medium">{t("admin.dp.br.field.dataTypes")}</legend>
          {BREACH_TYPES.map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={types.includes(k)} onChange={(e) => setTypes(e.target.checked ? [...types, k] : types.filter((x) => x !== k))} />
              {t(`admin.dp.br.type.${k}`)}
            </label>
          ))}
        </fieldset>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t("admin.dp.br.field.people")}</span>
          <Input type="number" min={0} className="w-32" value={people} onChange={(e) => setPeople(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t("admin.dp.br.field.containment")}</span>
          <Textarea rows={2} value={containment} onChange={(e) => setContainment(e.target.value)} />
        </label>
        <Button className="justify-self-start" disabled={title.trim().length < 3 || create.isPending} onClick={() => create.mutate()}>
          {create.isPending && <Loader2Icon className="animate-spin" />}
          {t("admin.dp.br.create")}
        </Button>
      </CardContent>
    </Card>
  );
}

function BreachView({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, formatDateTime } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...K, "breach", id], queryFn: () => api.get<BreachDetail>(`/consent/breaches/${id}`, undefined, P) });
  const [ref, setRef] = React.useState("");
  const [lang, setLang] = React.useState<"en" | "ta">("en");
  const done = () => void qc.invalidateQueries({ queryKey: K });
  const fail = (e: unknown) => toast.error(describeError(e, t));
  const tick = useMutation({ mutationFn: (b: { key: string; done: boolean }) => api.post(`/consent/breaches/${id}/checklist`, b, P), onSuccess: done, onError: fail });
  const board = useMutation({ mutationFn: (stage: "intimation" | "report") => api.post(`/consent/breaches/${id}/board`, { stage, reference: ref.trim() || undefined }, P), onSuccess: done, onError: fail });
  const notified = useMutation({ mutationFn: () => api.post(`/consent/breaches/${id}/people-notified`, {}, P), onSuccess: done, onError: fail });
  const close = useMutation({ mutationFn: () => api.post(`/consent/breaches/${id}/close`, {}, P), onSuccess: done, onError: fail });
  if (!q.data) return <Skeleton className="h-64" />;
  const b = q.data.incident;
  const closed = b.status === "closed";
  const drafts = q.data.drafts;
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => toast.success(t("admin.dp.br.copied")));
  return (
    <div className="grid gap-4">
      <Button variant="ghost" className="justify-self-start" onClick={onBack}>
        <ArrowLeftIcon /> {t("admin.dp.br.back")}
      </Button>
      <Card>
        <CardContent className="grid gap-3 pt-6">
          <h3 className="font-semibold">
            {b.reference} · {b.title}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Clock b={b} />
            <span>{t("admin.dp.br.deadline", { date: formatDateTime(b.countdown.deadlineAt) })}</span>
          </div>
          {b.description && <p className="text-sm">{b.description}</p>}
          <Alert>
            <AlertDescription>{t("admin.dp.br.nosend")}</AlertDescription>
          </Alert>
          <p className="text-sm">
            {t("admin.dp.br.board.intimation")}: {b.boardIntimatedAt ? formatDateTime(b.boardIntimatedAt) : t("admin.dp.br.notNotified")}
            <br />
            {t("admin.dp.br.board.report")}: {b.boardReportedAt ? formatDateTime(b.boardReportedAt) : t("admin.dp.br.notNotified")}
            {b.boardReference ? ` · ${b.boardReference}` : ""}
            <br />
            {t("admin.dp.br.notified")}: {b.peopleNotifiedAt ? formatDateTime(b.peopleNotifiedAt) : t("admin.dp.br.notNotified")}
          </p>
          {!closed && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">{t("admin.dp.br.board.ref")}</span>
                <Input value={ref} onChange={(e) => setRef(e.target.value)} />
              </label>
              {!b.boardIntimatedAt && (
                <Button variant="outline" onClick={() => board.mutate("intimation")}>
                  {t("admin.dp.br.board.markIntimation")}
                </Button>
              )}
              {!b.boardReportedAt && <Button onClick={() => board.mutate("report")}>{t("admin.dp.br.board.markReport")}</Button>}
              {!b.peopleNotifiedAt && (
                <Button variant="outline" onClick={() => notified.mutate()}>
                  {t("admin.dp.br.markNotified")}
                </Button>
              )}
              <Button variant="outline" disabled={!b.boardReportedAt || close.isPending} onClick={() => close.mutate()}>
                {t("admin.dp.br.closeIncident")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-2 pt-6">
          <h3 className="font-semibold">{t("admin.dp.br.checklist")}</h3>
          {CHECK.map((k) => (
            <label key={k} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={!!b.checklist[k]} disabled={closed} onChange={(e) => tick.mutate({ key: k, done: e.target.checked })} />
              <span>{t(`admin.dp.br.check.${k}`)}</span>
              {b.checklist[k] && <CheckIcon className="mt-0.5 size-3.5 text-success-ink" />}
            </label>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t("admin.dp.br.drafts")}</h3>
            <div className="flex gap-1">
              {(["en", "ta"] as const).map((l) => (
                <Button key={l} size="sm" variant={lang === l ? "default" : "outline"} onClick={() => setLang(l)}>
                  {l === "en" ? t("admin.dp.notice.english") : t("admin.dp.notice.tamil")}
                </Button>
              ))}
            </div>
          </div>
          {(["people", "board"] as const).map((k) => (
            <div key={k} className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">{t(`admin.dp.br.draft.${k}`)}</h4>
                <Button size="sm" variant="outline" onClick={() => copy(drafts[k][lang])}>
                  <ClipboardCopyIcon /> {t("admin.dp.br.copy")}
                </Button>
              </div>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap">{drafts[k][lang]}</pre>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
