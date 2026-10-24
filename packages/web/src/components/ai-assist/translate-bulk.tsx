"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, LanguagesIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Textarea, toast } from "@srirealtime/ui";
import { api } from "../../lib/api";
import { describeError, useI18n } from "../../lib/i18n";
import { useAiAssistAllowed } from "./use-assist";

type TStatus = "queued" | "draft" | "failed" | "approved" | "rejected";
interface TranslationRow {
  id: string;
  productId: string;
  batchId: string;
  status: TStatus;
  sourceName: string;
  sourceDescription: string | null;
  name: string | null;
  description: string | null;
  removed: { sentence: string; kinds: string[] }[];
  error: string | null;
}
interface Estimate {
  count: number;
  credits: number;
  perProduct: number;
  remaining: number | null;
  enough: boolean;
}

const KEY = ["ai", "assist", "translations"] as const;

function useTranslations(open: boolean) {
  return useQuery<{ items: TranslationRow[] }>({
    queryKey: KEY,
    queryFn: () => api.get("/ai/assist/translations", { limit: 200 }),
    // Poll while anything is still being drafted.
    refetchInterval: (q) => (open && q.state.data?.items.some((r) => r.status === "queued") ? 3000 : false),
    enabled: open,
  });
}

/**
 * Bulk "Translate to Tamil": shows the credit estimate first, starts the background job, then the owner reviews the drafts
 * and approves each one (draft-and-confirm). Place `<TranslateToTamilButton ids=.../>` in the bulk-action bar of the product
 * list and `<TamilReviewButton/>` next to the page actions.
 */
export function TranslateToTamilButton({ ids, onStarted }: { ids: string[]; onStarted?: () => void }) {
  const { t } = useI18n();
  const allowed = useAiAssistAllowed("catalogue.manage");
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [est, setEst] = React.useState<Estimate | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [review, setReview] = React.useState(false);
  const start = useMutation({
    mutationFn: () => api.post<{ batchId: string }>("/ai/assist/translate", { productIds: ids }),
    onSuccess: async () => {
      toast.success(t("web.aiAssist.tr.started"));
      await qc.invalidateQueries({ queryKey: KEY });
      setOpen(false);
      setReview(true);
    },
    onError: (e) => setError(describeError(e, t)),
  });
  if (!allowed) return null;

  const openDialog = async () => {
    setOpen(true);
    setEst(null);
    setError(null);
    try {
      setEst(await api.post<Estimate>("/ai/assist/translate/estimate", { productIds: ids }));
    } catch (e) {
      setError(describeError(e, t));
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => void openDialog()}>
        <LanguagesIcon /> <span className="hidden sm:inline">{t("web.aiAssist.tr.button")}</span>
      </Button>
      <Dialog open={open} onOpenChange={(o) => !start.isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("web.aiAssist.tr.title")}</DialogTitle>
            <DialogDescription>{t("web.aiAssist.tr.intro", { count: ids.length })}</DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!est && !error && <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />}
          {est && (
            <div className="grid gap-2 text-sm">
              <p>
                {est.remaining === null
                  ? t("web.aiAssist.tr.estimateUnlimited", { credits: est.credits, per: est.perProduct })
                  : t("web.aiAssist.tr.estimate", { credits: est.credits, per: est.perProduct, remaining: est.remaining })}
              </p>
              {!est.enough && <p className="font-medium text-destructive">{t("web.aiAssist.tr.notEnough")}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={start.isPending}>
              {t("web.common.cancel")}
            </Button>
            <Button onClick={() => start.mutate()} disabled={!est || !est.enough || start.isPending}>
              {start.isPending ? <Loader2Icon className="animate-spin" /> : <LanguagesIcon />} {t("web.aiAssist.tr.start")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TamilReviewDialog
        open={review}
        onOpenChange={(o) => {
          setReview(o);
          // Clearing the selection removes this button, so do it only after the review is closed.
          if (!o) onStarted?.();
        }}
      />
    </>
  );
}

/** "Review Tamil drafts" with the number waiting. */
export function TamilReviewButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const allowed = useAiAssistAllowed("catalogue.manage");
  const [open, setOpen] = React.useState(false);
  const q = useQuery<{ items: TranslationRow[] }>({
    queryKey: KEY,
    queryFn: () => api.get("/ai/assist/translations", { limit: 200 }),
    enabled: allowed,
    staleTime: 30_000,
    retry: false,
  });
  const waiting = q.data?.items.filter((r) => r.status === "draft" || r.status === "queued").length ?? 0;
  if (!allowed || (q.isSuccess && q.data.items.length === 0)) return null;
  return (
    <>
      <Button variant="outline" size="lg" className={className} onClick={() => setOpen(true)}>
        <LanguagesIcon /> {t("web.aiAssist.tr.review")}
        {waiting > 0 && <Badge variant="secondary">{waiting}</Badge>}
      </Button>
      <TamilReviewDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function TamilReviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useTranslations(open);
  const rows = (q.data?.items ?? []).filter((r) => r.status !== "approved" && r.status !== "rejected");
  const batchIds = [...new Set(rows.filter((r) => r.status === "draft").map((r) => r.batchId))];
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const approveAll = useMutation({
    mutationFn: async () => {
      let n = 0;
      for (const b of batchIds) n += (await api.post<{ approved: number }>(`/ai/assist/translations/batches/${b}/approve`, {})).approved;
      return n;
    },
    onSuccess: async (n) => {
      toast.success(t("web.aiAssist.tr.approvedN", { n }));
      await refresh();
    },
    onError: (e) => toast.error(describeError(e, t)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("web.aiAssist.tr.review")}</DialogTitle>
          <DialogDescription>{t("web.aiAssist.tr.reviewHint")}</DialogDescription>
        </DialogHeader>
        {q.isError && (
          <Alert variant="destructive">
            <AlertDescription>{describeError(q.error, t)}</AlertDescription>
          </Alert>
        )}
        {q.isPending && <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />}
        {q.isSuccess && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("web.aiAssist.tr.empty")}</p>}
        <ul className="grid gap-3">
          {rows.map((r) => (
            <ReviewRow key={r.id + r.status} row={r} onChanged={refresh} />
          ))}
        </ul>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => void refresh()}>
            {t("web.aiAssist.tr.refresh")}
          </Button>
          <Button onClick={() => approveAll.mutate()} disabled={batchIds.length === 0 || approveAll.isPending}>
            {approveAll.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} {t("web.aiAssist.tr.approveAll")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({ row, onChanged }: { row: TranslationRow; onChanged: () => unknown }) {
  const { t } = useI18n();
  const [name, setName] = React.useState(row.name ?? "");
  const [desc, setDesc] = React.useState(row.description ?? "");
  const act = useMutation({
    mutationFn: (kind: "approve" | "reject") =>
      api.post(`/ai/assist/translations/${row.id}/${kind}`, kind === "approve" ? { name: name.trim(), description: desc.trim() || null } : {}),
    onSuccess: () => onChanged(),
    onError: (e) => toast.error(describeError(e, t)),
  });
  return (
    <li className="grid gap-2 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-medium">{row.sourceName}</p>
        <Badge variant={row.status === "failed" ? "destructive" : "secondary"}>{t(`web.aiAssist.tr.status.${row.status}`)}</Badge>
      </div>
      {row.sourceDescription && <p className="line-clamp-2 text-xs text-muted-foreground">{row.sourceDescription}</p>}
      {row.status === "queued" && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label={t("web.aiAssist.tr.status.queued")} />}
      {row.status === "failed" && <p className="text-sm text-destructive">{t("web.aiAssist.tr.failedWhy", { code: row.error ?? "error" })}</p>}
      {row.status === "draft" && (
        <>
          <label className="grid gap-1 text-xs font-medium" lang="ta">
            {t("web.aiAssist.tr.nameTa")}
            <Input lang="ta" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-medium" lang="ta">
            {t("web.aiAssist.tr.descTa")}
            <Textarea lang="ta" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>
          {row.removed.length > 0 && <p className="text-meta text-muted-foreground">{t("web.aiAssist.tr.removed", { list: [...new Set(row.removed.flatMap((x) => x.kinds))].join(", ") })}</p>}
        </>
      )}
      {(row.status === "draft" || row.status === "failed") && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => act.mutate("reject")} disabled={act.isPending}>
            <XIcon /> {t("web.aiAssist.tr.reject")}
          </Button>
          {row.status === "draft" && (
            <Button size="sm" onClick={() => act.mutate("approve")} disabled={act.isPending || !name.trim()}>
              <CheckIcon /> {t("web.aiAssist.tr.approve")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
