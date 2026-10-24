"use client";

import * as React from "react";
import { Loader2Icon, WrenchIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Textarea } from "@srirealtime/ui";
import { useI18n } from "../../lib/i18n";
import { AiDraftBanner } from "../ai-draft";
import { MicButton, postTrades, rupeesText, useTradesError, useTradesHelper, type Run } from "./shared";

interface Hit {
  id: string;
  name: string;
  rate: number;
  gstRate: number;
  stockQty?: number | null;
}
interface Need {
  kind: "part" | "labour";
  keyword: string;
  matches: Hit[];
}
interface Result extends Run {
  draft: {
    summary: string;
    causes: string[];
    checks: string[];
    needs: Need[];
    estimate: { low: number; high: number; lowWithGst: number; highWithGst: number; unpriced: string[] } | null;
    suspicious: boolean;
    fallback: boolean;
  };
}

/** The note that goes into the job card's issue box (short, plain text; the technician edits it there). */
export function faultNoteText(d: Result["draft"], labels: { causes: string; checks: string; parts: string }): string {
  const parts = d.needs.filter((n) => n.matches.length > 0).map((n) => n.matches[0]!.name);
  return [
    d.summary,
    d.causes.length ? `${labels.causes}: ${d.causes.join("; ")}` : "",
    d.checks.length ? `${labels.checks}: ${d.checks.join("; ")}` : "",
    parts.length ? `${labels.parts}: ${parts.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * "Draft fault note" on a new device job card: the customer's complaint (typed or spoken, Tamil / Tanglish / English) becomes
 * a fault summary, possible causes, checks, and the parts and labour found in the shop's own catalogue with a price range from
 * their rates. Nothing is quoted: the note only goes into the issue box when the technician presses "Add to job card".
 */
export function FaultNoteButton({ complaint, brand, model, onApply, className }: { complaint: string; brand?: string; model?: string; onApply: (text: string) => void; className?: string }) {
  const { t, locale } = useI18n();
  const { show } = useTradesHelper("fault-note", "jobcards.manage");
  const errText = useTradesError();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<Result | null>(null);
  if (!show) return null;

  const start = () => {
    setText(complaint);
    setRes(null);
    setError(null);
    setOpen(true);
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setRes(await postTrades<Result>("fault-note", { complaint: text.trim(), brand: brand?.trim() || null, model: model?.trim() || null, language: locale === "ta" ? "ta" : "en" }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const d = res?.draft;

  return (
    <>
      <Button type="button" size="sm" variant="outline" className={className} onClick={start}>
        <WrenchIcon /> {t("web.aiTrades.fault.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("web.aiTrades.fault.title")}</DialogTitle>
            <DialogDescription>{t("web.aiTrades.fault.intro")}</DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ai-fault-text">{t("web.aiTrades.fault.complaint")}</Label>
              <MicButton onText={(s) => setText((p) => `${p} ${s}`.trim())} />
            </div>
            <Textarea id="ai-fault-text" rows={3} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-meta text-muted-foreground">{t("web.aiTrades.fault.credits")}</p>
          </div>
          {d && res && (
            <div className="grid gap-4">
              <AiDraftBanner runId={res.runId} credits={res.credits} mock={res.provider === "mock"} />
              {d.suspicious && <p className="text-sm text-amber-700 dark:text-amber-400">{t("web.aiTrades.injection")}</p>}
              <section className="grid gap-1">
                <h3 className="text-sm font-semibold">{t("web.aiTrades.fault.summary")}</h3>
                <p className="text-sm">{d.summary}</p>
              </section>
              {d.causes.length > 0 && (
                <section className="grid gap-1">
                  <h3 className="text-sm font-semibold">{t("web.aiTrades.fault.causes")}</h3>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm">
                    {d.causes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </section>
              )}
              {d.checks.length > 0 && (
                <section className="grid gap-1">
                  <h3 className="text-sm font-semibold">{t("web.aiTrades.fault.checks")}</h3>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm">
                    {d.checks.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </section>
              )}
              {d.needs.length > 0 && (
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">{t("web.aiTrades.fault.parts")}</h3>
                  <ul className="grid gap-2 text-sm">
                    {d.needs.map((n) => (
                      <li key={`${n.kind}-${n.keyword}`} className="rounded-md border p-2">
                        <div className="font-medium">
                          {n.keyword} <span className="text-meta font-normal text-muted-foreground">({t(`web.aiTrades.fault.kind.${n.kind}`)})</span>
                        </div>
                        {n.matches.length === 0 ? (
                          <div className="text-meta text-muted-foreground">{t("web.aiTrades.fault.notInCatalogue")}</div>
                        ) : (
                          <ul className="mt-1 grid gap-0.5">
                            {n.matches.map((m) => (
                              <li key={m.id} className="flex justify-between gap-3">
                                <span className="min-w-0 truncate">{m.name}</span>
                                <span className="shrink-0 tabular-nums">{rupeesText(m.rate)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {d.estimate && (
                <section className="grid gap-1 rounded-md bg-muted/50 p-3 text-sm">
                  <h3 className="font-semibold">{t("web.aiTrades.fault.estimate")}</h3>
                  <p className="tabular-nums">
                    {d.estimate.low === d.estimate.high ? rupeesText(d.estimate.low) : `${rupeesText(d.estimate.low)} – ${rupeesText(d.estimate.high)}`} <span className="text-muted-foreground">{t("web.aiTrades.fault.exGst")}</span>
                  </p>
                  <p className="text-meta text-muted-foreground">{t("web.aiTrades.fault.estimateNote")}</p>
                  {d.estimate.unpriced.length > 0 && <p className="text-meta text-muted-foreground">{t("web.aiTrades.fault.unpriced", { items: d.estimate.unpriced.join(", ") })}</p>}
                </section>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("web.common.close")}
            </Button>
            <Button type="button" variant={d ? "outline" : "default"} disabled={busy || text.trim().length < 3} onClick={run}>
              {busy && <Loader2Icon className="animate-spin" />} {d ? t("web.aiTrades.again") : t("web.aiTrades.fault.run")}
            </Button>
            {d && (
              <Button
                type="button"
                onClick={() => {
                  onApply(faultNoteText(d, { causes: t("web.aiTrades.fault.causesShort"), checks: t("web.aiTrades.fault.checksShort"), parts: t("web.aiTrades.fault.partsShort") }));
                  setOpen(false);
                }}
              >
                {t("web.aiTrades.fault.add")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
