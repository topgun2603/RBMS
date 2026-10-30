"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CopyIcon, Loader2Icon, MessageCircleIcon, SparklesIcon } from "lucide-react";
import { Alert, AlertDescription, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Textarea, toast } from "@rbms/ui";
import { api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { AiDraftBanner } from "../ai-draft";
import { Page, PageHeading } from "../page";
import { postTrades, useTradesError, useTradesHelper, type Run } from "./shared";

export interface AtRiskClient {
  key: string;
  name: string;
  phone: string | null;
  kind: "member" | "client";
  reasons: { code: "expiring" | "lapsed" | "visits_dropped" | "gone_quiet"; days?: number; planName?: string; date?: string }[];
  daysSinceLast: number | null;
  lastVisit: string | null;
  usualGapDays: number | null;
  visitsLast30: number;
  usualPer30: number | null;
  usualServices: string[];
  plan: { name: string; end: string } | null;
  optedOut: boolean;
  noPhone: boolean;
  lastMessagedAt: string | null;
}
interface AtRiskResponse {
  today: string;
  clients: AtRiskClient[];
  counts: { total: number; optedOut: number; noPhone: number; reachable: number };
}

/** The at-risk list (computed in code, no AI, no credits). `enabled` = the person may see it. */
export function useAtRisk(enabled = true) {
  return useQuery<AtRiskResponse>({ queryKey: ["ai", "trades-c", "at-risk"], queryFn: () => api.get<AtRiskResponse>("/ai/trades-c/at-risk"), enabled, staleTime: 60_000, retry: false });
}

/** The count for the "At risk (n)" label. Null while loading or when the person may not see the list. */
export function useAtRiskCount(): number | null {
  const q = useAtRisk(true);
  return q.data ? q.data.counts.total : null;
}

interface Draft extends Run {
  draft: { message: string; template: string; language: "en" | "ta"; usedOffer: boolean; removed: { sentence: string; reason: string }[]; fallback: boolean };
}

const WA_DIGITS = (phone: string) => phone.replace(/\D/g, "").replace(/^0+/, "").replace(/^(\d{10})$/, "91$1");

/**
 * "At risk" list for memberships and bookings: members and clients who are drifting away, why, their usual services and a
 * "Draft message" button. The AI writes one personal message at a time; the owner edits it, then copies it or opens the chat in
 * WhatsApp (nothing is sent from here). People who opted out of messages cannot be drafted for.
 */
export function AtRiskPanel() {
  const { t, formatDate } = useI18n();
  const list = useAtRisk(true);
  const { show: canDraft } = useTradesHelper("winback-message", ["memberships.manage", "bookings.manage"]);
  const [target, setTarget] = React.useState<AtRiskClient | null>(null);

  if (list.isLoading) return <p className="text-sm text-muted-foreground">{t("web.common.loading")}</p>;
  if (list.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{describeError(list.error, t)}</AlertDescription>
      </Alert>
    );
  }
  const data = list.data!;
  const reasonText = (r: AtRiskClient["reasons"][number]) =>
    t(`web.aiTrades.winback.reason.${r.code}`, { days: r.days ?? 0, plan: r.planName ?? "", date: r.date ? formatDate(r.date) : "" });

  return (
    <div className="grid gap-4" data-testid="at-risk-panel">
      <p className="text-sm text-muted-foreground">{t("web.aiTrades.winback.intro")}</p>
      {data.counts.total === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("web.aiTrades.winback.empty")}</div>
      ) : (
        <>
          <p className="text-meta text-muted-foreground">
            {t("web.aiTrades.winback.summary", { total: data.counts.total, optedOut: data.counts.optedOut, noPhone: data.counts.noPhone })}
          </p>
          <ul className="grid gap-3">
            {data.clients.map((c) => (
              <li key={c.key} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0 grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <Badge variant="outline">{t(c.kind === "member" ? "web.aiTrades.winback.member" : "web.aiTrades.winback.client")}</Badge>
                    {c.optedOut && <Badge variant="destructive">{t("web.aiTrades.winback.optedOut")}</Badge>}
                    {c.noPhone && <Badge variant="outline">{t("web.aiTrades.winback.noPhone")}</Badge>}
                  </div>
                  <ul className="flex flex-wrap gap-1.5">
                    {c.reasons.map((r) => (
                      <li key={r.code}>
                        <Badge variant="secondary">{reasonText(r)}</Badge>
                      </li>
                    ))}
                  </ul>
                  <p className="text-meta text-muted-foreground">
                    {c.lastVisit ? t("web.aiTrades.winback.lastVisit", { date: formatDate(c.lastVisit), days: c.daysSinceLast ?? 0 }) : t("web.aiTrades.winback.neverVisited")}
                    {c.usualGapDays ? ` · ${t("web.aiTrades.winback.usualGap", { days: c.usualGapDays })}` : ""}
                    {c.usualServices.length ? ` · ${t("web.aiTrades.winback.usually", { services: c.usualServices.join(", ") })}` : ""}
                    {c.lastMessagedAt ? ` · ${t("web.aiTrades.winback.messaged", { date: formatDate(c.lastMessagedAt) })}` : ""}
                  </p>
                </div>
                {canDraft && !c.optedOut && !c.noPhone && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setTarget(c)}>
                    <SparklesIcon /> {t("web.aiTrades.winback.draft")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <DraftDialog client={target} onClose={() => setTarget(null)} />
    </div>
  );
}

function DraftDialog({ client, onClose }: { client: AtRiskClient | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const errText = useTradesError();
  const [language, setLanguage] = React.useState<"en" | "ta">(locale === "ta" ? "ta" : "en");
  const [offer, setOffer] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<Draft | null>(null);
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    setRes(null);
    setText("");
    setError(null);
    setOffer("");
    setLanguage(locale === "ta" ? "ta" : "en");
  }, [client, locale]);

  const run = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postTrades<Draft>("winback", { clientKey: client.key, language, offer: offer.trim() || null });
      setRes(r);
      setText(r.draft.message);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("web.aiTrades.winback.copied"));
    } catch {
      toast.info(text);
    }
  };
  const wa = client?.phone ? `https://wa.me/${WA_DIGITS(client.phone)}?text=${encodeURIComponent(text)}` : null;

  return (
    <Dialog open={!!client} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("web.aiTrades.winback.dialogTitle", { name: client?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("web.aiTrades.winback.dialogIntro")}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{t("web.aiTrades.winback.language")}</span>
            {(["en", "ta"] as const).map((l) => (
              <Button key={l} type="button" size="sm" variant={language === l ? "default" : "outline"} aria-pressed={language === l} onClick={() => setLanguage(l)}>
                {l === "en" ? "English" : "தமிழ்"}
              </Button>
            ))}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="wb-offer">{t("web.aiTrades.winback.offer")}</Label>
            <Input id="wb-offer" maxLength={160} value={offer} placeholder={t("web.aiTrades.winback.offerHint")} onChange={(e) => setOffer(e.target.value)} />
            <p className="text-meta text-muted-foreground">{t("web.aiTrades.winback.offerNote")}</p>
          </div>
          {res && (
            <div className="grid gap-2">
              <AiDraftBanner runId={res.runId} credits={res.credits} mock={res.provider === "mock"} />
              <Textarea aria-label={t("web.aiTrades.winback.message")} rows={5} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} />
              {res.draft.removed.length > 0 && <p className="text-meta text-muted-foreground">{t("web.aiTrades.winback.removed", { count: res.draft.removed.length })}</p>}
              {res.draft.fallback && <p className="text-meta text-muted-foreground">{t("web.aiTrades.winback.fallback")}</p>}
              <p className="text-meta text-muted-foreground">{t("web.aiTrades.winback.noAutoSend")}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("web.common.close")}
          </Button>
          <Button type="button" variant={res ? "outline" : "default"} disabled={busy} onClick={run}>
            {busy && <Loader2Icon className="animate-spin" />} {res ? t("web.aiTrades.again") : t("web.aiTrades.winback.run")}
          </Button>
          {res && (
            <>
              <Button type="button" variant="outline" onClick={copy} disabled={!text.trim()}>
                <CopyIcon /> {t("web.aiTrades.winback.copy")}
              </Button>
              {wa && (
                <Button asChild disabled={!text.trim()}>
                  <a href={wa} target="_blank" rel="noreferrer noopener">
                    <MessageCircleIcon /> {t("web.aiTrades.winback.openWhatsApp")}
                  </a>
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A whole page for a module route: "At risk (n)" with the panel. Used by memberships-ui and bookings-ui. */
export function AtRiskPage() {
  const { t } = useI18n();
  const list = useAtRisk(true);
  return (
    <Page>
      <PageHeading title={list.data ? t("web.aiTrades.winback.tab", { count: list.data.counts.total }) : t("web.aiTrades.winback.title")} description={t("web.aiTrades.winback.pageDescription")} />
      <AtRiskPanel />
    </Page>
  );
}
