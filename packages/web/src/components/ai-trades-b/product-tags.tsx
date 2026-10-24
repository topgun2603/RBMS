"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, TagsIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, Badge, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, toast } from "@srirealtime/ui";
import { useI18n } from "../../lib/i18n";
import { getB, postB, useBError, useBHelper } from "./shared";

type Field = "colour" | "fabric" | "pattern" | "occasion" | "work" | "sleeve" | "neck";
interface Plan {
  field: Field;
  attribute: string;
  values: string[];
  confidence: "low" | "medium" | "high";
  conflict: string | null;
  noop: boolean;
}
interface Proposal {
  garment: string | null;
  fields: Partial<Record<Field, { values: string[]; confidence: "low" | "medium" | "high"; inList?: boolean[]; seen?: (string | null)[] }>>;
  ignoredInstructions: boolean;
}
interface TagRow {
  id: string;
  productId: string;
  batchId: string;
  status: "queued" | "draft" | "failed" | "approved" | "rejected";
  sourceName: string;
  imageUrl: string | null;
  proposal: Proposal | null;
  plan: Plan[];
  error: string | null;
}
interface Estimate {
  count: number;
  withoutPhoto: number;
  credits: number;
  perProduct: number;
  remaining: number | null;
  enough: boolean;
}
const KEY = ["ai", "trade", "product-tags"] as const;
const FIELD_ORDER: Field[] = ["colour", "fabric", "pattern", "occasion", "work", "sleeve", "neck"];

/** Is this a clothing / textile shop, and how many drafts wait. Only these shops get photo tagging. */
export function useTagStatus(enabled: boolean) {
  return useQuery({ queryKey: [...KEY, "status"], queryFn: () => getB<{ eligible: boolean; waiting: number }>("product-tags/status"), enabled, staleTime: 30_000, retry: false });
}

function useTagRows(open: boolean) {
  return useQuery<{ items: TagRow[] }>({
    queryKey: [...KEY, "list"],
    queryFn: () => getB("product-tags", { limit: 200 }),
    refetchInterval: (q) => (open && q.state.data?.items.some((r) => r.status === "queued") ? 3000 : false),
    enabled: open,
  });
}

/**
 * "Tag photos with AI" for the selected products of a clothing shop: shows the credit estimate, starts the background job, then
 * opens the review where the owner approves each product (draft-and-confirm, like the Tamil translations).
 */
export function TagPhotosButton({ ids, onStarted }: { ids: string[]; onStarted?: () => void }) {
  const { t } = useI18n();
  const { show } = useBHelper("product-tags", "catalogue.manage");
  const status = useTagStatus(show);
  const errText = useBError();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [est, setEst] = React.useState<Estimate | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [review, setReview] = React.useState(false);
  const start = useMutation({
    mutationFn: () => postB<{ batchId: string }>("product-tags", { productIds: ids }),
    onSuccess: async () => {
      toast.success(t("web.aiB.tags.started"));
      await qc.invalidateQueries({ queryKey: KEY });
      setOpen(false);
      setReview(true);
    },
    onError: (e) => setError(errText(e)),
  });
  if (!show || !status.data?.eligible) return null;

  const openDialog = async () => {
    setOpen(true);
    setEst(null);
    setError(null);
    try {
      setEst(await postB<Estimate>("product-tags/estimate", { productIds: ids }));
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => void openDialog()}>
        <TagsIcon /> <span className="hidden sm:inline">{t("web.aiB.tags.button")}</span>
      </Button>
      <Dialog open={open} onOpenChange={(o) => !start.isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("web.aiB.tags.title")}</DialogTitle>
            <DialogDescription>{t("web.aiB.tags.intro", { count: ids.length })}</DialogDescription>
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
                  ? t("web.aiB.tags.estimateUnlimited", { credits: est.credits, count: est.count })
                  : t("web.aiB.tags.estimate", { credits: est.credits, count: est.count, remaining: est.remaining })}
              </p>
              {est.withoutPhoto > 0 && <p className="text-muted-foreground">{t("web.aiB.tags.withoutPhoto", { count: est.withoutPhoto })}</p>}
              {!est.enough && <p className="font-medium text-destructive">{t("web.aiB.photos.notEnough")}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={start.isPending}>
              {t("web.common.cancel")}
            </Button>
            <Button onClick={() => start.mutate()} disabled={!est || !est.enough || est.count === 0 || start.isPending}>
              {start.isPending ? <Loader2Icon className="animate-spin" /> : <TagsIcon />} {t("web.aiB.tags.start")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TagReviewDialog
        open={review}
        onOpenChange={(o) => {
          setReview(o);
          if (!o) onStarted?.();
        }}
      />
    </>
  );
}

/** "Review photo tags" with the number waiting. */
export function TagReviewButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const { show } = useBHelper("product-tags", "catalogue.manage");
  const status = useTagStatus(show);
  const [open, setOpen] = React.useState(false);
  if (!show || !status.data?.eligible) return null;
  const waiting = status.data.waiting;
  return (
    <>
      <Button variant="outline" size="lg" className={className} onClick={() => setOpen(true)}>
        <TagsIcon /> {t("web.aiB.tags.review")}
        {waiting > 0 && <Badge variant="secondary">{waiting}</Badge>}
      </Button>
      <TagReviewDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function TagReviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const errText = useBError();
  const q = useTagRows(open);
  const rows = (q.data?.items ?? []).filter((r) => r.status !== "approved" && r.status !== "rejected");
  const batchIds = [...new Set(rows.filter((r) => r.status === "draft").map((r) => r.batchId))];
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const approveAll = useMutation({
    mutationFn: async () => {
      let n = 0;
      let skipped = 0;
      for (const b of batchIds) {
        const r = await postB<{ approved: number; skippedFields: number }>(`product-tags/batches/${b}/approve`, {});
        n += r.approved;
        skipped += r.skippedFields;
      }
      return { n, skipped };
    },
    onSuccess: async (r) => {
      toast.success(t("web.aiB.tags.approvedN", { n: r.n }));
      if (r.skipped) toast.info(t("web.aiB.tags.skippedN", { n: r.skipped }));
      await qc.invalidateQueries();
    },
    onError: (e) => toast.error(errText(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("web.aiB.tags.review")}</DialogTitle>
          <DialogDescription>{t("web.aiB.tags.reviewHint")}</DialogDescription>
        </DialogHeader>
        {q.isError && (
          <Alert variant="destructive">
            <AlertDescription>{errText(q.error)}</AlertDescription>
          </Alert>
        )}
        {q.isPending && <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />}
        {q.isSuccess && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("web.aiB.tags.empty")}</p>}
        <ul className="grid gap-3">
          {rows.map((r) => (
            <TagRowCard key={r.id + r.status} row={r} onChanged={refresh} />
          ))}
        </ul>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => void refresh()}>
            {t("web.aiB.tags.refresh")}
          </Button>
          <Button onClick={() => approveAll.mutate()} disabled={batchIds.length === 0 || approveAll.isPending}>
            {approveAll.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} {t("web.aiB.tags.approveAll")}
          </Button>
        </DialogFooter>
        <p className="text-meta text-muted-foreground">{t("web.aiB.tags.approveAllNote")}</p>
      </DialogContent>
    </Dialog>
  );
}

function TagRowCard({ row, onChanged }: { row: TagRow; onChanged: () => unknown }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const errText = useBError();
  const plan = row.plan.filter((p) => !p.noop);
  const [on, setOn] = React.useState<Record<string, boolean>>(() => Object.fromEntries(plan.map((p) => [p.field, !p.conflict])));
  const [replace, setReplace] = React.useState<Record<string, boolean>>({});
  const [vals, setVals] = React.useState<Record<string, string>>(() => Object.fromEntries(plan.map((p) => [p.field, p.values.join(", ")])));
  const act = useMutation({
    mutationFn: (kind: "approve" | "reject") => {
      if (kind === "reject") return postB(`product-tags/${row.id}/reject`, {});
      const choices: Record<string, { values?: string[]; replace?: boolean; skip?: boolean }> = {};
      for (const p of plan) {
        if (!on[p.field]) continue;
        choices[p.field] = { values: (vals[p.field] ?? "").split(",").map((x) => x.trim()).filter(Boolean), replace: p.conflict ? replace[p.field] === true : false };
      }
      return postB(`product-tags/${row.id}/approve`, { choices });
    },
    onSuccess: async (_r, kind) => {
      if (kind === "approve") {
        toast.success(t("web.aiB.tags.approved", { name: row.sourceName }));
        await qc.invalidateQueries();
      }
      await onChanged();
    },
    onError: (e) => toast.error(errText(e)),
  });
  const anyOn = plan.some((p) => on[p.field]);
  return (
    <li className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[96px_1fr]" data-testid="ai-b-tag-row">
      {row.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.imageUrl} alt={row.sourceName} className="h-28 w-24 rounded-lg object-cover ring-1 ring-border" />
      ) : (
        <div className="h-28 w-24 rounded-lg bg-muted" />
      )}
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm font-medium">{row.sourceName}</p>
          <Badge variant={row.status === "failed" ? "destructive" : "secondary"}>{t(`web.aiB.tags.status.${row.status}`)}</Badge>
        </div>
        {row.status === "queued" && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label={t("web.aiB.tags.status.queued")} />}
        {row.status === "failed" && <p className="text-sm text-destructive">{t("web.aiB.tags.failedWhy", { code: row.error ?? "error" })}</p>}
        {row.status === "draft" && plan.length === 0 && <p className="text-sm text-muted-foreground">{t("web.aiB.tags.nothingNew")}</p>}
        {row.status === "draft" &&
          FIELD_ORDER.flatMap((f) => plan.filter((p) => p.field === f)).map((p) => (
            <div key={p.field} className="grid gap-1 rounded-lg bg-muted/40 p-2">
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <Checkbox checked={on[p.field] === true} onCheckedChange={(v) => setOn((s) => ({ ...s, [p.field]: v === true }))} />
                <span className="font-medium">{t(`web.aiB.tags.field.${p.field}`)}</span>
                <Badge variant={p.confidence === "low" ? "destructive" : "outline"}>{t(`web.aiB.conf.${p.confidence}`)}</Badge>
                <Input
                  className="h-8 min-w-0 flex-1 basis-40"
                  value={vals[p.field] ?? ""}
                  onChange={(e) => setVals((s) => ({ ...s, [p.field]: e.target.value }))}
                  aria-label={t(`web.aiB.tags.field.${p.field}`)}
                />
              </label>
              {p.conflict && (
                <label className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <Checkbox checked={replace[p.field] === true} onCheckedChange={(v) => { setReplace((s) => ({ ...s, [p.field]: v === true })); if (v === true) setOn((s) => ({ ...s, [p.field]: true })); }} />
                  {t("web.aiB.tags.conflict", { value: p.conflict })}
                </label>
              )}
            </div>
          ))}
        {row.proposal?.ignoredInstructions && <p className="text-meta text-destructive">{t("web.aiB.tags.ignored")}</p>}
        {(row.status === "draft" || row.status === "failed") && (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => act.mutate("reject")} disabled={act.isPending}>
              <XIcon /> {t("web.aiB.tags.reject")}
            </Button>
            {row.status === "draft" && (
              <Button size="sm" onClick={() => act.mutate("approve")} disabled={act.isPending || !anyOn}>
                <CheckIcon /> {t("web.aiB.tags.approve")}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
