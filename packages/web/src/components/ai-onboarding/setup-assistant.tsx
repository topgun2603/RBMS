"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowRightIcon, CheckCircle2Icon, Loader2Icon, ShieldAlertIcon, SparklesIcon, StoreIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Progress, Skeleton, StatusPill, Textarea, toast } from "@rbms/ui";
import { api, ApiError } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { ModuleLink } from "../../app/navigation";
import { sendAiFeedback } from "../ai-draft";
import { VoiceInput } from "../ai-assist/voice";
import { PlanCard, type StudioChange } from "../ai-studio/studio-panel";
import { studioPreviewComponent } from "../ai-studio/studio-preview";

type Bi = { en: string; ta: string };
const KEYS = ["sell", "buyers", "groups", "look", "extras"] as const;
type Key = (typeof KEYS)[number];
type Answers = Record<Key, string>;
const EMPTY: Answers = { sell: "", buyers: "", groups: "", look: "", extras: "" };

interface Status {
  progress: { status: "new" | "planned" | "applied" | "undone" | "dismissed"; changeId: string | null; answers: Answers | null; language: "en" | "ta" };
  change: StudioChange | null;
  ai: { ready: boolean; reason: string | null };
}
interface Summary {
  readBy: "ai" | "rules";
  skipped: string | null;
  trade: { id: string; name: Bi; source: "ai" | "rules" | "kept"; otherApp: { id: string; name: Bi; appId: string } | null; outOfScope: boolean };
  categories: { names: string[]; namesTa: string[]; source: "owner" | "pack" };
  look: { preset: string; name: string; colour: string | null };
  storeLanguages: "en" | "ta" | "both";
  fulfilment: { delivery: boolean | null; pickup: boolean | null };
  hero: { en: { heading: string; text: string }; ta: { heading: string; text: string } };
  notes: Bi[];
  removed: string[];
  suspicious: boolean;
}

const KEY = ["ai", "onboarding", "status"] as const;

/** Group labels of the steps a setup plan can hold (the Studio meta list leaves the setup-only steps out). */
const GROUP: Record<string, Bi> = {
  "store.set_trade": { en: "Store settings", ta: "கடை அமைப்புகள்" },
  "store.set_fulfilment": { en: "Store settings", ta: "கடை அமைப்புகள்" },
  "theme.apply_preset": { en: "Store look", ta: "கடையின் தோற்றம்" },
  "theme.set_colors": { en: "Store look", ta: "கடையின் தோற்றம்" },
  "catalogue.set_categories": { en: "Product groups", ta: "பொருள் வகைகள்" },
  "home.set_layout": { en: "Home page", ta: "முகப்புப் பக்கம்" },
};

/**
 * The shop setup assistant for a new owner (AI Phase 7 part A): five questions, one at a time, typed or spoken in Tamil,
 * Tanglish or English; then what was understood and the checked plan (the Studio plan card with before -> after and the
 * live store), Apply and Undo. Nothing changes before Apply. Works with AI off (the app's own rules read the answers).
 */
export function SetupAssistant({ addProductHref }: { addProductHref?: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const ta = locale === "ta";
  const pick = (b: Bi) => (ta ? b.ta : b.en);
  const status = useQuery({ queryKey: KEY, queryFn: () => api.get<Status>("/ai/onboarding/status"), retry: false });
  const [answers, setAnswers] = React.useState<Answers>(EMPTY);
  const [step, setStep] = React.useState(0);
  const [editing, setEditing] = React.useState(false);
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [change, setChange] = React.useState<StudioChange | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmAi, setConfirmAi] = React.useState(false);

  React.useEffect(() => {
    const s = status.data;
    if (!s) return;
    if (s.progress.answers) setAnswers({ ...EMPTY, ...s.progress.answers });
    if (s.change && (s.change.status === "planned" || s.change.status === "applied")) setChange((c) => c ?? s.change);
  }, [status.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    // The store changed: branding, home, catalogue and settings screens refetch.
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "ai" || q.queryKey[1] === "status" });
  };
  const fail = (e: unknown) => {
    if (e instanceof ApiError && ta) {
      const d = e.details as { ta?: string; problem?: Bi } | undefined;
      if (d?.problem?.ta || d?.ta) return setError(d.problem?.ta ?? d.ta!);
    }
    if (e instanceof ApiError && e.code === "studio_stale") return setError(t("web.aiStudio.stale"));
    if (e instanceof ApiError && e.code === "studio_changed_since") return setError(t("web.aiStudio.undoConflict"));
    setError(describeError(e, t));
  };

  const plan = useMutation({
    mutationFn: (a: Answers) => api.post<{ change: StudioChange; summary: Summary }>("/ai/onboarding/plan", a),
    onSuccess: (v) => {
      setChange(v.change);
      setSummary(v.summary);
      setEditing(false);
      setError(null);
      setNotice(v.change.status === "rejected" ? t("web.aiSetup.nothing") : null);
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["ai", "status"] });
    },
    onError: fail,
  });
  const apply = useMutation({
    mutationFn: (id: string) => api.post<StudioChange>(`/ai/onboarding/changes/${id}/apply`, {}),
    onSuccess: (v) => {
      setChange(v);
      setError(null);
      setNotice(t("web.aiSetup.applied"));
      if (v.runId) void sendAiFeedback(v.runId, "accepted").catch(() => undefined);
      refresh();
    },
    onError: fail,
  });
  const undo = useMutation({
    mutationFn: (id: string) => api.post<StudioChange>(`/ai/onboarding/changes/${id}/undo`, {}),
    onSuccess: (v) => {
      setChange(v);
      setError(null);
      setNotice(t("web.aiSetup.undone"));
      toast.success(t("web.aiSetup.undone"));
      refresh();
    },
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: (v: StudioChange) => api.post<StudioChange>(`/ai/studio/changes/${v.id}/cancel`, {}).then(() => v),
    onSuccess: (v) => {
      if (v.runId) void sendAiFeedback(v.runId, "rejected").catch(() => undefined);
      setChange(null);
      setSummary(null);
      setEditing(true);
      setStep(0);
      refresh();
    },
    onError: fail,
  });
  const dismiss = useMutation({
    mutationFn: () => api.post("/ai/onboarding/dismiss", {}),
    onSuccess: () => {
      setNotice(t("web.aiSetup.dismissed"));
      refresh();
    },
    onError: fail,
  });
  const turnOnAi = useMutation({
    mutationFn: () => api.put("/settings/ai/tenant", { enabled: true }),
    onSuccess: () => {
      setConfirmAi(false);
      toast.success(t("web.aiSetup.ai.turnedOn"));
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["ai", "status"] });
    },
    onError: fail,
  });

  if (status.isPending) return <Skeleton className="h-80 rounded-2xl" />;
  if (status.isError) return <Alert variant="destructive"><AlertDescription>{describeError(status.error, t)}</AlertDescription></Alert>;

  const ai = status.data.ai;
  const key = KEYS[step]!;
  const showQuestions = editing || !change || change.status === "undone" || change.status === "cancelled" || change.status === "rejected";
  const canMake = (answers.sell.trim() || answers.groups.trim()).length > 0;
  const Live = studioPreviewComponent();
  const yn = (v: boolean | null) => (v === null ? t("web.aiSetup.summary.notSaid") : v ? t("web.aiSetup.summary.yes") : t("web.aiSetup.summary.no"));

  return (
    <div className="grid gap-section" data-testid="setup-assistant">
      <p className="text-sm text-muted-foreground">{t("web.aiSetup.intro")}</p>

      <Alert data-testid="setup-ai-state">
        <SparklesIcon />
        <AlertDescription>
          <span>{ai.ready && ai.reason !== "mock" ? t("web.aiSetup.ai.ready") : t(`web.aiSetup.ai.${ai.reason && t.has(`web.aiSetup.ai.${ai.reason}`) ? ai.reason : "ai_unavailable"}`)}</span>
          {ai.reason === "ai_off" && !confirmAi && (
            <Button size="sm" variant="outline" className="mt-2 justify-self-start" onClick={() => setConfirmAi(true)} data-testid="setup-ai-on">
              {t("web.aiSetup.ai.turnOn")}
            </Button>
          )}
          {confirmAi && (
            <span className="mt-2 grid gap-2">
              <span className="text-xs">{t("web.aiSetup.ai.turnOnConfirm")}</span>
              <span className="flex flex-wrap gap-2">
                <Button size="sm" disabled={turnOnAi.isPending} onClick={() => turnOnAi.mutate()} data-testid="setup-ai-confirm">
                  {turnOnAi.isPending && <Loader2Icon className="animate-spin" />} {t("web.aiSetup.ai.turnOn")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmAi(false)}>
                  {t("web.common.cancel")}
                </Button>
              </span>
            </span>
          )}
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive" data-testid="setup-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && !error && (
        <Alert data-testid="setup-notice">
          <CheckCircle2Icon />
          <AlertDescription>
            {notice}
            {change?.status === "applied" && addProductHref && (
              <Button asChild size="sm" className="mt-2 justify-self-start">
                <ModuleLink href={addProductHref}>
                  <StoreIcon /> {t("web.aiSetup.addProduct")}
                </ModuleLink>
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {showQuestions && (
        <form
          className="grid gap-3 rounded-2xl bg-card p-3 ring-1 ring-border ring-inset sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (step < KEYS.length - 1) setStep(step + 1);
            else if (canMake) plan.mutate(answers);
          }}
          data-testid="setup-questions"
        >
          <div className="grid gap-1.5">
            <p className="text-meta text-muted-foreground">{t("web.aiSetup.progress", { n: step + 1, total: KEYS.length })}</p>
            <Progress value={((step + 1) / KEYS.length) * 100} className="h-1.5" aria-hidden />
          </div>
          <label htmlFor={`setup-${key}`} className="font-heading text-base font-semibold">
            {t(`web.aiSetup.q.${key}`)}
          </label>
          <Textarea
            id={`setup-${key}`}
            rows={3}
            maxLength={400}
            value={answers[key]}
            onChange={(e) => setAnswers((a) => ({ ...a, [key]: e.target.value }))}
            placeholder={t(`web.aiSetup.q.${key}.hint`)}
            data-testid={`setup-answer-${key}`}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 text-meta text-muted-foreground">{t("web.aiSetup.speakHint")}</p>
            <VoiceInput value={answers[key]} onChange={(v) => setAnswers((a) => ({ ...a, [key]: v.slice(0, 400) }))} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                <ArrowLeftIcon /> {t("web.aiSetup.back")}
              </Button>
            )}
            {step < KEYS.length - 1 ? (
              <>
                <Button type="submit" data-testid="setup-next">
                  {t("web.aiSetup.next")} <ArrowRightIcon />
                </Button>
                {step > 0 && (
                  <Button type="button" variant="ghost" onClick={() => setStep(step + 1)}>
                    {t("web.aiSetup.skipQuestion")}
                  </Button>
                )}
              </>
            ) : (
              <Button type="submit" disabled={!canMake || plan.isPending} data-testid="setup-make">
                {plan.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {plan.isPending ? t("web.aiSetup.making") : t("web.aiSetup.make")}
              </Button>
            )}
            <Button type="button" variant="ghost" className="ml-auto text-muted-foreground" disabled={dismiss.isPending} onClick={() => dismiss.mutate()} data-testid="setup-dismiss">
              {t("web.aiSetup.notNow")}
            </Button>
          </div>
          <p className="text-meta text-muted-foreground">{t("web.aiSetup.noFacts")}</p>
        </form>
      )}

      {!showQuestions && summary && change?.status === "planned" && (
        <section className="grid gap-2 rounded-2xl bg-card p-3 ring-1 ring-border ring-inset sm:p-4" aria-labelledby="setup-summary" data-testid="setup-summary">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="setup-summary" className="text-sm font-semibold">
              {t("web.aiSetup.summary.title")}
            </h2>
            <StatusPill tone={summary.readBy === "ai" ? "brand" : "neutral"}>{summary.readBy === "ai" ? t("web.aiSetup.summary.byAi") : t("web.aiSetup.summary.byRules")}</StatusPill>
          </div>
          <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
            <dt className="text-muted-foreground">{t("web.aiSetup.summary.trade")}</dt>
            <dd className="break-words" data-testid="setup-trade">{summary.trade.source === "kept" ? t("web.aiSetup.summary.tradeKept", { name: pick(summary.trade.name) }) : pick(summary.trade.name)}</dd>
            <dt className="text-muted-foreground">{t("web.aiSetup.summary.groups")}</dt>
            <dd className="flex flex-wrap gap-1" data-testid="setup-groups">
              {(ta ? summary.categories.namesTa : summary.categories.names).map((g) => (
                <span key={g} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {g}
                </span>
              ))}
              {summary.categories.source === "pack" && <span className="w-full text-meta text-muted-foreground">{t("web.aiSetup.summary.groupsPack")}</span>}
            </dd>
            <dt className="text-muted-foreground">{t("web.aiSetup.summary.look")}</dt>
            <dd className="flex items-center gap-2">
              {summary.look.colour && <span className="inline-block size-3.5 rounded-full ring-1 ring-border" style={{ background: summary.look.colour }} aria-hidden />}
              {summary.look.name}
            </dd>
            <dt className="text-muted-foreground">{t("web.aiSetup.summary.languages")}</dt>
            <dd>{t(`web.aiSetup.summary.lang.${summary.storeLanguages}`)}</dd>
            <dt className="text-muted-foreground">{t("web.aiSetup.summary.delivery")}</dt>
            <dd>{yn(summary.fulfilment.delivery)}</dd>
            <dt className="text-muted-foreground">{t("web.aiSetup.summary.pickup")}</dt>
            <dd>{yn(summary.fulfilment.pickup)}</dd>
            <dt className="text-muted-foreground">{t("web.aiSetup.summary.hero")}</dt>
            <dd className="break-words">
              <b>{(ta ? summary.hero.ta : summary.hero.en).heading}</b> {(ta ? summary.hero.ta : summary.hero.en).text}
            </dd>
          </dl>
          {summary.trade.otherApp && <p className="text-xs text-muted-foreground">{t("web.aiSetup.summary.otherApp", { name: pick(summary.trade.otherApp.name) })}</p>}
          {summary.notes.map((n, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {pick(n)}
            </p>
          ))}
          {summary.suspicious && (
            <p className="flex items-start gap-1.5 text-xs text-warning-ink" data-testid="setup-suspicious">
              <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {t("web.aiSetup.summary.suspicious")}
            </p>
          )}
          {summary.removed.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t("web.aiSetup.summary.removed")}</summary>
              <ul className="mt-1 grid gap-0.5">
                {summary.removed.map((r, i) => (
                  <li key={i} className="break-words line-through decoration-muted-foreground/40">
                    {r}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {!showQuestions && change && (
        <div className="grid gap-3 rounded-2xl bg-card p-3 ring-1 ring-border ring-inset sm:p-4" lang={change.language} data-testid="setup-plan">
          <PlanCard
            change={change}
            pick={pick}
            groupOf={(kind) => GROUP[kind]}
            live={
              Live ? (
                <React.Suspense fallback={<Skeleton className="h-full w-full" />}>
                  <Live tokens={change.preview.tokens ?? null} sections={change.preview.sections ?? null} />
                </React.Suspense>
              ) : null
            }
            busy={apply.isPending || undo.isPending || cancel.isPending}
            applying={apply.isPending}
            undoing={undo.isPending}
            onApply={() => apply.mutate(change.id)}
            onCancel={() => cancel.mutate(change)}
            onUndo={() => undo.mutate(change.id)}
          />
          {(change.status === "applied" || change.status === "planned") && (
            <Button
              variant="link"
              size="sm"
              className="justify-self-start px-0"
              onClick={() => {
                setEditing(true);
                setStep(0);
                setNotice(null);
              }}
              data-testid="setup-edit"
            >
              {t("web.aiSetup.startAgain")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
