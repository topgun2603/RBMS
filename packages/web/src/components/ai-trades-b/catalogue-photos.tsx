"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraIcon, CheckIcon, Loader2Icon, MergeIcon, XIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@srirealtime/ui";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { getB, fromPaise, PhotoPicker, postB, toPaise, useBError, useBHelper, type Photo } from "./shared";

/** What the API drafts for one product (packages/ai trades/catalogue/photos.ts `ProductDraft`). */
interface Draft {
  key: string;
  name: string;
  brand: string | null;
  size: string | null;
  unit: string;
  mrp: number | null;
  price: number | null;
  priceKind: "mrp" | "rate" | null;
  barcode: string | null;
  categoryId: string | null;
  confidence: "low" | "medium" | "high";
  photos: number[];
  hsn: { hsn: string; description: string; gstRate: number; confidence: string } | null;
  existing: { id: string; name: string; match: "barcode" | "name" | "similar" } | null;
  flags: string[];
}
interface Batch {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
  credits: number;
  drafts: Draft[];
  problems: { photo: number; code: string }[];
  error: string | null;
}
interface Estimate {
  count: number;
  credits: number;
  perPhoto: number;
  remaining: number | null;
  enough: boolean;
}
/** One editable row of the review grid. */
interface Row {
  key: string;
  include: boolean;
  name: string;
  brand: string;
  unit: string;
  price: string;
  mrp: string;
  inclusive: boolean;
  barcode: string;
  hsn: string;
  gst: string;
  categoryId: string;
  confidence: Draft["confidence"];
  photos: number[];
  existing: Draft["existing"];
  hsnNote: string | null;
  flags: string[];
}

const UNITS = ["pcs", "kg", "g", "l", "ml", "m", "box", "pack"];
const GST_CHOICES = [0, 5, 12, 18, 28];
const NO_CAT = "none";
const PROBLEM_CODES = ["ignored_instructions", "ai_unreadable_image", "ai_failed", "ai_off", "ai_feature_off", "ai_credits_exhausted", "ai_disabled", "ai_unavailable", "ai_not_available"];

const toRow = (d: Draft): Row => ({
  key: d.key,
  include: !d.existing && !d.flags.includes("injection"),
  name: d.name,
  brand: d.brand ?? "",
  unit: d.unit,
  price: fromPaise(d.price),
  mrp: fromPaise(d.mrp),
  inclusive: d.priceKind === "mrp",
  barcode: d.barcode ?? "",
  hsn: d.hsn?.hsn ?? "",
  gst: d.hsn ? String(d.hsn.gstRate) : "",
  categoryId: d.categoryId ?? "",
  confidence: d.confidence,
  photos: d.photos,
  existing: d.existing,
  hsnNote: d.hsn?.description ?? null,
  flags: d.flags,
});

/** The problems of one row that stop it being created. */
export function rowProblems(r: Row): string[] {
  const out: string[] = [];
  if (r.name.trim().length < 2) out.push("name");
  if (toPaise(r.price) === null) out.push("price");
  if (r.gst === "" || !Number.isFinite(Number(r.gst))) out.push("gst");
  if (r.hsn && !/^[0-9]{2,8}$/.test(r.hsn)) out.push("hsn");
  return out;
}

/** The body of the normal catalogue create route for a confirmed row. */
export function productBody(r: Row) {
  const price = toPaise(r.price) ?? 0;
  const mrp = toPaise(r.mrp);
  return {
    name: r.name.trim(),
    ...(r.brand.trim() ? { brand: r.brand.trim() } : {}),
    ...(r.categoryId ? { categoryId: r.categoryId } : {}),
    ...(r.hsn ? { hsn: r.hsn } : {}),
    gstRate: Number(r.gst),
    unit: r.unit,
    taxInclusive: r.inclusive,
    price,
    ...(mrp !== null && mrp >= price ? { mrp } : {}),
    ...(r.barcode.trim() ? { barcode: r.barcode.trim() } : {}),
  };
}

/** Folds row `from` into row `into`: keeps `into`'s values and fills what it lacks. */
export function mergeRows(rows: Row[], from: string, into: string): Row[] {
  const a = rows.find((r) => r.key === from);
  const b = rows.find((r) => r.key === into);
  if (!a || !b || a === b) return rows;
  const merged: Row = {
    ...b,
    price: b.price || a.price,
    mrp: b.mrp || a.mrp,
    barcode: b.barcode || a.barcode,
    hsn: b.hsn || a.hsn,
    gst: b.gst || a.gst,
    categoryId: b.categoryId || a.categoryId,
    brand: b.brand || a.brand,
    photos: [...new Set([...b.photos, ...a.photos])].sort((x, y) => x - y),
    flags: [...new Set([...b.flags, ...a.flags, "merged"])],
  };
  return rows.filter((r) => r.key !== from).map((r) => (r.key === into ? merged : r));
}

/**
 * "Add products from photos": up to 20 photos of shelves, packs or a price list are read in the background (progress shown),
 * then a review grid lets the owner edit, skip or merge before anything is created through the normal catalogue route.
 */
export function AddFromPhotosButton({ onDone, className }: { onDone?: (created: number) => void; className?: string }) {
  const { t } = useI18n();
  const { show } = useBHelper("catalogue-photos", "catalogue.manage");
  const errText = useBError();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [photos, setPhotos] = React.useState<Photo[]>([]);
  const [est, setEst] = React.useState<Estimate | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [batchId, setBatchId] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [failed, setFailed] = React.useState<Record<string, string>>({});

  const cats = useQuery({
    queryKey: ["ai-b", "categories"],
    queryFn: () => api.get<{ items: { id: string; name: string; active?: boolean }[] }>("/catalog/categories"),
    enabled: open,
    staleTime: 60_000,
  });
  const batch = useQuery({
    queryKey: ["ai-b", "photo-batch", batchId],
    queryFn: () => getB<Batch>(`catalogue-photos/${batchId}`),
    enabled: !!batchId && !rows,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === "done" || q.state.data.status === "failed") ? false : 1500),
  });
  const b = batch.data;
  const finished = b && (b.status === "done" || b.status === "failed");

  React.useEffect(() => {
    if (b && finished && !rows) setRows(b.drafts.map(toRow));
  }, [b, finished, rows]);

  const reset = () => {
    setPhotos([]);
    setEst(null);
    setError(null);
    setBatchId(null);
    setRows(null);
    setFailed({});
  };
  if (!show) return null;

  const chose = async (p: Photo[]) => {
    setPhotos(p);
    setError(null);
    setEst(null);
    try {
      setEst(await postB<Estimate>("catalogue-photos/estimate", { count: p.length }));
    } catch (e) {
      setError(errText(e));
    }
  };
  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const r = await postB<{ batchId: string }>("catalogue-photos", { images: photos.map((p) => ({ mediaType: p.mediaType, data: p.data })) });
      setBatchId(r.batchId);
    } catch (e) {
      setError(errText(e));
    } finally {
      setStarting(false);
    }
  };

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? rs);
  const chosen = rows?.filter((r) => r.include) ?? [];
  const blocked = chosen.some((r) => rowProblems(r).length > 0);

  const create = async () => {
    if (!rows) return;
    setCreating(true);
    const errs: Record<string, string> = {};
    const made = new Set<string>();
    for (const r of chosen) {
      try {
        await api.post("/catalog/products", productBody(r));
        made.add(r.key);
      } catch (e) {
        errs[r.key] = errText(e);
      }
    }
    setCreating(false);
    setFailed(errs);
    void qc.invalidateQueries();
    if (made.size) toast.success(t("web.aiB.photos.created", { count: made.size }));
    if (Object.keys(errs).length === 0) {
      setOpen(false);
      reset();
      onDone?.(made.size);
    } else {
      setRows((rs) => rs?.filter((r) => !made.has(r.key)) ?? rs);
      onDone?.(made.size);
    }
  };

  const categories = (cats.data?.items ?? []).filter((c) => c.active !== false);
  const conf = (c: Draft["confidence"]) => t(`web.aiB.conf.${c}`);

  return (
    <>
      <Button type="button" variant="outline" size="lg" className={className} onClick={() => setOpen(true)}>
        <CameraIcon /> {t("web.aiB.photos.button")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (starting || creating) return;
          setOpen(o);
          if (!o && !batchId) reset();
        }}
      >
        <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{t("web.aiB.photos.title")}</DialogTitle>
            <DialogDescription>{t("web.aiB.photos.intro")}</DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!batchId && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <PhotoPicker label={photos.length ? t("web.aiB.photos.change") : t("web.aiB.photos.choose")} max={20} onPhotos={(p) => void chose(p)} onError={setError} variant="outline" testId="ai-b-photos-input" />
                {photos.length > 0 && <span className="text-sm text-muted-foreground">{t("web.aiB.photos.count", { count: photos.length })}</span>}
              </div>
              {photos.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label={t("web.aiB.photos.chosen")}>
                  {photos.map((p, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <li key={i}><img src={p.url} alt="" className="size-14 rounded-lg object-cover ring-1 ring-border" /></li>
                  ))}
                </ul>
              )}
              {est && (
                <p className="text-sm">
                  {est.remaining === null ? t("web.aiB.photos.estimateUnlimited", { credits: est.credits }) : t("web.aiB.photos.estimate", { credits: est.credits, remaining: est.remaining })}
                  {!est.enough && <span className="ml-1 font-medium text-destructive">{t("web.aiB.photos.notEnough")}</span>}
                </p>
              )}
              <p className="text-meta text-muted-foreground">{t("web.aiB.photos.privacy")}</p>
            </div>
          )}

          {batchId && !rows && (
            <div className="grid gap-2" role="status" aria-live="polite">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Loader2Icon className="size-4 animate-spin" /> {t("web.aiB.photos.progress", { done: b?.done ?? 0, total: b?.total ?? photos.length })}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${b && b.total ? Math.round((100 * b.done) / b.total) : 5}%` }} />
              </div>
              {b && b.drafts.length > 0 && <p className="text-meta text-muted-foreground">{t("web.aiB.photos.found", { count: b.drafts.length })}</p>}
            </div>
          )}

          {rows && b && (
            <div className="grid gap-3">
              <div role="status" className="rounded-xl bg-primary/5 p-3 text-sm ring-1 ring-primary/20 ring-inset">
                {t("web.aiB.photos.draftNote", { credits: b.credits })}
              </div>
              {b.problems.length > 0 && (
                <Alert>
                  <AlertDescription>
                    {[...new Set(b.problems.map((p) => (PROBLEM_CODES.includes(p.code) ? p.code : "ai_failed")))].map((c) => t(`web.aiB.photos.problem.${c}`)).join(" ")}
                  </AlertDescription>
                </Alert>
              )}
              {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("web.aiB.photos.none")}</p>}
              <ul className="grid gap-2">
                {rows.map((r) => {
                  const probs = rowProblems(r);
                  return (
                    <li key={r.key} className={`grid gap-2 rounded-xl border bg-card p-3 ${r.include ? "" : "opacity-60"}`} data-testid="ai-b-photo-row">
                      <div className="flex flex-wrap items-center gap-2">
                        <Checkbox checked={r.include} onCheckedChange={(v) => set(r.key, { include: v === true })} aria-label={t("web.aiB.photos.include")} />
                        <Input className="min-w-0 flex-1 basis-56" value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} aria-label={t("web.aiB.photos.name")} />
                        <Badge variant={r.confidence === "low" ? "destructive" : "secondary"}>{conf(r.confidence)}</Badge>
                        <span className="text-meta text-muted-foreground">{t("web.aiB.photos.fromPhotos", { list: r.photos.map((p) => p + 1).join(", ") })}</span>
                      </div>
                      {r.existing && (
                        <p className="text-sm text-amber-700 dark:text-amber-400">
                          {t(`web.aiB.photos.existing.${r.existing.match}`, { name: r.existing.name })}
                        </p>
                      )}
                      {r.flags.includes("injection") && <p className="text-sm text-destructive">{t("web.aiB.photos.injection")}</p>}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                        <label className="grid gap-1 text-xs font-medium">
                          {t("web.aiB.photos.price")}
                          <Input inputMode="decimal" value={r.price} aria-invalid={probs.includes("price")} onChange={(e) => set(r.key, { price: e.target.value })} />
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          {t("web.aiB.photos.mrp")}
                          <Input inputMode="decimal" value={r.mrp} onChange={(e) => set(r.key, { mrp: e.target.value })} />
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          {t("web.aiB.photos.unit")}
                          <Select value={r.unit} onValueChange={(v) => set(r.key, { unit: v })}>
                            <SelectTrigger aria-label={t("web.aiB.photos.unit")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {UNITS.map((u) => (
                                <SelectItem key={u} value={u}>{u}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          {t("web.aiB.photos.hsn")}
                          <Input value={r.hsn} aria-invalid={probs.includes("hsn")} onChange={(e) => set(r.key, { hsn: e.target.value.replace(/\D/g, "").slice(0, 8) })} />
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          {t("web.aiB.photos.gst")}
                          <Select value={r.gst} onValueChange={(v) => set(r.key, { gst: v })}>
                            <SelectTrigger aria-label={t("web.aiB.photos.gst")} aria-invalid={probs.includes("gst")}>
                              <SelectValue placeholder="?" />
                            </SelectTrigger>
                            <SelectContent>
                              {[...new Set([...GST_CHOICES, ...(r.gst !== "" ? [Number(r.gst)] : [])])].map((g) => (
                                <SelectItem key={g} value={String(g)}>{g}%</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          {t("web.aiB.photos.category")}
                          <Select value={r.categoryId || NO_CAT} onValueChange={(v) => set(r.key, { categoryId: v === NO_CAT ? "" : v })}>
                            <SelectTrigger aria-label={t("web.aiB.photos.category")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_CAT}>{t("web.aiB.photos.noCategory")}</SelectItem>
                              {categories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          {t("web.aiB.photos.barcode")}
                          <Input value={r.barcode} onChange={(e) => set(r.key, { barcode: e.target.value.trim() })} />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <label className="flex items-center gap-1.5">
                          <Checkbox checked={r.inclusive} onCheckedChange={(v) => set(r.key, { inclusive: v === true })} /> {t("web.aiB.photos.inclusive")}
                        </label>
                        {r.hsnNote && <span>{t("web.aiB.photos.hsnVerify", { text: r.hsnNote })}</span>}
                        {!r.hsn && <span>{t("web.aiB.photos.noHsn")}</span>}
                        {probs.includes("price") && r.include && <span className="font-medium text-destructive">{t("web.aiB.photos.needPrice")}</span>}
                        {probs.includes("gst") && r.include && <span className="font-medium text-destructive">{t("web.aiB.photos.needGst")}</span>}
                        {failed[r.key] && <span className="font-medium text-destructive">{failed[r.key]}</span>}
                        {rows.length > 1 && (
                          <Select value="" onValueChange={(into) => setRows((rs) => (rs ? mergeRows(rs, r.key, into) : rs))}>
                            <SelectTrigger className="h-7 w-auto gap-1 text-xs" aria-label={t("web.aiB.photos.merge")}>
                              <MergeIcon className="size-3.5" /> <SelectValue placeholder={t("web.aiB.photos.merge")} />
                            </SelectTrigger>
                            <SelectContent>
                              {rows.filter((o) => o.key !== r.key).map((o) => (
                                <SelectItem key={o.key} value={o.key}>{o.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => rs?.filter((x) => x.key !== r.key) ?? rs)}>
                          <XIcon /> {t("web.aiB.photos.remove")}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {rows ? (
              <>
                <Button variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={creating}>
                  {t("web.common.cancel")}
                </Button>
                <Button onClick={() => void create()} disabled={creating || chosen.length === 0 || blocked}>
                  {creating ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} {t("web.aiB.photos.create", { count: chosen.length })}
                </Button>
              </>
            ) : !batchId ? (
              <>
                <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>
                  {t("web.common.cancel")}
                </Button>
                <Button onClick={() => void start()} disabled={photos.length === 0 || starting || !est || !est.enough}>
                  {starting ? <Loader2Icon className="animate-spin" /> : <CameraIcon />} {t("web.aiB.photos.read")}
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
