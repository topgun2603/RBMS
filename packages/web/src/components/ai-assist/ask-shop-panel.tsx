"use client";

import * as React from "react";
import { ChevronDownIcon, Loader2Icon, MicIcon, MicOffIcon, SendIcon, SparklesIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Textarea } from "@srirealtime/ui";
import { api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { Answer } from "./help-panel";
import { useAiAssistAllowed } from "./use-assist";

export interface AskTable {
  id: string;
  title: string;
  titleTa: string;
  columns: { key: string; label: string; labelTa: string; kind: "money" | "int" | "num" | "text" | "date" | "percent" }[];
  rows: Record<string, string | number | null>[];
}
export interface AskResponse {
  answer: string;
  language: "en" | "ta";
  blocks: AskTable[];
  verified: boolean;
  fallback: boolean;
  credits: number;
}
interface Turn {
  id: number;
  question: string;
  res?: AskResponse;
  error?: string;
}

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = { format: (n: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n) };
export function formatCell(kind: AskTable["columns"][number]["kind"], v: string | number | null): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "string") return v;
  if (kind === "money") return `${v < 0 ? "-" : ""}₹${money.format(Math.abs(v))}`;
  if (kind === "percent") return `${inr.format(v)}%`;
  return inr.format(v);
}

/** The tables under an answer, rendered from the tool data (never written by the model). */
export function FiguresTables({ blocks, ta }: { blocks: AskTable[]; ta: boolean }) {
  return (
    <div className="grid gap-3">
      {blocks.map((b) => (
        <div key={`${b.id}-${b.title}`} className="grid gap-1">
          <p className="text-xs font-semibold">{ta ? b.titleTa : b.title}</p>
          <div className="overflow-x-auto rounded-lg ring-1 ring-border ring-inset">
            <table className="w-full min-w-max text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  {b.columns.map((c) => (
                    <th key={c.key} className={`px-2 py-1.5 font-medium ${c.kind === "text" || c.kind === "date" ? "text-left" : "text-right"}`}>
                      {ta ? c.labelTa : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    {b.columns.map((c) => (
                      <td key={c.key} className={`px-2 py-1.5 tabular-nums ${c.kind === "text" || c.kind === "date" ? "text-left" : "text-right"}`}>
                        {formatCell(c.kind, r[c.key] ?? null)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
const speechCtor = (): SpeechCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/**
 * "Ask" in the top bar: a chat about the shop's own numbers (sales, dues, stock, expenses, GST) in Tamil, Tanglish or
 * English, answered from the shop's reports by `POST /v1/ai/ask`. The browser keeps the last turns and sends them with each
 * question so follow-ups work. Needs `ai.use` and `reports.view`; hidden for the read-only demo role.
 */
export function AskShopButton() {
  const { t, locale } = useI18n();
  const allowed = useAiAssistAllowed("reports.view");
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [micError, setMicError] = React.useState(false);
  const [micOk, setMicOk] = React.useState(false);
  const [figures, setFigures] = React.useState<Record<number, boolean>>({});
  const recRef = React.useRef<InstanceType<SpeechCtor> | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const seq = React.useRef(0);
  React.useEffect(() => {
    setMicOk(!!speechCtor());
  }, []);
  React.useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns, busy]);
  if (!allowed) return null;

  const ask = async (text?: string) => {
    const question = (text ?? q).trim();
    if (question.length < 2 || busy) return;
    const history = turns
      .filter((x) => x.res)
      .slice(-3)
      .flatMap((x) => [
        { role: "user" as const, content: x.question.slice(0, 500) },
        { role: "assistant" as const, content: x.res!.answer.slice(0, 600) },
      ]);
    const id = ++seq.current;
    setTurns((p) => [...p, { id, question }]);
    setQ("");
    setBusy(true);
    try {
      const res = await api.post<AskResponse>("/ai/ask", { question, history });
      setTurns((p) => p.map((x) => (x.id === id ? { ...x, res } : x)));
    } catch (err) {
      setTurns((p) => p.map((x) => (x.id === id ? { ...x, error: describeError(err, t) } : x)));
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    setMicError(false);
    const rec = new Ctor();
    rec.lang = locale === "ta" ? "ta-IN" : "en-IN";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }>>)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (text) setQ(text);
    };
    rec.onerror = () => setMicError(true);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      setMicError(true);
    }
  };

  const suggestions = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => t(`web.aiAsk.suggest.${n}`));

  return (
    <>
      <Button variant="ghost" className="gap-1.5 px-2" aria-label={t("web.aiAsk.title")} onClick={() => setOpen(true)}>
        <SparklesIcon />
        <span className="hidden text-xs font-semibold sm:inline">{t("web.aiAsk.button")}</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-hidden sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("web.aiAsk.title")}</SheetTitle>
            <SheetDescription>{t("web.aiAsk.intro")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4" aria-live="polite">
            {turns.length === 0 && (
              <div className="grid gap-2">
                <p className="text-xs font-semibold text-muted-foreground">{t("web.aiAsk.suggest.title")}</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <Button key={s} type="button" size="sm" variant="outline" className="h-auto whitespace-normal py-1.5 text-left" onClick={() => void ask(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
                <p className="text-meta text-muted-foreground">{t("web.aiAsk.note")}</p>
              </div>
            )}
            {turns.map((x) => (
              <div key={x.id} className="grid gap-2">
                <p className="ml-auto max-w-[85%] rounded-xl bg-primary/10 px-3 py-2 text-sm">{x.question}</p>
                {x.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{x.error}</AlertDescription>
                  </Alert>
                )}
                {!x.res && !x.error && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" /> {t("web.aiAsk.thinking")}
                  </p>
                )}
                {x.res && (
                  <div className="grid gap-2 rounded-xl bg-muted/40 p-3 ring-1 ring-border ring-inset" lang={x.res.language}>
                    {x.res.fallback && (
                      <p className="flex items-start gap-1.5 text-xs text-warning-ink">
                        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {t("web.aiAsk.fallback")}
                      </p>
                    )}
                    <Answer text={x.res.answer} />
                    {x.res.blocks.length > 0 && (
                      <>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 justify-self-start text-xs font-medium text-primary hover:underline"
                          aria-expanded={figures[x.id] ?? x.res.fallback}
                          onClick={() => setFigures((p) => ({ ...p, [x.id]: !(p[x.id] ?? x.res!.fallback) }))}
                        >
                          <ChevronDownIcon className={`size-3.5 transition-transform ${(figures[x.id] ?? x.res.fallback) ? "rotate-180" : ""}`} />
                          {(figures[x.id] ?? x.res.fallback) ? t("web.aiAsk.hideFigures") : t("web.aiAsk.showFigures")}
                        </button>
                        {(figures[x.id] ?? x.res.fallback) && <FiguresTables blocks={x.res.blocks} ta={locale === "ta"} />}
                      </>
                    )}
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
                      {x.res.verified && (
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheckIcon className="size-3.5" /> {t("web.aiAsk.verified")}
                        </span>
                      )}
                      <span>{t("web.aiAsk.creditsUsed", { count: x.res.credits })}</span>
                    </p>
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <form
            className="grid gap-2 border-t px-4 pt-3 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <Textarea
              rows={2}
              maxLength={500}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("web.aiAsk.placeholder")}
              aria-label={t("web.aiAsk.title")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask();
                }
              }}
            />
            {micError && <p className="text-xs text-destructive">{t("web.aiAsk.micFailed")}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-meta text-muted-foreground">{t("web.aiAsk.credits")}</p>
              <div className="flex items-center gap-2">
                {turns.length > 0 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setTurns([])}>
                    {t("web.aiAsk.new")}
                  </Button>
                )}
                {micOk && (
                  <Button type="button" size="sm" variant={listening ? "default" : "outline"} aria-label={listening ? t("web.aiAsk.micStop") : t("web.aiAsk.mic")} onClick={toggleMic}>
                    {listening ? <MicOffIcon /> : <MicIcon />}
                  </Button>
                )}
                <Button type="submit" size="sm" disabled={busy || q.trim().length < 2}>
                  {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {t("web.aiAsk.send")}
                </Button>
              </div>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
