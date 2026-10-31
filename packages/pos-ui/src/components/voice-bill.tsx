"use client";

import * as React from "react";
import { Loader2Icon, MicIcon, MicOffIcon, PlusIcon, SearchIcon, SparklesIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button, cn, Input, toast } from "@rbms/ui";
import { describeError, useAiAssistAllowed, useAiAssistStatus, useI18n, useVoice, VoiceLangChip } from "@rbms/web";
import { posApi } from "../lib/api";
import type { CartProduct } from "../lib/cart";
import { money } from "../lib/format";

/**
 * Tamil voice billing (AI Phase 5 part A, docs/ai.md): a mic in the counter's search bar. The cashier says the order, the server reads
 * quantities and units and finds the shop's items in code (the light AI tier helps only with words it could not match, choosing from
 * the shop's own items), and this strip shows every line with its price. Lines that are not clearly one item need a tap to choose.
 * "Add" puts the lines in the cart; nothing is billed here.
 */

export interface VoiceItem {
  itemId: string;
  productId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  unit: string;
  price: number;
  taxInclusive: boolean;
  gstRate: number;
  gstRule: unknown;
  image: string | null;
  soldBy: "unit" | "weight";
}
export interface VoiceLineView {
  n: number;
  raw: string;
  phrase: string;
  qty: number;
  unit: string | null;
  spoken: { qty: number; unit: string | null; explicit: boolean };
  status: "matched" | "choose" | "not_found";
  confidence: "high" | "medium" | "low" | null;
  source: "parser" | "ai";
  item: VoiceItem | null;
  candidates: VoiceItem[];
  note: string;
  check: boolean;
  issues: string[];
  lineTotal: number | null;
}
export interface VoiceResultView {
  lines: VoiceLineView[];
  ignored: string[];
  transcript: string;
  credits: number;
  meta: { parserMs: number; aiMs: number; totalMs: number; unresolved: number; ai: { used: boolean; credits: number; error: string | null }; suspicious: boolean };
}

/** What the screen adds to the cart for one confirmed line. */
export interface VoiceAddLine {
  product: CartProduct & { soldBy: "unit" | "weight" };
  qty: number;
  /** What was said, for the weighing prompt. */
  said: { qty: number; unit: string | null };
}

const toProduct = (i: VoiceItem): VoiceAddLine["product"] => ({
  itemId: i.itemId,
  productId: i.productId,
  name: i.name,
  sku: i.sku,
  barcode: i.barcode,
  hsn: i.hsn,
  unit: i.unit || "pcs",
  price: i.price,
  taxInclusive: i.taxInclusive,
  gstRate: i.gstRate,
  ...(i.gstRule ? { gstRule: i.gstRule as CartProduct["gstRule"] } : {}),
  image: i.image,
  soldBy: i.soldBy,
});

export interface VoiceBillApi {
  /** Show the button at all (the person may use AI helpers, the helper is not switched off for the shop). */
  available: boolean;
  open: boolean;
  text: string;
  setText: (t: string) => void;
  loading: boolean;
  result: VoiceResultView | null;
  /** Milliseconds from the end of speech (or Enter) to the lines on screen. */
  ms: number | null;
  listening: boolean;
  supported: boolean;
  lang: "ta" | "en";
  setLang: (l: "ta" | "en") => void;
  voiceError: string | null;
  start: () => void;
  stopListening: () => void;
  close: () => void;
  submit: (text?: string) => Promise<void>;
  picks: Record<number, string>;
  pick: (n: number, itemId: string) => void;
  qtys: Record<number, string>;
  setQty: (n: number, v: string) => void;
  removed: Set<number>;
  remove: (n: number) => void;
  /** Lines that are ready to add, with the item and quantity the cashier is looking at. */
  ready: { line: VoiceLineView; item: VoiceItem; qty: number }[];
  pending: number;
  addAll: () => void;
}

const parseQty = (s: string | undefined, fallback: number) => {
  if (s === undefined || s.trim() === "") return fallback;
  const v = Number(s.replace(",", "."));
  return Number.isFinite(v) && v > 0 && v <= 100_000 ? v : fallback;
};

export function useVoiceBill(opts: { onAdd: (lines: VoiceAddLine[]) => void }): VoiceBillApi {
  const { t } = useI18n();
  const allowed = useAiAssistAllowed("invoices.create");
  const status = useAiAssistStatus(allowed);
  const flag = (status.data?.features as { key: string; allowed?: boolean }[] | undefined)?.find((f) => f.key === "voice-billing");
  const available = allowed && flag?.allowed !== false;

  const [open, setOpen] = React.useState(false);
  const [text, setTextState] = React.useState("");
  const textRef = React.useRef("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<VoiceResultView | null>(null);
  const [ms, setMs] = React.useState<number | null>(null);
  const [picks, setPicks] = React.useState<Record<number, string>>({});
  const [qtys, setQtys] = React.useState<Record<number, string>>({});
  const [removed, setRemoved] = React.useState<Set<number>>(new Set());
  const seq = React.useRef(0);

  const setText = React.useCallback((v: string) => {
    textRef.current = v;
    setTextState(v);
  }, []);

  const submit = React.useCallback(
    async (said?: string) => {
      const transcript = (said ?? textRef.current).trim();
      if (!transcript) return;
      const my = ++seq.current;
      const t0 = performance.now();
      setLoading(true);
      setMs(null);
      try {
        const r = await posApi.post<VoiceResultView>("/ai/counter/voice/parse", { transcript });
        if (my !== seq.current) return;
        setResult(r);
        setPicks({});
        setQtys({});
        setRemoved(new Set());
        // measured to the next paint, i.e. when the lines are really on screen
        requestAnimationFrame(() => setMs(Math.round(performance.now() - t0)));
      } catch (err) {
        if (my === seq.current) toast.error(describeError(err, t));
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [t],
  );

  // Speaking: the live words fill the box; when listening stops (silence or a tap) the order is read.
  const voice = useVoice({ onText: (v) => setText(v), defaultLang: "ta", storageKey: "sr_voice_lang_bill", silenceMs: 1500 });
  const was = React.useRef(false);
  React.useEffect(() => {
    if (was.current && !voice.listening && textRef.current.trim()) void submit();
    was.current = voice.listening;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to listening ending only
  }, [voice.listening]);

  const start = React.useCallback(() => {
    setOpen(true);
    if (voice.supported && !voice.listening) {
      setText("");
      setResult(null);
      voice.start();
    }
  }, [voice, setText]);

  const close = React.useCallback(() => {
    voice.stop();
    seq.current++;
    setOpen(false);
    setResult(null);
    setText("");
    setLoading(false);
  }, [voice, setText]);

  const ready = React.useMemo(() => {
    const out: VoiceBillApi["ready"] = [];
    for (const line of result?.lines ?? []) {
      if (removed.has(line.n)) continue;
      const chosen = picks[line.n] ? line.candidates.find((c) => c.itemId === picks[line.n]) : line.status === "matched" ? line.item : null;
      if (!chosen) continue;
      out.push({ line, item: chosen, qty: parseQty(qtys[line.n], line.qty) });
    }
    return out;
  }, [result, picks, qtys, removed]);
  const pending = (result?.lines ?? []).filter((l) => !removed.has(l.n)).length - ready.length;

  const addAll = React.useCallback(() => {
    if (!ready.length) return;
    opts.onAdd(ready.map((r) => ({ product: toProduct(r.item), qty: r.qty, said: { qty: r.line.spoken.qty, unit: r.line.spoken.unit } })));
    toast.success(t("pos.voice.added", { count: ready.length }));
    const done = new Set(ready.map((r) => r.line.n));
    setRemoved((prev) => new Set([...prev, ...done]));
    if (pending === 0) close();
  }, [ready, opts, pending, close, t]);

  return {
    available,
    open,
    text,
    setText,
    loading,
    result,
    ms,
    listening: voice.listening,
    supported: voice.supported,
    lang: voice.lang,
    setLang: voice.setLang,
    voiceError: voice.error,
    start,
    stopListening: voice.stop,
    close,
    submit,
    picks,
    pick: (n, id) => setPicks((p) => ({ ...p, [n]: id })),
    qtys,
    setQty: (n, v) => setQtys((q) => ({ ...q, [n]: v })),
    removed,
    remove: (n) => setRemoved((r) => new Set([...r, n])),
    ready,
    pending,
    addAll,
  };
}

/** The mic in the search bar row. One tap opens the strip and starts listening (or just opens it where the browser cannot listen). */
export function VoiceBillButton({ vb }: { vb: VoiceBillApi }) {
  const { t } = useI18n();
  if (!vb.available) return null;
  return (
    <Button
      type="button"
      variant={vb.open ? "default" : "outline"}
      size="icon-lg"
      onClick={() => (vb.open && vb.listening ? vb.stopListening() : vb.open ? vb.close() : vb.start())}
      aria-label={vb.listening ? t("pos.voice.micStop") : t("pos.voice.mic")}
      aria-pressed={vb.open}
      title={t("pos.voice.title")}
      data-testid="voice-bill-button"
    >
      {vb.listening ? <MicOffIcon className="animate-pulse" /> : <MicIcon />}
    </Button>
  );
}

const BADGE = "rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold";

/** The review strip: heard text, one row per line with price and confidence, choices for the unsure ones, Add. */
export function VoiceReview({ vb, onSearch }: { vb: VoiceBillApi; onSearch: (text: string) => void }) {
  const { t } = useI18n();
  if (!vb.available || !vb.open) return null;
  const r = vb.result;
  const total = vb.ready.reduce((s, x) => s + Math.round(x.qty * x.item.price), 0);
  return (
    <section className="flex max-h-[min(72dvh,42rem)] min-h-0 flex-col rounded-xl border bg-card p-3 shadow-xs" aria-label={t("pos.voice.title")} data-testid="voice-bill-strip" data-voice-ms={vb.ms ?? ""}>
      <div className="flex items-center gap-2">
        <h2 className="mr-auto flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
          <MicIcon className="size-4 shrink-0 text-primary" aria-hidden /> <span className="truncate">{t("pos.voice.title")}</span>
        </h2>
        {vb.supported && <VoiceLangChip lang={vb.lang} onChange={vb.setLang} />}
        <Button type="button" size="icon-sm" variant="ghost" onClick={vb.close} aria-label={t("pos.voice.close")}>
          <XIcon />
        </Button>
      </div>
      {vb.listening ? (
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          <span className="animate-pulse">●</span> {vb.text || t("pos.voice.listening")}
        </p>
      ) : (
        !r && <p className="mt-1 text-xs text-muted-foreground">{vb.supported ? t("pos.voice.hint") : t("pos.voice.unsupported")}</p>
      )}
      {vb.voiceError && <p className="mt-1 text-xs text-destructive" role="alert">{t(`web.voice.err.${vb.voiceError === "no-speech" ? "noSpeech" : vb.voiceError === "unsupported-lang" ? "lang" : vb.voiceError}`)}</p>}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void vb.submit();
        }}
      >
        <Input value={vb.text} onChange={(e) => vb.setText(e.target.value)} placeholder={t("pos.voice.placeholder")} aria-label={t("pos.voice.heard")} data-testid="voice-bill-text" className="min-w-0 flex-1" autoComplete="off" spellCheck={false} />
        <Button type="submit" variant="outline" disabled={vb.loading || !vb.text.trim()} data-testid="voice-bill-parse">
          {vb.loading ? <Loader2Icon className="animate-spin" /> : null}
          {vb.loading ? t("pos.voice.working") : t("pos.voice.parse")}
        </Button>
      </form>

      {r && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
          {r.lines.length === 0 && <p className="text-sm text-muted-foreground">{t("pos.voice.empty")}</p>}
          <ul className="grid min-h-0 gap-2 overflow-y-auto pr-0.5">
            {r.lines
              .filter((l) => !vb.removed.has(l.n))
              .map((l) => {
                const chosen = vb.picks[l.n] ? l.candidates.find((c) => c.itemId === vb.picks[l.n]) : l.status === "matched" ? l.item : null;
                const qty = parseQty(vb.qtys[l.n], l.qty);
                const sure = chosen && l.status === "matched" && l.source === "parser" && l.confidence === "high" && !l.check;
                return (
                  <li key={l.n} className="rounded-lg border bg-background p-2.5" data-testid="voice-bill-line" data-status={chosen ? "ready" : l.status} data-item={chosen?.itemId ?? ""}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          {chosen ? <span className="truncate">{chosen.name}</span> : <span className="text-muted-foreground">{l.status === "not_found" ? t("pos.voice.notFound") : t("pos.voice.noItem")}</span>}
                          {chosen && sure && <span className={cn(BADGE, "bg-success/15 text-success")}>{t("pos.voice.sure")}</span>}
                          {chosen && !sure && <span className={cn(BADGE, "bg-warning/20 text-foreground")}>{t("pos.voice.check")}</span>}
                          {!chosen && l.status === "choose" && <span className={cn(BADGE, "bg-warning/20 text-foreground")}>{t("pos.voice.choose")}</span>}
                          {!chosen && l.status === "not_found" && <span className={cn(BADGE, "bg-destructive/10 text-destructive")}>{t("pos.voice.notFound")}</span>}
                          {l.source === "ai" && chosen && (
                            <span className={cn(BADGE, "inline-flex items-center gap-1 bg-primary/10 text-primary")}>
                              <SparklesIcon className="size-3" aria-hidden /> {t("pos.voice.ai")}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{t("pos.voice.said", { text: l.raw })}</p>
                      </div>
                      <Button type="button" size="icon-sm" variant="ghost" onClick={() => vb.remove(l.n)} aria-label={t("pos.voice.remove", { name: chosen?.name ?? l.phrase })}>
                        <Trash2Icon />
                      </Button>
                    </div>
                    {chosen && (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Input
                            inputMode="decimal"
                            value={vb.qtys[l.n] ?? String(l.qty)}
                            onChange={(e) => vb.setQty(l.n, e.target.value)}
                            aria-label={t("pos.voice.qty", { name: chosen.name })}
                            className="h-9 w-20 px-2 text-right tabular-nums"
                          />
                          <span className="text-xs text-muted-foreground">
                            {chosen.unit} × {money(chosen.price)}
                          </span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums">{money(Math.round(qty * chosen.price))}</span>
                      </div>
                    )}
                    {l.note !== "none" && l.note !== "amount" && chosen && <p className="mt-1 text-xs text-muted-foreground">{t(`pos.voice.note.${l.note}`)}</p>}
                    {l.note === "amount" && chosen && <p className="mt-1 text-xs text-muted-foreground">{t("pos.voice.amount", { text: l.raw })}</p>}
                    {(l.status !== "matched" || l.confidence === "low" || (l.source === "ai" && l.candidates.length > 1)) && l.candidates.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">{t("pos.voice.pick")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {l.candidates.map((c) => (
                            <button
                              key={c.itemId}
                              type="button"
                              onClick={() => vb.pick(l.n, c.itemId)}
                              aria-pressed={chosen?.itemId === c.itemId}
                              data-testid="voice-bill-candidate"
                              className={cn(
                                "flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                                chosen?.itemId === c.itemId ? "border-primary bg-primary/10 text-primary" : "bg-background hover:border-primary/50",
                              )}
                            >
                              <span className="truncate">{c.name}</span>
                              <span className="tabular-nums opacity-70">{money(c.price)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {!chosen && (
                      <Button type="button" variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" onClick={() => onSearch(l.phrase)}>
                        <SearchIcon /> {t("pos.voice.search", { text: l.phrase })}
                      </Button>
                    )}
                  </li>
                );
              })}
          </ul>
          {r.ignored.length > 0 && <p className="text-xs text-muted-foreground">{t("pos.voice.leftOut", { text: r.ignored.join(", ") })}</p>}
          {r.meta.suspicious && <p className="text-xs text-muted-foreground">{t("pos.voice.suspicious")}</p>}
          {r.meta.ai.used && r.credits > 0 && <p className="text-xs text-muted-foreground">{t("pos.voice.aiCredits", { credits: r.credits })}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={vb.addAll} disabled={vb.ready.length === 0} data-testid="voice-bill-add" className="min-h-11">
              <PlusIcon /> {t("pos.voice.addAll", { count: vb.ready.length })}
            </Button>
            {vb.ready.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{t("pos.voice.total", { amount: money(total) })}</span>}
            {vb.pending > 0 && <span className="text-xs text-muted-foreground">{t("pos.voice.needChoice", { count: vb.pending })}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
