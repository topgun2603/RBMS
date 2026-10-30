"use client";

import * as React from "react";
import { CheckIcon, CopyIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { Button, Textarea, toast } from "@rbms/ui";
import { AiDraftBanner, api, describeError, useI18n } from "@rbms/web";
import { useMutation } from "@tanstack/react-query";
import { Section } from "./bits";
import { useMe } from "../lib/access";

interface DraftResponse {
  draft: { name: string; messageEn: string; messageTa: string; smsEn: string; smsTa: string; removed: { sentence: string; reason: string }[]; templated: string[] };
  audience: "regular" | "all" | "lapsed";
  segment: {
    spec: { keywords: string[]; sinceMonths: number; minVisits: number; notMessagedDays: number };
    counts: { considered: number; matched: number; noPhone: number; optedOut: number; recentlyMessaged: number; final: number };
    members: { id: string; name: string; phone: string }[];
  };
  sendAt: { iso: string; hour: number; basis: "peak" | "default" };
  runId: string;
  credits: number;
}

export interface CampaignAiApply {
  name: string;
  /** Lines "phone, name" for the pasted-list audience. */
  phonesText: string;
  sendAtIso: string;
}

const clean = (s: string) => s.replace(/[,;\t\r\n]+/g, " ").trim();

/**
 * "Write with AI" on the new-campaign screen: the owner types the goal; AI drafts the message in English and Tamil (only
 * facts from the goal), the segment and send time are worked out in code. Nothing is created or sent here: "Use this
 * audience and time" only fills the wizard, and the owner still picks an approved template and presses Start.
 */
export function AiCampaignWriter({ onApply }: { onApply: (a: CampaignAiApply) => void }) {
  const { t, formatDate, formatNumber } = useI18n();
  const me = useMe();
  const [goal, setGoal] = React.useState("");
  const [en, setEn] = React.useState("");
  const [ta, setTa] = React.useState("");
  const run = useMutation({ mutationFn: (g: string) => api.post<DraftResponse>("/ai/insights/campaign/draft", { goal: g }) });
  const r = run.data;
  React.useEffect(() => {
    if (r) {
      setEn(r.draft.messageEn);
      setTa(r.draft.messageTa);
    }
  }, [r]);
  if (!me.can("ai.use") || !me.can("whatsapp.manage")) return null;

  const write = async () => {
    try {
      await run.mutateAsync(goal);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("inbox.ai.copied"));
    } catch {
      toast.error(t("inbox.ai.copyFailed"));
    }
  };
  const c = r?.segment.counts;
  return (
    <Section icon={SparklesIcon} title={t("inbox.ai.title")} description={t("inbox.ai.hint")}>
      <div className="grid gap-3" data-testid="ai-campaign-writer">
        <Textarea value={goal} maxLength={600} rows={3} onChange={(e) => setGoal(e.target.value)} placeholder={t("inbox.ai.placeholder")} aria-label={t("inbox.ai.title")} />
        <div>
          <Button type="button" size="sm" disabled={goal.trim().length < 8 || run.isPending} onClick={() => void write()}>
            {run.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            {run.isPending ? t("inbox.ai.writing") : t("inbox.ai.write")}
          </Button>
        </div>
        {r && c && (
          <div className="grid gap-3">
            <AiDraftBanner runId={r.runId} credits={r.credits} />
            {r.draft.removed.length > 0 && <p className="rounded-xl bg-muted/50 p-2 text-meta text-muted-foreground">{t("inbox.ai.removed", { n: r.draft.removed.length })}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t("inbox.ai.msgEn")}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void copy(en)}>
                    <CopyIcon /> {t("inbox.ai.copy")}
                  </Button>
                </div>
                <Textarea value={en} rows={6} maxLength={1024} onChange={(e) => setEn(e.target.value)} aria-label={t("inbox.ai.msgEn")} />
                <span className="text-meta text-muted-foreground">{t("inbox.ai.chars", { n: en.length, max: 600 })}</span>
              </div>
              <div className="grid gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t("inbox.ai.msgTa")}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void copy(ta)}>
                    <CopyIcon /> {t("inbox.ai.copy")}
                  </Button>
                </div>
                <Textarea value={ta} rows={6} maxLength={1024} onChange={(e) => setTa(e.target.value)} aria-label={t("inbox.ai.msgTa")} />
                <span className="text-meta text-muted-foreground">{t("inbox.ai.chars", { n: ta.length, max: 600 })}</span>
              </div>
            </div>
            <p className="text-meta text-muted-foreground">
              {t("inbox.ai.sms", { en: r.draft.smsEn, ta: r.draft.smsTa })}
            </p>
            <p className="text-meta text-muted-foreground">{t("inbox.ai.templateNote")}</p>
            <div className="rounded-xl bg-muted/40 p-3 text-sm" data-testid="ai-segment">
              <p className="font-medium">{t("inbox.ai.segment", { n: formatNumber(c.final) })}</p>
              <p className="text-meta text-muted-foreground">
                {t(`inbox.ai.rule.${r.audience}`, { months: r.segment.spec.sinceMonths, visits: r.segment.spec.minVisits, days: r.segment.spec.notMessagedDays })}
                {r.segment.spec.keywords.length > 0 && ` ${t("inbox.ai.rule.bought", { words: r.segment.spec.keywords.join(", ") })}`}
              </p>
              <p className="text-meta text-muted-foreground">
                {t("inbox.ai.left", { opted: c.optedOut, recent: c.recentlyMessaged, nophone: c.noPhone })}
              </p>
              <p className="mt-1 text-meta">
                {t(r.sendAt.basis === "peak" ? "inbox.ai.timePeak" : "inbox.ai.timeDefault", { when: formatDate(r.sendAt.iso, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}
              </p>
            </div>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={c.final === 0}
                onClick={() => {
                  onApply({ name: r.draft.name, phonesText: r.segment.members.map((m) => `${m.phone}, ${clean(m.name)}`).join("\n"), sendAtIso: r.sendAt.iso });
                  toast.success(t("inbox.ai.applied"));
                }}
              >
                <CheckIcon /> {t("inbox.ai.apply")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
