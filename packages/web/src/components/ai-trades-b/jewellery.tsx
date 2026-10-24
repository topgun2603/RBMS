"use client";

import * as React from "react";
import { CopyIcon, Loader2Icon, MessageCircleIcon, PrinterIcon, ReceiptTextIcon, ScanTextIcon } from "lucide-react";
import { Alert, AlertDescription, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, toast } from "@srirealtime/ui";
import { ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { AiDraftBanner, sendAiFeedback } from "../ai-draft";
import { PhotoPicker, postB, rupeesText, useBError, useBHelper, type Photo } from "./shared";

// ------------------------------------------------------------------ HUID from a hallmark photo

interface HuidResult {
  draft: {
    huid: string | null;
    rawHuid: string | null;
    purityMark: string | null;
    purity: { metal: string; purity: string } | null;
    bisLogo: boolean;
    centreMark: string | null;
    jewellerMark: string | null;
    confidence: "low" | "medium" | "high";
    flags: string[];
  };
  runId: string;
  credits: number;
}

/**
 * "Read HUID from photo" for the piece form. The model reads the stamped 6-character HUID and purity mark; the software checks
 * the format. The result only fills the HUID box as a draft. It is never "verified": the jeweller checks it on the BIS CARE app.
 */
export function HuidPhotoButton({ pieceId, onApply, className }: { pieceId?: string; onApply: (huid: string) => void; className?: string }) {
  const { t } = useI18n();
  const { show } = useBHelper("jewellery-huid", "jewellery.manage");
  const errText = useBError();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<HuidResult | null>(null);
  const [huid, setHuid] = React.useState("");
  if (!show) return null;

  const read = async ([photo]: Photo[]) => {
    if (!photo) return;
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      const r = await postB<HuidResult>("jewellery/huid", { image: { mediaType: photo.mediaType, data: photo.data }, ...(pieceId ? { pieceId } : {}) });
      setRes(r);
      setHuid(r.draft.huid ?? "");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const valid = /^[A-Z0-9]{6}$/.test(huid);
  const flags = res?.draft.flags ?? [];
  return (
    <>
      <Button type="button" size="sm" variant="outline" className={className} onClick={() => { setOpen(true); setRes(null); setError(null); }}>
        <ScanTextIcon /> {t("web.aiB.huid.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("web.aiB.huid.title")}</DialogTitle>
            <DialogDescription>{t("web.aiB.huid.intro")}</DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!res && (
            <div className="grid gap-2">
              <PhotoPicker label={busy ? t("web.aiB.reading") : t("web.aiB.choosePhoto")} busy={busy} onPhotos={(p) => void read(p)} onError={setError} testId="ai-b-huid-input" />
              <p className="text-meta text-muted-foreground">{t("web.aiB.huid.credits")}</p>
            </div>
          )}
          {res && (
            <div className="grid gap-3">
              <AiDraftBanner runId={res.runId} credits={res.credits} readOnly />
              <label className="grid gap-1 text-sm font-medium">
                {t("web.aiB.huid.field")}
                <Input value={huid} maxLength={6} onChange={(e) => setHuid(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} className="font-mono text-lg tracking-widest" aria-invalid={!valid} data-testid="ai-b-huid-value" />
              </label>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="outline">{t("web.aiB.huid.confidence", { level: t(`web.aiB.conf.${res.draft.confidence}`) })}</Badge>
                {res.draft.purityMark && <Badge variant="secondary">{t("web.aiB.huid.purity", { mark: res.draft.purityMark })}</Badge>}
                <Badge variant="secondary">{res.draft.bisLogo ? t("web.aiB.huid.logoSeen") : t("web.aiB.huid.logoNotSeen")}</Badge>
              </div>
              {flags.filter((f) => f !== "no_bis_logo").map((f) => (
                <Alert key={f} variant={f === "taken" || f === "purity_mismatch" || f === "huid_format" ? "destructive" : "default"}>
                  <AlertDescription>{t(`web.aiB.huid.flag.${f}`)}</AlertDescription>
                </Alert>
              ))}
              {!valid && <p className="text-sm text-destructive">{t("web.aiB.huid.format")}</p>}
              <p className="rounded-lg bg-muted/50 p-2 text-meta text-muted-foreground">{t("web.aiB.huid.notVerified")}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t("web.common.cancel")}
            </Button>
            {res && (
              <>
                <Button variant="outline" onClick={() => { setRes(null); setHuid(""); }}>
                  {t("web.aiB.huid.again")}
                </Button>
                <Button
                  disabled={!valid}
                  onClick={() => {
                    onApply(huid);
                    void sendAiFeedback(res.runId, huid === res.draft.huid ? "accepted" : "edited").catch(() => undefined);
                    toast.success(t("web.aiB.huid.applied"));
                    setOpen(false);
                  }}
                >
                  {t("web.aiB.huid.use")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ------------------------------------------------------------------ price breakup

interface BreakupResult {
  breakup: { name: string; lines: { key: string; amount: number; detail: string }[]; total: number; gstRate: number; gst: number; totalWithGst: number };
  text: { en: string; ta: string };
  source: "ai" | "template";
  fallback: string | null;
  runId: string | null;
  credits: number;
  shop: string | null;
  share: { en: string; ta: string };
  facts: { name: string; huid: string | null; rateDate: string | null };
}

/**
 * "Price breakup for the customer": today's rate x net weight + wastage + making + stones + GST, all worked out by the jewellery
 * module, with a friendly English / Tamil explanation (AI words, number-checked; a plain template when AI is off). Print, copy
 * or share on WhatsApp. No price predictions.
 */
export function PriceBreakupButton({ pieceId, className, size = "sm" }: { pieceId: string; className?: string; size?: "sm" | "default" }) {
  const { t, locale } = useI18n();
  const { show } = useBHelper("jewellery-breakup", ["jewellery.rates", "jewellery.manage", "jewellery.exchange"]);
  const errText = useBError();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<BreakupResult | null>(null);
  const [offNote, setOffNote] = React.useState<string | null>(null);
  const [lang, setLang] = React.useState<"en" | "ta">(locale === "ta" ? "ta" : "en");
  if (!show) return null;

  const load = async (words: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setRes(await postB<BreakupResult>("jewellery/breakup", { pieceId, words }));
      setOffNote(null);
    } catch (e) {
      // AI switched off, out of credits or not in the plan: the numbers do not need AI, so show them with plain wording.
      if (words && e instanceof ApiError && ["ai_off", "ai_feature_off", "ai_credits_exhausted", "ai_not_available", "ai_disabled", "ai_unavailable"].includes(e.code ?? "")) {
        try {
          setRes(await postB<BreakupResult>("jewellery/breakup", { pieceId, words: false }));
          setOffNote(errText(e));
          return;
        } catch (e2) {
          setError(errText(e2));
          return;
        }
      }
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const text = res ? res.share[lang] : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("web.aiB.breakup.copied"));
    } catch {
      toast.error(t("web.aiB.breakup.copyFailed"));
    }
  };
  const print = () => {
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(res?.facts.name ?? "")}</title><body style="font:16px sans-serif;padding:24px;white-space:pre-wrap">${esc(text.replace(/\*/g, ""))}</body>`);
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <>
      <Button type="button" size={size} variant="outline" className={className} onClick={() => { setOpen(true); setRes(null); void load(true); }}>
        <ReceiptTextIcon /> {t("web.aiB.breakup.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("web.aiB.breakup.title")}</DialogTitle>
            <DialogDescription>{res ? res.breakup.name : t("web.aiB.breakup.intro")}</DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {busy && !res && <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />}
          {res && (
            <div className="grid gap-3">
              {res.source === "ai" ? <AiDraftBanner runId={res.runId ?? undefined} credits={res.credits} readOnly /> : <p className="text-meta text-muted-foreground">{offNote ?? t("web.aiB.breakup.template")}</p>}
              <table className="w-full text-sm" data-testid="ai-b-breakup-table">
                <tbody>
                  {res.breakup.lines.map((l) => (
                    <tr key={l.key} className="border-b last:border-0">
                      <td className="py-1.5 pr-2">
                        <div className="font-medium">{t(`web.aiB.breakup.line.${l.key}`, { rate: res.breakup.gstRate })}</div>
                        <div className="text-meta text-muted-foreground">{l.detail}</div>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{rupeesText(l.amount)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="pt-2">{t("web.aiB.breakup.total")}</td>
                    <td className="pt-2 text-right tabular-nums" data-testid="ai-b-breakup-total">{rupeesText(res.breakup.totalWithGst)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="flex gap-2" role="group" aria-label={t("web.aiB.breakup.language")}>
                <Button size="sm" variant={lang === "en" ? "default" : "outline"} onClick={() => setLang("en")}>English</Button>
                <Button size="sm" variant={lang === "ta" ? "default" : "outline"} onClick={() => setLang("ta")}>தமிழ்</Button>
              </div>
              <p className="rounded-lg bg-muted/40 p-3 text-sm" lang={lang} data-testid="ai-b-breakup-words">{res.text[lang]}</p>
              <p className="text-meta text-muted-foreground">{t("web.aiB.breakup.note", { date: res.facts.rateDate ?? "-" })}</p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            {res && (
              <>
                <Button variant="outline" onClick={() => void copy()}>
                  <CopyIcon /> {t("web.aiB.breakup.copy")}
                </Button>
                <Button variant="outline" onClick={print}>
                  <PrinterIcon /> {t("web.aiB.breakup.print")}
                </Button>
                <Button asChild>
                  <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
                    <MessageCircleIcon /> {t("web.aiB.breakup.whatsapp")}
                  </a>
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
