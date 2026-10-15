"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BoxesIcon,
  CheckCircle2Icon,
  FileSpreadsheetIcon,
  FileUpIcon,
  Loader2Icon,
  PackageIcon,
  RotateCcwIcon,
  TruckIcon,
  UploadCloudIcon,
  UsersIcon,
  XCircleIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AnimatePresence,
  Button,
  Card,
  cn,
  EmptyState,
  motion,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stagger,
  StaggerItem,
  SuccessCheck,
  Switch,
  Label,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { describeError, QueryError, useFeatures, useI18n, type Translator } from "@srirealtime/web";
import { CountTile, Dropzone } from "../bits";
import { downloadTemplate, useCommitImport, useImporters, useImportJob, usePreviewImport } from "../../lib/queries";
import type { ImportJob, Importer, Mapping, PreviewResult } from "../../lib/types";
import { ErrorRowsButton } from "./job-status";

const MAX_BYTES = 10 * 1024 * 1024;
const NONE = "__none";
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "catalog.products": PackageIcon,
  "invoices.customers": UsersIcon,
  "inventory.suppliers": TruckIcon,
  "inventory.stock": BoxesIcon,
};

export const importerLabel = (t: Translator, i: Pick<Importer, "key" | "label">) =>
  t.has(`workspace.import.kinds.${i.key}`) ? t(`workspace.import.kinds.${i.key}`) : i.label;

type Step = { kind: "choose" } | { kind: "upload"; importer: Importer } | { kind: "preview"; importer: Importer; preview: PreviewResult } | { kind: "job"; importer: Importer; preview: PreviewResult; job: ImportJob };

/** choose → upload (template, drag & drop) → preview (mapping, row errors) → progress → summary. */
export function ImportWizard() {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const importers = useImporters();
  const features = useFeatures();
  const [step, setStep] = React.useState<Step>({ kind: "choose" });
  const list = (importers.data ?? []).filter((i) => !i.feature || features.isEnabled(i.feature));

  const body = (() => {
    if (step.kind === "choose") {
      if (importers.isError) return <QueryError error={importers.error} onRetry={() => void importers.refetch()} />;
      if (importers.isPending)
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        );
      if (!list.length) return <EmptyState icon={FileUpIcon} title={t("workspace.import.noImporters")} />;
      return (
        <Stagger className="grid gap-3 sm:grid-cols-2" stagger={0.05}>
          {list.map((imp) => {
            const Icon = ICONS[imp.key] ?? FileSpreadsheetIcon;
            const required = imp.columns.filter((c) => c.required);
            return (
              <StaggerItem key={imp.key} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setStep({ kind: "upload", importer: imp })}
                  className="group flex h-full w-full items-start gap-3 rounded-2xl border border-card-ring bg-card p-4 text-left shadow-elevated outline-none transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-raised focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
                >
                  <span className="icon-chip size-10 shrink-0 rounded-xl text-primary">
                    <Icon className="size-5" />
                  </span>
                  <span className="grid min-w-0 gap-1">
                    <span className="font-heading font-semibold">{importerLabel(t, imp)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("workspace.import.columnsHint", { count: imp.columns.length, required: required.map((c) => c.label).join(", ") || "—" })}
                    </span>
                  </span>
                </button>
              </StaggerItem>
            );
          })}
        </Stagger>
      );
    }
    if (step.kind === "upload")
      return <UploadStep importer={step.importer} onBack={() => setStep({ kind: "choose" })} onPreview={(preview) => setStep({ kind: "preview", importer: step.importer, preview })} />;
    if (step.kind === "preview")
      return (
        <PreviewStep
          importer={step.importer}
          preview={step.preview}
          onBack={() => setStep({ kind: "upload", importer: step.importer })}
          onStarted={(job) => setStep({ kind: "job", importer: step.importer, preview: step.preview, job })}
        />
      );
    return <JobStep importer={step.importer} preview={step.preview} initial={step.job} onAgain={() => setStep({ kind: "choose" })} />;
  })();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step.kind}
        initial={reduced ? false : { opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
        transition={{ duration: 0.18 }}
      >
        {body}
      </motion.div>
    </AnimatePresence>
  );
}

function StepHeader({ importer, onBack, title }: { importer: Importer; onBack?: () => void; title: string }) {
  const { t } = useI18n();
  return (
    <div className="mb-3 flex items-center gap-2">
      {onBack && (
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onBack}>
          <ArrowLeftIcon /> {t("workspace.common.back")}
        </Button>
      )}
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{importerLabel(t, importer)}</span> · {title}
      </p>
    </div>
  );
}

function UploadStep({ importer, onBack, onPreview }: { importer: Importer; onBack: () => void; onPreview: (p: PreviewResult) => void }) {
  const { t } = useI18n();
  const preview = usePreviewImport();
  const [downloading, setDownloading] = React.useState(false);

  const onFile = (file: File) => {
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      toast.error(t("workspace.import.wrongType"));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("workspace.import.tooBig"));
      return;
    }
    preview.mutate({ key: importer.key, file }, { onSuccess: onPreview, onError: (err) => toast.error(describeError(err, t)) });
  };

  const template = async () => {
    setDownloading(true);
    try {
      await downloadTemplate(importer.key);
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <StepHeader importer={importer} onBack={onBack} title={t("workspace.import.steps.upload")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Dropzone
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onFile={onFile}
          disabled={preview.isPending}
          icon={preview.isPending ? Loader2Icon : UploadCloudIcon}
          title={preview.isPending ? t("workspace.import.reading") : t("workspace.import.drop")}
          hint={t("workspace.import.dropHint")}
          className={cn("min-h-64", preview.isPending && "[&_svg]:animate-spin")}
        />
        <Card className="gap-3 px-4 py-4">
          <p className="text-sm font-semibold">{t("workspace.import.templateTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("workspace.import.templateHint")}</p>
          <Button variant="outline" className="h-11" onClick={() => void template()} disabled={downloading}>
            {downloading ? <Loader2Icon className="animate-spin" /> : <FileSpreadsheetIcon />} {t("workspace.import.template")}
          </Button>
          <ul className="grid gap-1 border-t pt-3 text-xs">
            {importer.columns.map((c) => (
              <li key={c.key} className="flex items-baseline justify-between gap-2">
                <span className={cn(c.required && "font-semibold")}>
                  {c.label}
                  {c.required && <span className="text-destructive"> *</span>}
                </span>
                {c.example && <span className="truncate text-muted-foreground">{c.example}</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function PreviewStep({
  importer,
  preview,
  onBack,
  onStarted,
}: {
  importer: Importer;
  preview: PreviewResult;
  onBack: () => void;
  onStarted: (j: ImportJob) => void;
}) {
  const { t } = useI18n();
  const commit = useCommitImport();
  const [mapping, setMapping] = React.useState<Mapping>(preview.mapping);
  const [onlyErrors, setOnlyErrors] = React.useState(false);
  const changed = JSON.stringify(mapping) !== JSON.stringify(preview.mapping);
  const missing = importer.columns.filter((c) => c.required && (mapping[c.key] ?? null) === null);
  const headers = preview.columns.map((c) => c.header);
  const mappedTo = new Map(Object.entries(mapping).filter(([, i]) => i !== null).map(([k, i]) => [i as number, k]));
  const rows = onlyErrors ? preview.rows.filter((r) => r.errors.length) : preview.rows;
  const nothing = preview.totals.valid === 0;

  const setCol = (key: string, value: string) =>
    setMapping((m) => {
      const idx = value === NONE ? null : Number(value);
      const next: Mapping = { ...m };
      // A file column feeds one field: take it away from whichever field had it.
      if (idx !== null) for (const [k, v] of Object.entries(next)) if (v === idx) next[k] = null;
      next[key] = idx;
      return next;
    });

  const start = () =>
    commit.mutate(
      { jobId: preview.jobId, mapping: changed ? mapping : undefined },
      { onSuccess: onStarted, onError: (err) => toast.error(describeError(err, t)) },
    );

  return (
    <div className="grid gap-4">
      <StepHeader importer={importer} onBack={onBack} title={t("workspace.import.steps.preview", { file: preview.fileName ?? "" })} />
      <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
        <CountTile label={t("workspace.import.totals.rows")} value={preview.totals.rows} />
        <CountTile label={t("workspace.import.totals.valid")} value={preview.totals.valid} tone="text-success-ink" icon={CheckCircle2Icon} />
        <CountTile label={t("workspace.import.totals.invalid")} value={preview.totals.invalid} tone={preview.totals.invalid ? "text-danger-ink" : "text-muted-foreground"} icon={XCircleIcon} />
      </div>

      {missing.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("workspace.import.missingTitle")}</AlertTitle>
          <AlertDescription>{t("workspace.import.missingBody", { columns: missing.map((c) => c.label).join(", ") })}</AlertDescription>
        </Alert>
      )}

      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b px-4 py-3 sm:px-5">
          <h3 className="font-heading text-base font-semibold">{t("workspace.import.mappingTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("workspace.import.mappingHint")}</p>
        </div>
        <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0">
          {importer.columns.map((c) => {
            const v = mapping[c.key] ?? null;
            return (
              <li key={c.key} className="flex items-center gap-3 px-4 py-2.5 sm:border-b sm:px-5 sm:odd:border-r">
                <span className="min-w-0 flex-1 text-sm">
                  <span className={cn("block truncate", c.required && "font-semibold")}>
                    {c.label}
                    {c.required && <span className="text-destructive"> *</span>}
                  </span>
                  {c.help && <span className="block truncate text-xs text-muted-foreground">{c.help}</span>}
                </span>
                <Select value={v === null ? NONE : String(v)} onValueChange={(val) => setCol(c.key, val)}>
                  <SelectTrigger
                    className={cn("w-44 shrink-0", v === null && c.required && "border-destructive")}
                    aria-label={t("workspace.import.mapFor", { column: c.label })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("workspace.import.notInFile")}</SelectItem>
                    {preview.columns.map((h) => (
                      <SelectItem key={h.index} value={String(h.index)}>
                        {h.header || t("workspace.import.columnN", { n: h.index + 1 })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            );
          })}
        </ul>
        {changed && <p className="border-t bg-info/10 px-4 py-2 text-xs text-info-ink sm:px-5">{t("workspace.import.remapNote")}</p>}
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
          <div>
            <h3 className="font-heading text-base font-semibold">{t("workspace.import.rowsTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("workspace.import.rowsHint", { shown: preview.rows.length, total: preview.totals.rows })}</p>
          </div>
          {preview.totals.invalid > 0 && (
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Switch checked={onlyErrors} onCheckedChange={setOnlyErrors} /> {t("workspace.import.onlyErrors")}
            </Label>
          )}
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("workspace.import.rowsTitle")}</caption>
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b text-left">
                <th scope="col" className="h-10 px-3 pl-4 text-xs font-medium text-muted-foreground sm:pl-5">
                  #
                </th>
                {headers.map((h, i) => (
                  <th key={i} scope="col" className="h-10 px-3 text-xs font-medium whitespace-nowrap text-muted-foreground">
                    {h || t("workspace.import.columnN", { n: i + 1 })}
                    {mappedTo.has(i) ? null : <span className="ml-1 font-normal opacity-70">({t("workspace.import.ignored")})</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const bad = r.errors.length > 0;
                return (
                  <React.Fragment key={r.row}>
                    <tr className={cn("border-b border-border/60", bad ? "bg-destructive/6" : "hover:bg-muted/40")}>
                      <td className={cn("px-3 py-2 pl-4 text-xs tabular-nums sm:pl-5", bad ? "font-semibold text-danger-ink" : "text-muted-foreground")}>{r.row}</td>
                      {headers.map((_, i) => (
                        <td key={i} className={cn("max-w-48 truncate px-3 py-2 whitespace-nowrap", !mappedTo.has(i) && "text-muted-foreground/70")}>
                          {r.raw[i] ?? ""}
                        </td>
                      ))}
                    </tr>
                    {bad && (
                      <tr className="border-b border-border/60 bg-destructive/6">
                        <td />
                        <td colSpan={Math.max(1, headers.length)} className="px-3 pb-2 text-xs text-danger-ink">
                          <span className="inline-flex items-start gap-1">
                            <AlertTriangleIcon className="mt-px size-3.5 shrink-0" /> {r.errors.join(" · ")}
                          </span>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/90 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-2xl sm:border">
        <p className="text-xs text-muted-foreground">
          {nothing ? t("workspace.import.nothingValid") : preview.totals.invalid ? t("workspace.import.skipNote", { count: preview.totals.invalid }) : t("workspace.import.allGood")}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="lg" onClick={onBack} disabled={commit.isPending}>
            <RotateCcwIcon /> {t("workspace.import.otherFile")}
          </Button>
          <Button size="lg" onClick={start} disabled={commit.isPending || missing.length > 0 || nothing}>
            {commit.isPending ? <Loader2Icon className="animate-spin" /> : <FileUpIcon />}
            {t("workspace.import.start", { count: preview.totals.valid })}
          </Button>
        </div>
      </div>
    </div>
  );
}

function JobStep({ importer, preview, initial, onAgain }: { importer: Importer; preview: PreviewResult; initial: ImportJob; onAgain: () => void }) {
  const { t } = useI18n();
  const q = useImportJob(initial.jobId, initial);
  const job = q.data ?? initial;
  const running = job.status === "queued" || job.status === "running";
  const pct = job.valid > 0 ? Math.min(100, Math.round((job.processed / job.valid) * 100)) : running ? 0 : 100;
  const raw = React.useMemo(() => new Map(preview.rows.map((r) => [r.row, r.raw])), [preview.rows]);
  const headers = preview.columns.map((c) => c.header);

  return (
    <div className="grid gap-4">
      <StepHeader importer={importer} title={preview.fileName ?? ""} />
      <Card className="gap-4 px-4 py-5 sm:px-6">
        {running ? (
          <div className="grid gap-3" role="status" aria-live="polite">
            <p className="flex items-center gap-2 font-heading text-lg font-semibold">
              <Loader2Icon className="size-5 animate-spin text-primary" /> {t("workspace.import.importing")}
            </p>
            <Progress value={pct} className="h-2.5" aria-label={t("workspace.import.progress", { done: job.processed, total: job.valid })} />
            <p className="text-sm text-muted-foreground tabular-nums">{t("workspace.import.progress", { done: job.processed, total: job.valid })}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center" role="status" aria-live="polite">
            {job.status === "done" && job.failed === 0 ? (
              <SuccessCheck size={56} />
            ) : (
              <span className={cn("icon-chip size-14 rounded-2xl", job.status === "failed" ? "text-danger-ink" : "text-warning-ink")}>
                {job.status === "failed" ? <XCircleIcon className="size-7" /> : <AlertTriangleIcon className="size-7" />}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-heading text-lg font-semibold">
                {job.status === "failed" ? t("workspace.import.failedTitle") : job.failed ? t("workspace.import.partialTitle") : t("workspace.import.doneTitle")}
              </p>
              <p className="text-sm text-muted-foreground">{t("workspace.import.doneBody", { created: job.created, updated: job.updated })}</p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CountTile label={t("workspace.import.result.created")} value={job.created} tone="text-success-ink" />
          <CountTile label={t("workspace.import.result.updated")} value={job.updated} tone="text-info-ink" />
          <CountTile label={t("workspace.import.result.skipped")} value={job.skipped || job.invalid} tone="text-muted-foreground" />
          <CountTile label={t("workspace.import.result.failed")} value={job.failed} tone={job.failed ? "text-danger-ink" : "text-muted-foreground"} />
        </div>
        {!running && job.errors.length > 0 && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">{t("workspace.import.errorsTitle")}</p>
            <ul className="max-h-60 divide-y overflow-auto rounded-xl border text-sm">
              {job.errors.slice(0, 200).map((e, i) => (
                <li key={`${e.row}-${i}`} className="flex gap-3 px-3 py-2">
                  <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{t("workspace.import.rowN", { row: e.row })}</span>
                  <span className="text-danger-ink">{e.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!running && (
          <div className="flex flex-wrap gap-2">
            <ErrorRowsButton job={job} raw={raw} headers={headers} className="h-11" />
            <Button className="h-11" onClick={onAgain}>
              <FileUpIcon /> {t("workspace.import.another")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
