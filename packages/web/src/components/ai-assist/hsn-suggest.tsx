"use client";

import * as React from "react";
import { Loader2Icon, SparklesIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, Button, cn, toast } from "@srirealtime/ui";
import { api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { sendAiFeedback } from "../ai-draft";
import { helperOn, useAiAssistAllowed, useAiAssistStatus } from "./use-assist";

export interface HsnSuggestionView {
  hsn: string;
  kind: "goods" | "service";
  description: string;
  gstRate: number;
  gstRule: { kind: "price-band"; threshold: number; below: number; above: number } | null;
  confidence: "low" | "medium" | "high";
  reason: string;
}
interface HsnResponse {
  suggestions: HsnSuggestionView[];
  notSure: boolean;
  runId: string | null;
  credits: number;
}

export interface HsnApply {
  hsn: string;
  gstRate: number;
  gstRule: HsnSuggestionView["gstRule"];
  kind: "goods" | "service";
}

export interface UseHsnSuggestOptions {
  /** The item name as typed. */
  name: string;
  /** Category or brand, to help with vague names. */
  hint?: string;
  /** Price in paise, to pick the apparel / footwear band. */
  price?: number;
  /** An HSN is already filled in: do not auto-suggest over it. */
  hasHsn?: boolean;
}

/**
 * HSN + GST suggestion for an item form. `run()` is the "Suggest HSN & GST" button; `auto()` is called when the name box
 * loses focus and only does something when the owner switched "auto-suggest" on in Settings > AI (each suggestion uses
 * about 1 credit). Nothing is filled in until the person presses "Use this".
 */
export function useHsnSuggest({ name, hint, price, hasHsn }: UseHsnSuggestOptions) {
  const { t } = useI18n();
  const allowed = useAiAssistAllowed();
  const status = useAiAssistStatus(allowed);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<HsnResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const lastName = React.useRef("");
  const seq = React.useRef(0);

  const ask = React.useCallback(
    async (quiet: boolean) => {
      const n = name.trim();
      if (n.length < 2) {
        if (!quiet) toast.info(t("web.aiAssist.hsn.needName"));
        return;
      }
      const mine = ++seq.current;
      lastName.current = n;
      setBusy(true);
      setError(null);
      try {
        const r = await api.post<HsnResponse>("/ai/assist/hsn", { name: n, ...(hint ? { hint } : {}), ...(typeof price === "number" && price > 0 ? { price } : {}) });
        if (mine === seq.current) setResult(r);
      } catch (e) {
        if (mine === seq.current && !quiet) setError(describeError(e, t));
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [name, hint, price, t],
  );

  return {
    allowed,
    busy,
    result,
    error,
    autoOn: allowed && status.data?.settings.autoHsn === true && helperOn(status.data, "hsn-suggest"),
    run: () => ask(false),
    /** For the name input's onBlur. */
    auto: () => {
      if (!allowed || status.data?.settings.autoHsn !== true || !helperOn(status.data, "hsn-suggest")) return;
      if (hasHsn || busy || name.trim().length < 3 || name.trim() === lastName.current) return;
      void ask(true);
    },
    clear: () => {
      seq.current++;
      setResult(null);
      setError(null);
      setBusy(false);
    },
  };
}

export type HsnSuggestState = ReturnType<typeof useHsnSuggest>;

/** The button and the suggestions card. Render it under the HSN field. */
export function HsnSuggestPanel({ state, onApply, className }: { state: HsnSuggestState; onApply: (a: HsnApply) => void; className?: string }) {
  const { t } = useI18n();
  if (!state.allowed) return null;
  const { result } = state;
  const apply = (s: HsnSuggestionView) => {
    onApply({ hsn: s.hsn, gstRate: s.gstRate, gstRule: s.gstRule, kind: s.kind });
    if (result?.runId) void sendAiFeedback(result.runId, "accepted").catch(() => undefined);
    toast.success(t("web.aiAssist.hsn.applied"));
    state.clear();
  };
  const dismiss = () => {
    if (result?.runId) void sendAiFeedback(result.runId, "rejected").catch(() => undefined);
    state.clear();
  };
  const money = (paise: number) => (paise / 100).toLocaleString("en-IN");
  return (
    <div className={cn("grid gap-2", className)} data-slot="hsn-suggest">
      <div>
        <Button type="button" size="sm" variant="outline" onClick={() => void state.run()} disabled={state.busy}>
          {state.busy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          {state.busy ? t("web.aiAssist.hsn.busy") : t("web.aiAssist.hsn.button")}
        </Button>
      </div>
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {result && (
        <div className="grid gap-2 rounded-xl bg-primary/5 p-3 ring-1 ring-primary/20 ring-inset" role="status">
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <SparklesIcon className="size-4 text-primary" aria-hidden /> {t("web.aiAssist.hsn.title")}
            </p>
            <Button type="button" size="icon-sm" variant="ghost" onClick={dismiss} aria-label={t("web.aiAssist.hsn.dismiss")}>
              <XIcon />
            </Button>
          </div>
          <p className="text-meta text-muted-foreground">{t("web.aiAssist.draft")}</p>
          {result.notSure || result.suggestions.length === 0 ? (
            <p className="text-sm">{t("web.aiAssist.hsn.notSure")}</p>
          ) : (
            <ul className="grid gap-2">
              {result.suggestions.map((s) => (
                <li key={s.hsn} className="grid gap-1 rounded-lg bg-background p-2.5 ring-1 ring-border ring-inset">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm">
                      <span className="font-mono font-semibold">{s.hsn}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.kind === "service" ? `${t("web.aiAssist.hsn.service")} · ` : ""}
                        {t(`web.aiAssist.hsn.confidence.${s.confidence}`)}
                      </span>
                    </p>
                    <Button type="button" size="sm" onClick={() => apply(s)}>
                      {t("web.aiAssist.hsn.use")}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                  <p className="text-xs font-medium">
                    {s.gstRule
                      ? t("web.aiAssist.hsn.band", { below: s.gstRule.below, above: s.gstRule.above, limit: money(s.gstRule.threshold) })
                      : t("web.aiAssist.hsn.verify", { rate: s.gstRate })}
                  </p>
                  {s.reason && <p className="text-xs text-muted-foreground">{s.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
