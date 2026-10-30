"use client";

import * as React from "react";
import { CheckIcon, PencilIcon, SparklesIcon, XIcon } from "lucide-react";
import { Button, cn } from "@rbms/ui";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";

export type AiOutcome = "accepted" | "edited" | "rejected";

/** Tells the API what the person did with an AI draft, so "saved without edits" can be measured (`POST /v1/ai/runs/:id/feedback`). */
export function sendAiFeedback(runId: string, outcome: AiOutcome, note?: string) {
  return api.post<{ ok: true }>(`/ai/runs/${runId}/feedback`, note ? { outcome, note } : { outcome });
}

export interface AiDraftBannerProps {
  /** The `runId` the AI route returned with the draft. Without it the buttons only call `onOutcome`. */
  runId?: string;
  /** Called after the person picks an outcome (and the feedback was sent). Save, edit or discard the draft here. */
  onOutcome?: (outcome: AiOutcome) => void;
  /** Credits the run used, shown small. */
  credits?: number;
  /** The answer came from the sample provider (no AI key yet). */
  mock?: boolean;
  /** Hide the three buttons (read-only views of an old draft). */
  readOnly?: boolean;
  className?: string;
}

/**
 * "AI draft, check before saving" strip with accept / edited / rejected. Every AI result is a draft: show this above it,
 * apply nothing until the person confirms, and let the buttons report the outcome. Reused by every AI helper.
 * Usage: `<AiDraftBanner runId={r.runId} credits={r.credits} onOutcome={(o) => o === "rejected" ? discard() : save()} />`
 */
export function AiDraftBanner({ runId, onOutcome, credits, mock, readOnly, className }: AiDraftBannerProps) {
  const { t } = useI18n();
  const [sent, setSent] = React.useState<AiOutcome | null>(null);
  const [busy, setBusy] = React.useState(false);

  const choose = async (outcome: AiOutcome) => {
    if (busy) return;
    setBusy(true);
    try {
      if (runId) await sendAiFeedback(runId, outcome);
    } catch {
      // Feedback is best effort: never block saving or discarding the draft over it.
    } finally {
      setBusy(false);
    }
    setSent(outcome);
    onOutcome?.(outcome);
  };

  return (
    <div
      role="status"
      data-slot="ai-draft-banner"
      className={cn("flex flex-col gap-2 rounded-xl bg-primary/5 p-3 text-sm ring-1 ring-primary/20 ring-inset sm:flex-row sm:items-center sm:justify-between", className)}
    >
      <div className="flex min-w-0 items-start gap-2">
        <SparklesIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">{sent ? t("web.ai.thanks") : t("web.ai.title")}</p>
          <p className="text-meta text-muted-foreground">
            {sent ? t(sent === "accepted" ? "web.ai.thanksAccepted" : sent === "edited" ? "web.ai.thanksEdited" : "web.ai.thanksRejected") : t("web.ai.hint")}
            {mock && <> {t("web.ai.mock")}.</>}
            {typeof credits === "number" && credits > 0 && <> {credits === 1 ? t("web.ai.credits1") : t("web.ai.credits", { n: credits })}.</>}
          </p>
        </div>
      </div>
      {!readOnly && !sent && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => void choose("accepted")}>
            <CheckIcon /> {t("web.ai.accept")}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void choose("edited")}>
            <PencilIcon /> {t("web.ai.edit")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void choose("rejected")}>
            <XIcon /> {t("web.ai.reject")}
          </Button>
        </div>
      )}
    </div>
  );
}
