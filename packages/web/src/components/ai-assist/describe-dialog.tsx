"use client";

import * as React from "react";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Textarea, toast } from "@rbms/ui";
import { api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { AiDraftBanner, sendAiFeedback } from "../ai-draft";
import { useAiAssistAllowed } from "./use-assist";

/** What the form knows about the product (the server adds the category name and the shop's policies). */
export interface DescribeFacts {
  name: string;
  brand?: string;
  attributes?: Record<string, string>;
  options?: { name: string; values: string[] }[];
  /** Paise. */
  price?: number;
  unit?: string;
  tags?: string[];
  /** The description as it is now. */
  description?: string;
}

interface Draft {
  title: string;
  description_en: string;
  description_ta: string;
  seo_title: string;
  seo_description: string;
  bullets_en: string[];
  bullets_ta: string[];
}
interface DescribeResponse {
  draft: Draft;
  removed: { sentence: string; kinds: string[]; reason: string }[];
  runId: string;
  credits: number;
}

export interface DescribeApply {
  /** English description as Markdown (paragraph plus bullet list). */
  descriptionEn: string;
  seoTitle: string;
  seoDescription: string;
}

/** English paragraph followed by the key points as a Markdown list. */
export const toMarkdown = (d: Pick<Draft, "description_en" | "bullets_en">, bullets = true) =>
  [d.description_en.trim(), bullets && d.bullets_en.length ? d.bullets_en.map((b) => `- ${b}`).join("\n") : ""].filter(Boolean).join("\n\n");

/**
 * "Write description": EN + TA description, search title and description, key points. Uses only the product's facts and the
 * shop's real policies; sentences promising something the shop never stated are removed on the server and listed here.
 * The owner picks what to keep; the Tamil text is saved with the product's Tamil translation (an approved one).
 */
export function DescribeButton({
  productId,
  getFacts,
  onApply,
  disabled,
  className,
}: {
  /** The saved product (lets the server read its category; also where the Tamil text is saved). */
  productId?: string | null;
  getFacts: () => DescribeFacts;
  onApply: (a: DescribeApply) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const allowed = useAiAssistAllowed("catalogue.manage");
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [res, setRes] = React.useState<DescribeResponse | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [savedTa, setSavedTa] = React.useState(false);
  if (!allowed) return null;

  const write = async () => {
    const f = getFacts();
    if (!f.name.trim()) {
      toast.info(t("web.aiAssist.desc.needName"));
      return;
    }
    setBusy(true);
    setError(null);
    setSavedTa(false);
    try {
      const r = await api.post<DescribeResponse>("/ai/assist/describe", {
        ...(productId ? { productId } : {}),
        product: {
          name: f.name.trim(),
          ...(f.brand ? { brand: f.brand } : {}),
          ...(f.attributes && Object.keys(f.attributes).length ? { attributes: f.attributes } : {}),
          ...(f.options?.length ? { options: f.options } : {}),
          ...(typeof f.price === "number" && f.price > 0 ? { price: f.price } : {}),
          ...(f.unit ? { unit: f.unit } : {}),
          ...(f.tags?.length ? { tags: f.tags } : {}),
          ...(f.description?.trim() ? { existingDescription: f.description.trim().slice(0, 4000) } : {}),
        },
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setRes(r);
      setDraft(r.draft);
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const outcome = (o: "accepted" | "rejected") => {
    if (res?.runId) void sendAiFeedback(res.runId, o).catch(() => undefined);
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const useEnglish = () => {
    if (!draft) return;
    onApply({ descriptionEn: toMarkdown(draft), seoTitle: draft.seo_title, seoDescription: draft.seo_description });
    outcome("accepted");
    toast.success(t("web.aiAssist.desc.applied"));
    setOpen(false);
  };
  const saveTamil = async () => {
    if (!draft || !productId) return;
    setBusy(true);
    try {
      await api.put(`/ai/assist/translations/product/${productId}`, { description: [draft.description_ta.trim(), ...draft.bullets_ta.map((b) => `- ${b}`)].filter(Boolean).join("\n\n") });
      setSavedTa(true);
      outcome("accepted");
      toast.success(t("web.aiAssist.tr.status.approved"));
    } catch (e) {
      toast.error(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };
  const copyTamil = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.description_ta);
      toast.success(t("web.aiAssist.desc.copied"));
    } catch {
      toast.info(draft.description_ta);
    }
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" className={className} disabled={disabled} onClick={() => setOpen(true)}>
        <SparklesIcon /> {t("web.aiAssist.desc.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("web.aiAssist.desc.title")}</DialogTitle>
            <DialogDescription>{t("web.aiAssist.desc.intro")}</DialogDescription>
          </DialogHeader>
          {!draft && (
            <div className="grid gap-2">
              <Label htmlFor="ai-desc-notes">{t("web.aiAssist.desc.notes")}</Label>
              <Textarea id="ai-desc-notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              <p className="text-meta text-muted-foreground">{t("web.aiAssist.desc.notesHint")}</p>
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {draft && res && (
            <div className="grid gap-4">
              <AiDraftBanner runId={res.runId} credits={res.credits} readOnly />
              {res.removed.length > 0 && (
                <Alert>
                  <AlertDescription>{t("web.aiAssist.desc.removed", { list: [...new Set(res.removed.flatMap((r) => r.kinds))].join(", ") })}</AlertDescription>
                </Alert>
              )}
              <Field label={t("web.aiAssist.desc.en")} id="ai-d-en">
                <Textarea id="ai-d-en" rows={4} value={draft.description_en} onChange={(e) => set("description_en", e.target.value)} />
              </Field>
              <Field label={t("web.aiAssist.desc.bullets")} id="ai-d-b">
                <Textarea id="ai-d-b" rows={4} value={draft.bullets_en.join("\n")} onChange={(e) => set("bullets_en", e.target.value.split("\n").filter((x) => x.trim()))} />
              </Field>
              <Field label={t("web.aiAssist.desc.ta")} id="ai-d-ta" lang="ta">
                <Textarea id="ai-d-ta" lang="ta" rows={4} value={draft.description_ta} onChange={(e) => set("description_ta", e.target.value)} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("web.aiAssist.desc.seoTitle")} id="ai-d-st">
                  <Textarea id="ai-d-st" rows={2} maxLength={70} value={draft.seo_title} onChange={(e) => set("seo_title", e.target.value)} />
                </Field>
                <Field label={t("web.aiAssist.desc.seoDescription")} id="ai-d-sd">
                  <Textarea id="ai-d-sd" rows={2} maxLength={160} value={draft.seo_description} onChange={(e) => set("seo_description", e.target.value)} />
                </Field>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            {!draft ? (
              <Button type="button" onClick={() => void write()} disabled={busy}>
                {busy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {t("web.aiAssist.desc.write")}
              </Button>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={() => void write()} disabled={busy}>
                  {t("web.aiAssist.desc.rewrite")}
                </Button>
                {productId ? (
                  <Button type="button" variant="outline" onClick={() => void saveTamil()} disabled={busy || savedTa}>
                    {savedTa ? t("web.aiAssist.tr.status.approved") : t("web.aiAssist.desc.saveTa")}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={() => void copyTamil()}>
                    {t("web.aiAssist.desc.useTa")}
                  </Button>
                )}
                <Button type="button" onClick={useEnglish} disabled={busy}>
                  {t("web.aiAssist.desc.useEn")}
                </Button>
              </>
            )}
            <Button type="button" variant="ghost" onClick={() => { if (draft && !savedTa) outcome("rejected"); setOpen(false); }}>
              {t("web.aiAssist.desc.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, id, lang, children }: { label: string; id: string; lang?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5" lang={lang}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
