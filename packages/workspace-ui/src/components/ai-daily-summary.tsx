"use client";

import * as React from "react";
import { CalendarClockIcon, Loader2Icon, SendIcon } from "lucide-react";
import { Button, Field, FieldControl, FieldHint, FieldLabel, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusPill, Switch, toast } from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { DAILY_DEFAULTS, usePreviewDailySummary, useSendDailySummary, type DailySummarySettings, type DailySummaryView } from "../lib/queries-ai-daily";
import type { AiSettingsValues } from "../lib/queries-ai";
import { SectionCard } from "./plan/section-card";

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const phoneOk = (p: string) => /^(\+?91)?[6-9]\d{9}$/.test(p.replace(/[\s()-]/g, ""));

/** The text of one summary: narrative, suggested steps, and where it went. Used for the preview and the latest summary. */
export function SummaryBody({ s }: { s: DailySummaryView }) {
  const { t } = useI18n();
  const sent = [...(s.delivery?.whatsapp ?? []).map((x) => `WhatsApp ${x.to}`), ...(s.delivery?.email ?? []).map((x) => `Email ${x.to}`)];
  return (
    <div className="grid gap-2 text-sm" data-testid="ai-daily-body">
      <p className="whitespace-pre-line">{s.narrative}</p>
      {s.actions.length > 0 && (
        <div>
          <p className="font-medium">{t("workspace.ai.daily.actions")}</p>
          <ul className="list-disc pl-5">
            {s.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {s.facts && (
        <p className="text-meta text-muted-foreground">
          {rupees(s.facts.today.amount)} · {s.facts.today.bills} bills · {s.facts.date}
        </p>
      )}
      <p className="text-meta text-muted-foreground">{s.source === "ai" ? t("workspace.ai.daily.ai") : t("workspace.ai.daily.template")}</p>
      {sent.length > 0 && <p className="text-meta text-muted-foreground">{t("workspace.ai.daily.delivery", { sent: sent.join(", ") })}</p>}
      {(s.delivery?.skipped ?? []).map((k) => (
        <p key={k} className="text-meta text-muted-foreground">
          {t(`workspace.ai.daily.skipped.${k}`)}
        </p>
      ))}
    </div>
  );
}

interface Props {
  values: AiSettingsValues;
  canEdit: boolean;
  busy: boolean;
  onPatch: (p: Partial<AiSettingsValues>) => Promise<void>;
}

export function DailySummaryCard({ values, canEdit, busy, onPatch }: Props) {
  const { t } = useI18n();
  const stored = { ...DAILY_DEFAULTS, ...(values.dailySummary ?? {}) };
  const [draft, setDraft] = React.useState<DailySummarySettings>(stored);
  const [phones, setPhones] = React.useState(stored.phones.join(", "));
  const [phonesBad, setPhonesBad] = React.useState(false);
  const [view, setView] = React.useState<DailySummaryView | null>(null);
  const preview = usePreviewDailySummary();
  const send = useSendDailySummary();
  const helperOff = values.features["daily-summary"] === false;
  const blocked = !values.enabled || helperOff;

  const save = async () => {
    const list = phones
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (list.some((p) => !phoneOk(p)) || list.length > 5) {
      setPhonesBad(true);
      return;
    }
    setPhonesBad(false);
    await onPatch({ dailySummary: { ...draft, phones: list } });
  };
  const run = async (kind: "preview" | "send") => {
    try {
      const r = kind === "preview" ? await preview.mutateAsync({ language: draft.language }) : await send.mutateAsync();
      setView(r);
      if (kind === "send") toast.success(t("workspace.ai.daily.sent"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <SectionCard
      icon={CalendarClockIcon}
      title={t("workspace.ai.daily.title")}
      description={t("workspace.ai.daily.subtitle")}
      action={draft.enabled && !blocked ? <StatusPill tone="success">{draft.time}</StatusPill> : undefined}
    >
      <div className="grid gap-4" data-testid="ai-daily-card">
        {blocked && <p className="text-sm text-muted-foreground">{t("workspace.ai.daily.needAi")}</p>}
        <Label className="flex items-center gap-3 font-normal">
          <Switch checked={draft.enabled} disabled={!canEdit || busy || blocked} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} aria-label={t("workspace.ai.daily.on")} />
          <span className="font-medium">{t("workspace.ai.daily.on")}</span>
        </Label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>{t("workspace.ai.daily.time")}</FieldLabel>
            <FieldControl>
              <Input type="time" value={draft.time} disabled={!canEdit || blocked} onChange={(e) => setDraft({ ...draft, time: e.target.value || "21:00" })} />
            </FieldControl>
            {draft.time < "12:00" && <FieldHint>{t("workspace.ai.daily.before12")}</FieldHint>}
          </Field>
          <Field>
            <FieldLabel>{t("workspace.ai.daily.language")}</FieldLabel>
            <FieldControl>
              <Select value={draft.language} onValueChange={(v) => setDraft({ ...draft, language: v as "en" | "ta" })} disabled={!canEdit || blocked}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t("workspace.ai.daily.lang.en")}</SelectItem>
                  <SelectItem value="ta">{t("workspace.ai.daily.lang.ta")}</SelectItem>
                </SelectContent>
              </Select>
            </FieldControl>
          </Field>
        </div>
        <Label className="flex items-center gap-3 font-normal">
          <Switch checked={draft.toOwner} disabled={!canEdit || blocked} onCheckedChange={(toOwner) => setDraft({ ...draft, toOwner })} aria-label={t("workspace.ai.daily.toOwner")} />
          <span>{t("workspace.ai.daily.toOwner")}</span>
        </Label>
        <Field>
          <FieldLabel>{t("workspace.ai.daily.phones")}</FieldLabel>
          <FieldControl>
            <Input value={phones} disabled={!canEdit || blocked} inputMode="tel" placeholder="98765 43210, 98765 43211" onChange={(e) => setPhones(e.target.value)} />
          </FieldControl>
          <FieldHint>{phonesBad ? t("workspace.ai.daily.phonesBad") : t("workspace.ai.daily.phonesHint")}</FieldHint>
        </Field>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy || blocked} onClick={() => void save()}>
              {t("workspace.ai.daily.save")}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={blocked || preview.isPending} onClick={() => void run("preview")}>
              {preview.isPending && <Loader2Icon className="animate-spin" />}
              {preview.isPending ? t("workspace.ai.daily.previewing") : t("workspace.ai.daily.preview")}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={blocked || send.isPending} onClick={() => void run("send")}>
              {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              {t("workspace.ai.daily.send")}
            </Button>
          </div>
        )}
        {view && (
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="mb-1 flex items-center gap-2 text-meta font-medium text-muted-foreground">
              {t(view.id ? "workspace.ai.daily.latestTitle" : "workspace.ai.daily.previewTitle")}
              <StatusPill tone="neutral">{t("workspace.ai.daily.credits", { n: view.credits })}</StatusPill>
            </p>
            <SummaryBody s={view} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}
