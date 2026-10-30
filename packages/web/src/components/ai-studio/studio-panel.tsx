"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon, BanIcon, CheckCircle2Icon, ChevronDownIcon, CircleAlertIcon, Loader2Icon, SendIcon, ShieldAlertIcon, SparklesIcon, TriangleAlertIcon, Undo2Icon } from "lucide-react";
import { Alert, AlertDescription, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Skeleton, StatusPill, Textarea, toast, type StatusTone } from "@rbms/ui";
import { api, ApiError } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { AiDraftBanner, sendAiFeedback } from "../ai-draft";
import { studioPreviewComponent } from "./studio-preview";
import { VoiceInput } from "../ai-assist/voice";

type Bi = { en: string; ta: string };
type Risk = "low" | "medium" | "high";
type Classification = "full" | "partial" | "none";
type Status = "planned" | "applied" | "undone" | "cancelled" | "failed" | "rejected";

interface StudioOp {
  kind: string;
  status: "ok" | "blocked" | "invalid";
  label: Bi;
  description: Bi;
  risk: Risk;
  group: string;
  alternative?: boolean;
  problem?: { code: string; text: Bi };
  warnings: Bi[];
}
interface ChangeLine {
  area: string;
  label: Bi;
  before: Bi;
  after: Bi;
}
export interface StudioChange {
  id: string;
  status: Status;
  createdAt: string;
  request: string;
  language: "en" | "ta";
  summary: string;
  notes: string;
  classification: Classification;
  ops: StudioOp[];
  unsupported: { text: string; missing: string; theme: string }[];
  refused: { text: string; reason: string }[];
  preview: { lines: ChangeLine[]; tokens?: Record<string, unknown>; sections?: Record<string, unknown>[] };
  highRisk: boolean;
  canApply: boolean;
  canUndo: boolean;
  featureRequestSaved: boolean;
  credits: number;
  runId: string | null;
  appliedAt: string | null;
  undoneAt: string | null;
}
interface Meta {
  suggestions: Bi[];
  operations: { kind: string; label: Bi; group: string; groupLabel: Bi; risk: Risk }[];
}

const CLASS_TONE: Record<Classification, { tone: StatusTone; icon: typeof CheckCircle2Icon }> = {
  full: { tone: "success", icon: CheckCircle2Icon },
  partial: { tone: "warning", icon: TriangleAlertIcon },
  none: { tone: "neutral", icon: BanIcon },
};
const RISK_TONE: Record<Risk, StatusTone> = { low: "neutral", medium: "info", high: "danger" };
const STATUS_TONE: Record<Status, StatusTone> = { planned: "brand", applied: "success", undone: "neutral", cancelled: "neutral", failed: "danger", rejected: "neutral" };

const KEY = { meta: ["ai", "studio", "meta"], changes: ["ai", "studio", "changes"] } as const;

/** Studio assistant error text: the server's Tamil sentence when it sent one and the app is in Tamil. */
function studioError(err: unknown, t: ReturnType<typeof useI18n>["t"], locale: string): string {
  if (err instanceof ApiError && err.code === "studio_stale") return t("web.aiStudio.stale");
  if (err instanceof ApiError && locale === "ta") {
    const d = err.details as { ta?: string; problem?: Bi } | undefined;
    if (d?.problem?.ta) return d.problem.ta;
    if (d?.ta) return d.ta;
  }
  if (err instanceof ApiError && (err.code === "studio_recheck_failed" || err.code === "studio_no_change" || err.code === "studio_confirm_required")) return err.message;
  return describeError(err, t);
}

/**
 * Studio assistant: ask for a change to how the shop looks or works in Tamil, Tanglish or English, read the checked plan
 * (steps, risk, what is not possible), see before -> after (and the real store when this app has one), then Apply, with
 * a second confirmation for money, permission and sign-in changes. History keeps every request with Undo.
 */
export function StudioAssistant() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const ta = locale === "ta";
  const pick = (b: Bi) => (ta ? b.ta : b.en);
  const meta = useQuery({ queryKey: KEY.meta, queryFn: () => api.get<Meta>("/ai/studio/meta"), staleTime: 300_000, retry: false });
  const history = useQuery({ queryKey: KEY.changes, queryFn: () => api.get<{ items: StudioChange[] }>("/ai/studio/changes"), retry: false });
  const [text, setText] = React.useState("");
  const [current, setCurrent] = React.useState<StudioChange | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [conflicts, setConflicts] = React.useState<{ area: string; lines: ChangeLine[] }[] | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const resultRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (current) resultRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [current?.id]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY.changes });
    // The store changed: branding, home, menus, settings and team screens refetch what they show.
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "ai" || q.queryKey[1] === "status" });
  };

  const plan = useMutation({
    mutationFn: (request: string) => api.post<StudioChange>("/ai/studio/plan", { request }),
    onSuccess: (v) => {
      setCurrent(v);
      setError(null);
      setNotice(null);
      setConflicts(null);
      void qc.invalidateQueries({ queryKey: KEY.changes });
      void qc.invalidateQueries({ queryKey: ["ai", "status"] });
    },
    onError: (e) => setError(studioError(e, t, locale)),
  });
  const apply = useMutation({
    mutationFn: (p: { id: string; confirm: boolean }) => api.post<StudioChange>(`/ai/studio/changes/${p.id}/apply`, p.confirm ? { confirmHighRisk: true } : {}),
    onSuccess: (v) => {
      setCurrent(v);
      setError(null);
      setNotice(t("web.aiStudio.applied"));
      setConfirmOpen(false);
      setConfirmed(false);
      if (v.runId) void sendAiFeedback(v.runId, "accepted").catch(() => undefined);
      refresh();
    },
    onError: (e) => {
      setConfirmOpen(false);
      setError(studioError(e, t, locale));
    },
  });
  const undo = useMutation({
    mutationFn: (id: string) => api.post<StudioChange>(`/ai/studio/changes/${id}/undo`, {}),
    onSuccess: (v) => {
      setCurrent(v);
      setError(null);
      setConflicts(null);
      setNotice(t("web.aiStudio.undone"));
      toast.success(t("web.aiStudio.undone"));
      refresh();
    },
    onError: (e) => {
      setNotice(null);
      if (e instanceof ApiError && e.code === "studio_changed_since") {
        setConflicts(((e.details as { conflicts?: { area: string; lines: ChangeLine[] }[] } | undefined)?.conflicts ?? []).slice(0, 8));
        setError(t("web.aiStudio.undoConflict"));
      } else setError(studioError(e, t, locale));
    },
  });
  const cancel = useMutation({
    mutationFn: (v: StudioChange) => api.post<StudioChange>(`/ai/studio/changes/${v.id}/cancel`, {}).then((r) => ({ r, v })),
    onSuccess: ({ r, v }) => {
      if (v.runId) void sendAiFeedback(v.runId, "rejected").catch(() => undefined);
      setCurrent(null);
      setNotice(t("web.aiStudio.cancelled"));
      void qc.invalidateQueries({ queryKey: KEY.changes });
      void r;
    },
    onError: (e) => setError(studioError(e, t, locale)),
  });

  const send = (value?: string) => {
    const request = (value ?? text).trim();
    if (request.length < 3 || plan.isPending) return;
    setText("");
    setCurrent(null);
    setNotice(null);
    plan.mutate(request);
  };

  const onApply = () => {
    if (!current) return;
    if (current.highRisk) setConfirmOpen(true);
    else apply.mutate({ id: current.id, confirm: false });
  };

  const groupOf = (kind: string) => meta.data?.operations.find((o) => o.kind === kind)?.groupLabel;
  const Live = studioPreviewComponent();

  return (
    <div className="grid gap-section" data-testid="studio-assistant">
      <p className="text-sm text-muted-foreground">{t("web.aiStudio.intro")}</p>

      <form
        className="grid gap-2 rounded-2xl bg-card p-3 ring-1 ring-border ring-inset"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Textarea
          rows={3}
          maxLength={800}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("web.aiStudio.placeholder")}
          aria-label={t("web.aiStudio.title")}
          data-testid="studio-input"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-meta text-muted-foreground">
            {t("web.aiStudio.credits")} {t("web.aiStudio.noBank")}
          </p>
          <div className="flex items-center gap-2">
            <VoiceInput value={text} onChange={setText} />
            <Button type="submit" size="sm" disabled={plan.isPending || text.trim().length < 3} data-testid="studio-send">
              {plan.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {t("web.aiStudio.send")}
            </Button>
          </div>
        </div>
      </form>

      {!current && !plan.isPending && meta.data && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold text-muted-foreground">{t("web.aiStudio.suggest.title")}</p>
          <div className="flex flex-wrap gap-2">
            {meta.data.suggestions.map((s) => (
              <Button key={s.en} type="button" size="sm" variant="outline" className="h-auto whitespace-normal py-1.5 text-left" onClick={() => setText(pick(s))}>
                {pick(s)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {plan.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2Icon className="size-4 animate-spin" /> {t("web.aiStudio.thinking")}
        </p>
      )}
      {error && (
        <Alert variant="destructive" data-testid="studio-error">
          <AlertDescription>
            {error}
            {conflicts && (
              <span className="mt-2 grid gap-1">
                {conflicts.flatMap((c) => c.lines).map((l, i) => (
                  <span key={i} className="text-xs">
                    <b>{pick(l.label)}</b>: {pick(l.before)} <ArrowRightIcon className="inline size-3" /> {pick(l.after)}
                  </span>
                ))}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}
      {notice && !error && (
        <Alert data-testid="studio-notice">
          <AlertDescription>
            {notice}
            {current?.status === "applied" && <span className="mt-1 block text-xs text-muted-foreground">{t("web.aiStudio.appliedHint")}</span>}
          </AlertDescription>
        </Alert>
      )}

      {current && (
        <div ref={resultRef} className="grid scroll-mt-4 gap-3 rounded-2xl bg-card p-3 ring-1 ring-border ring-inset sm:p-4" lang={current.language} data-testid="studio-plan">
          <PlanCard
            change={current}
            pick={pick}
            groupOf={groupOf}
            live={
              Live ? (
                <React.Suspense fallback={<Skeleton className="h-full w-full" />}>
                  <Live tokens={current.preview.tokens ?? null} sections={current.preview.sections ?? null} />
                </React.Suspense>
              ) : null
            }
            busy={apply.isPending || undo.isPending || cancel.isPending}
            applying={apply.isPending}
            undoing={undo.isPending}
            onApply={onApply}
            onCancel={() => cancel.mutate(current)}
            onUndo={() => undo.mutate(current.id)}
          />
        </div>
      )}

      <section className="grid gap-2" aria-labelledby="studio-history">
        <h2 id="studio-history" className="text-sm font-semibold">
          {t("web.aiStudio.history.title")}
        </h2>
        {history.isPending ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : (history.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{t("web.aiStudio.history.empty")}</p>
        ) : (
          <ul className="grid gap-2">
            {history.data!.items.map((h) => (
              <li key={h.id} className="grid gap-1 rounded-xl bg-muted/40 p-3 ring-1 ring-border ring-inset" data-testid="studio-history-item">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusPill tone={STATUS_TONE[h.status]}>{t(`web.aiStudio.status.${h.status}`)}</StatusPill>
                  <time className="text-meta text-muted-foreground" dateTime={h.createdAt}>
                    {new Date(h.createdAt).toLocaleString(ta ? "ta-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </div>
                <p className="text-sm break-words">{h.request}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setCurrent(h); setError(null); setNotice(null); setConflicts(null); }}>
                    {t("web.aiStudio.history.open")}
                  </Button>
                  {h.canUndo && (
                    <Button size="sm" variant="ghost" disabled={undo.isPending} onClick={() => { setCurrent(h); undo.mutate(h.id); }} data-testid="studio-undo-history">
                      <Undo2Icon /> {t("web.aiStudio.undo")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={confirmOpen} onOpenChange={(o) => { setConfirmOpen(o); if (!o) setConfirmed(false); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlertIcon className="size-5 text-destructive" /> {t("web.aiStudio.confirm.title")}
            </DialogTitle>
            <DialogDescription>{t("web.aiStudio.confirm.body")}</DialogDescription>
          </DialogHeader>
          {current && (
            <ul className="grid gap-1.5 text-sm">
              {current.ops.filter((o) => o.status === "ok" && o.risk === "high").map((o, i) => (
                <li key={i} className="flex items-start gap-2">
                  <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" /> <span>{pick(o.description)}</span>
                </li>
              ))}
            </ul>
          )}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} data-testid="studio-confirm-check" />
            <span>{t("web.aiStudio.confirm.check")}</span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("web.common.cancel")}
            </Button>
            <Button variant="destructive" disabled={!confirmed || apply.isPending} onClick={() => current && apply.mutate({ id: current.id, confirm: true })} data-testid="studio-confirm-apply">
              {apply.isPending && <Loader2Icon className="animate-spin" />} {t("web.aiStudio.confirm.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One checked plan: steps, what is not possible, before -> after, the live store preview, Apply / Cancel / Undo. Also used by the shop setup assistant. */
export function PlanCard(p: {
  change: StudioChange;
  pick: (b: Bi) => string;
  groupOf: (kind: string) => Bi | undefined;
  live: React.ReactNode;
  busy: boolean;
  applying: boolean;
  undoing: boolean;
  onApply: () => void;
  onCancel: () => void;
  onUndo: () => void;
}) {
  const { t } = useI18n();
  const c = p.change;
  const [showLive, setShowLive] = React.useState(true);
  const cls = CLASS_TONE[c.classification];
  const hasVisual = !!(c.preview.tokens || c.preview.sections);
  const live = c.status === "planned" || c.status === "applied";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill tone={cls.tone} icon={cls.icon} size="md" data-testid="studio-class">
          {t(`web.aiStudio.badge.${c.classification}`)}
        </StatusPill>
        <StatusPill tone={STATUS_TONE[c.status]}>{t(`web.aiStudio.status.${c.status}`)}</StatusPill>
      </div>
      <p className="text-sm break-words">{c.request}</p>
      {c.summary && <p className="text-sm font-medium break-words">{c.summary}</p>}
      {c.status === "planned" && c.ops.some((o) => o.status === "ok") && <AiDraftBanner readOnly runId={c.runId ?? undefined} credits={c.credits} />}

      {c.ops.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">{t("web.aiStudio.steps")}</h3>
          <ol className="grid gap-2">
            {c.ops.map((o, i) => (
              <li key={i} className={`grid gap-1 rounded-xl p-3 ring-1 ring-inset ${o.status === "ok" ? "bg-muted/40 ring-border" : "bg-destructive/5 ring-destructive/20"}`} data-testid="studio-step" data-status={o.status}>
                <div className="flex flex-wrap items-center gap-1.5">
                  {p.groupOf(o.kind) && <span className="text-meta text-muted-foreground">{p.pick(p.groupOf(o.kind)!)}</span>}
                  <StatusPill tone={RISK_TONE[o.risk]}>{t(`web.aiStudio.risk.${o.risk}`)}</StatusPill>
                  {o.alternative && <StatusPill tone="warning">{t("web.aiStudio.step.closest")}</StatusPill>}
                  {o.status !== "ok" && <StatusPill tone="danger" icon={CircleAlertIcon}>{t(`web.aiStudio.step.${o.status}`)}</StatusPill>}
                </div>
                <p className="text-sm break-words">{p.pick(o.description)}</p>
                {o.problem && <p className="text-xs text-destructive">{p.pick(o.problem.text)}</p>}
                {o.warnings.map((w, k) => (
                  <p key={k} className="flex items-start gap-1.5 text-xs text-warning-ink">
                    <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {p.pick(w)}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </div>
      )}

      {c.unsupported.length > 0 && (
        <div className="grid gap-1 rounded-xl bg-muted/50 p-3 ring-1 ring-border ring-inset" data-testid="studio-unsupported">
          <h3 className="text-xs font-semibold">{t("web.aiStudio.unsupported.title")}</h3>
          <ul className="grid gap-1 text-sm">
            {c.unsupported.map((u, i) => (
              <li key={i} className="break-words">
                <b>{u.text}</b>: {u.missing}
              </li>
            ))}
          </ul>
          {c.featureRequestSaved && <p className="text-xs text-muted-foreground">{t("web.aiStudio.unsupported.noted")}</p>}
        </div>
      )}
      {c.refused.length > 0 && (
        <div className="grid gap-1 rounded-xl bg-destructive/5 p-3 ring-1 ring-destructive/20 ring-inset" data-testid="studio-refused">
          <h3 className="text-xs font-semibold">{t("web.aiStudio.refused.title")}</h3>
          <ul className="grid gap-1 text-sm">
            {c.refused.map((u, i) => (
              <li key={i} className="break-words">
                {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.notes && (
        <p className="text-xs text-muted-foreground break-words">
          <b>{t("web.aiStudio.notes")}:</b> {c.notes}
        </p>
      )}
      {c.ops.length === 0 && c.unsupported.length === 0 && c.refused.length === 0 && <p className="text-sm text-muted-foreground">{t("web.aiStudio.none.help")}</p>}

      {live && (c.preview.lines.length > 0 || hasVisual) && (
        <div className="grid gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">{t("web.aiStudio.preview.title")}</h3>
          {c.preview.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("web.aiStudio.preview.empty")}</p>
          ) : (
            <ul className="grid gap-1.5" data-testid="studio-lines">
              {c.preview.lines.map((l, i) => (
                <li key={i} className="grid gap-0.5 rounded-lg bg-muted/30 px-3 py-2 text-sm ring-1 ring-border ring-inset sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-3">
                  <span className="font-medium break-words">{p.pick(l.label)}</span>
                  <span className="flex flex-wrap items-center gap-1.5 break-words">
                    <span className="text-muted-foreground line-through decoration-muted-foreground/40" title={t("web.aiStudio.preview.before")}>
                      {p.pick(l.before)}
                    </span>
                    <ArrowRightIcon className="size-3.5 shrink-0" aria-hidden />
                    <span className="font-semibold" title={t("web.aiStudio.preview.after")}>
                      {p.pick(l.after)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {hasVisual && p.live && (
            <div className="grid gap-2">
              <button type="button" className="inline-flex items-center gap-1 justify-self-start text-xs font-medium text-primary hover:underline" aria-expanded={showLive} onClick={() => setShowLive((v) => !v)}>
                <ChevronDownIcon className={`size-3.5 transition-transform ${showLive ? "rotate-180" : ""}`} /> {t("web.aiStudio.preview.live")}
              </button>
              {showLive && (
                <div className="grid gap-1">
                  <p className="text-meta text-muted-foreground">{t("web.aiStudio.preview.liveHint")}</p>
                  <div className="h-[520px] min-h-0 overflow-hidden rounded-xl ring-1 ring-border ring-inset" data-testid="studio-live-preview">
                    {p.live}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {c.canApply && (
          <>
            <Button onClick={p.onApply} disabled={p.busy} data-testid="studio-apply">
              {p.applying ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {p.applying ? t("web.aiStudio.applying") : t("web.aiStudio.apply")}
            </Button>
            <Button variant="ghost" onClick={p.onCancel} disabled={p.busy} data-testid="studio-cancel">
              {t("web.aiStudio.cancel")}
            </Button>
          </>
        )}
        {c.canUndo && (
          <Button variant="outline" onClick={p.onUndo} disabled={p.busy} data-testid="studio-undo">
            {p.undoing ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />} {p.undoing ? t("web.aiStudio.undoing") : t("web.aiStudio.undo")}
          </Button>
        )}
      </div>
    </>
  );
}
