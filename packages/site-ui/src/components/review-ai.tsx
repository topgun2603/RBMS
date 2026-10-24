"use client";

import * as React from "react";
import { BarChart3Icon, Loader2Icon, SparklesIcon } from "lucide-react";
import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Textarea, toast } from "@srirealtime/ui";
import { AiDraftBanner, api, describeError, useI18n } from "@srirealtime/web";
import { useMutation } from "@tanstack/react-query";
import { useCan } from "../lib/access";

interface ReplyDraft {
  reply: string;
  language: "en" | "ta";
  removed: { sentence: string; reason: string }[];
  templated: boolean;
  runId: string;
  credits: number;
}

/** "Draft reply with AI" for one review: fills the reply box with an editable draft. Nothing is posted. */
export function DraftReplyControls({ reviewId, onDraft }: { reviewId: string; onDraft: (text: string) => void }) {
  const { t } = useI18n();
  const canAi = useCan("ai.use");
  const [note, setNote] = React.useState("");
  const [result, setResult] = React.useState<ReplyDraft | null>(null);
  const m = useMutation({ mutationFn: () => api.post<ReplyDraft>(`/ai/insights/reviews/${reviewId}/reply`, { note: note.trim() || undefined }) });
  if (!canAi) return null;
  const draft = async () => {
    try {
      const r = await m.mutateAsync();
      setResult(r);
      onDraft(r.reply);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <div className="grid gap-2" data-testid="review-ai">
      <Textarea rows={2} maxLength={500} value={note} placeholder={t("site.reviews.ai.note")} aria-label={t("site.reviews.ai.note")} onChange={(e) => setNote(e.target.value)} />
      <p className="text-meta text-muted-foreground">{t("site.reviews.ai.noteHint")}</p>
      <div>
        <Button type="button" size="sm" variant="outline" disabled={m.isPending} onClick={() => void draft()}>
          {m.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          {m.isPending ? t("site.reviews.ai.drafting") : t("site.reviews.ai.draft")}
        </Button>
      </div>
      {result && (
        <>
          <AiDraftBanner runId={result.runId} credits={result.credits} />
          {result.removed.length > 0 && <p className="text-meta text-muted-foreground">{t("site.reviews.ai.removed", { n: result.removed.length })}</p>}
          {result.templated && <p className="text-meta text-muted-foreground">{t("site.reviews.ai.templated")}</p>}
        </>
      )}
    </div>
  );
}

interface Themes {
  themes: {
    days: number;
    reviews: number;
    avgRating: number | null;
    topPraises: { id: string; label: string; labelTa: string; praise: number }[];
    topComplaints: { id: string; label: string; labelTa: string; complaint: number }[];
  };
  summary: string;
  source: string;
  runId: string | null;
  credits: number;
}

/** "Review themes": counts of what customers praise and complain about over 90 days, worded by AI. */
export function ReviewThemesButton() {
  const { t, locale } = useI18n();
  const canAi = useCan("ai.use");
  const [open, setOpen] = React.useState(false);
  const m = useMutation({ mutationFn: () => api.post<Themes>("/ai/insights/reviews/themes", { days: 90, lang: locale === "ta" ? "ta" : "en" }) });
  if (!canAi) return null;
  const load = async () => {
    try {
      await m.mutateAsync();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const d = m.data;
  const lab = (c: { label: string; labelTa: string }) => (locale === "ta" ? c.labelTa : c.label);
  return (
    <>
      <Button
        size="lg"
        variant="outline"
        onClick={() => {
          setOpen(true);
          if (!m.data && !m.isPending) void load();
        }}
      >
        <BarChart3Icon /> {t("site.reviews.ai.themes")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" closeLabel={t("site.common.cancel")} className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>{t("site.reviews.ai.themesTitle")}</SheetTitle>
            <SheetDescription>{t("site.reviews.ai.themesHint", { days: 90 })}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 p-4" data-testid="review-themes">
            {m.isPending && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> {t("site.reviews.ai.drafting")}
              </p>
            )}
            {d && (
              <>
                {d.themes.reviews === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("site.reviews.ai.none")}</p>
                ) : (
                  <p className="text-meta text-muted-foreground">{t("site.reviews.ai.avg", { n: d.themes.reviews, avg: String(d.themes.avgRating) })}</p>
                )}
                <p className="text-sm">{d.summary}</p>
                {d.themes.topPraises.length > 0 && (
                  <div>
                    <p className="font-medium">{t("site.reviews.ai.praised")}</p>
                    <ul className="list-disc pl-5 text-sm">
                      {d.themes.topPraises.map((c) => (
                        <li key={c.id}>
                          {lab(c)} · {t("site.reviews.ai.mentions", { n: c.praise })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {d.themes.topComplaints.length > 0 && (
                  <div>
                    <p className="font-medium">{t("site.reviews.ai.complained")}</p>
                    <ul className="list-disc pl-5 text-sm">
                      {d.themes.topComplaints.map((c) => (
                        <li key={c.id}>
                          {lab(c)} · {t("site.reviews.ai.mentions", { n: c.complaint })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
