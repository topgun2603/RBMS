"use client";

import * as React from "react";
import { ArchiveIcon, DownloadIcon, FileCodeIcon, FileSpreadsheetIcon, FileTextIcon, Loader2Icon } from "lucide-react";
import { Button, Card, EmptyState, Skeleton, Stagger, StaggerItem, toast } from "@srirealtime/ui";
import { describeError, QueryError, useFeatures, useI18n } from "@srirealtime/web";
import { useIsOwner } from "../../lib/access";
import { downloadExport, downloadExportAll, downloadTallyVouchers, useExportAll, useExporters, useStartExportAll } from "../../lib/queries";
import type { Exporter } from "../../lib/types";

const label = (t: ReturnType<typeof useI18n>["t"], e: Exporter) => (t.has(`workspace.import.kinds.${e.key}`) ? t(`workspace.import.kinds.${e.key}`) : e.label);

/** Every exporter the shop's features allow, with CSV and Excel downloads. */
export function ExportTab() {
  const { t } = useI18n();
  const features = useFeatures();
  const q = useExporters();
  const [busy, setBusy] = React.useState<string | null>(null);
  const list = (q.data ?? []).filter((e) => !e.feature || features.isEnabled(e.feature));

  const run = async (e: Exporter, format: "csv" | "xlsx") => {
    setBusy(`${e.key}.${format}`);
    try {
      await downloadExport(e.key, format);
      toast.success(t("workspace.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(null);
    }
  };

  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending)
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );
  if (!list.length)
    return (
      <div className="grid gap-3">
        <ExportAllCard />
        <TallyCard />
        <EmptyState icon={DownloadIcon} title={t("workspace.export.empty")} />
      </div>
    );

  return (
    <div className="grid gap-3">
      <ExportAllCard />
      <TallyCard />
      <p className="text-sm text-muted-foreground">{t("workspace.export.hint")}</p>
      <Stagger className="grid gap-3 sm:grid-cols-2" stagger={0.05}>
        {list.map((e) => (
          <StaggerItem key={e.key} className="min-w-0">
            <Card className="px-card h-full">
              <p className="flex items-center gap-2 font-heading font-semibold">
                <span className="icon-chip size-9 text-primary">
                  <DownloadIcon className="size-4" />
                </span>
                {label(t, e)}
              </p>
              <div className="mt-auto flex flex-wrap gap-2">
                {(["xlsx", "csv"] as const).map((f) => {
                  const id = `${e.key}.${f}`;
                  const Icon = busy === id ? Loader2Icon : f === "xlsx" ? FileSpreadsheetIcon : FileTextIcon;
                  return (
                    <Button
                      key={f}
                      variant="outline"
                      className="h-11 flex-1"
                      disabled={!!busy}
                      onClick={() => void run(e, f)}
                      aria-label={t("workspace.export.downloadAria", { name: label(t, e), format: f.toUpperCase() })}
                    >
                      <Icon className={busy === id ? "animate-spin" : undefined} />
                      {f === "xlsx" ? t("workspace.export.excel") : t("workspace.common.csv")}
                    </Button>
                  );
                })}
              </div>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}

const fmtBytes = (n: number | null) => (n === null ? "" : n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** "Export all my data": one zip of everything, built in the background; owners only. */
function ExportAllCard() {
  const { t, formatDate } = useI18n();
  const owner = useIsOwner();
  const jobs = useExportAll(owner);
  const start = useStartExportAll();
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!owner) return null;
  const list = jobs.data ?? [];
  const running = list.find((j) => j.status === "queued" || j.status === "running");
  const latest = list.find((j) => j.status === "done");

  const download = async (id: string, name: string | null) => {
    setBusy(id);
    try {
      await downloadExportAll(id, name ?? "data.zip");
      toast.success(t("workspace.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="px-card">
      <p className="flex items-center gap-2 font-heading font-semibold">
        <span className="icon-chip size-9 text-primary">
          <ArchiveIcon className="size-4" />
        </span>
        {t("workspace.export.all.title")}
      </p>
      <p className="text-meta text-muted-foreground">{t("workspace.export.all.body")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="h-11"
          disabled={!!running || start.isPending}
          onClick={() => start.mutate(undefined, { onError: (err) => toast.error(describeError(err, t)) })}
        >
          {running || start.isPending ? <Loader2Icon className="animate-spin" /> : <ArchiveIcon />}
          {running ? t("workspace.export.all.building") : t("workspace.export.all.start")}
        </Button>
        {latest && !running && (
          <Button variant="outline" className="h-11" disabled={busy === latest.id} onClick={() => void download(latest.id, latest.fileName)}>
            {busy === latest.id ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
            {t("workspace.export.all.download", { size: fmtBytes(latest.fileSize) })}
          </Button>
        )}
      </div>
      {latest?.expiresAt && !running && (
        <p className="text-xs text-muted-foreground">
          {t("workspace.export.all.ready", { date: formatDate(latest.finishedAt ?? latest.createdAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }), until: formatDate(latest.expiresAt, { day: "numeric", month: "short" }) })}
        </p>
      )}
      {list[0]?.status === "failed" && <p className="text-xs text-danger-ink">{list[0].error ?? t("workspace.export.all.failed")}</p>}
    </Card>
  );
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Sales / purchase vouchers for Tally (XML for Gateway of Tally > Import Data, or Excel). */
function TallyCard() {
  const { t } = useI18n();
  const owner = useIsOwner();
  // India's calendar day, not UTC's: before 5:30 am IST the UTC date is still yesterday.
  const today = new Date(Date.now() + 330 * 60_000);
  const fyStart = new Date(Date.UTC(today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1, 3, 1));
  const [kind, setKind] = React.useState<"sale" | "purchase">("sale");
  const [from, setFrom] = React.useState(ymd(fyStart));
  const [to, setTo] = React.useState(ymd(today));
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!owner) return null;
  const run = async (format: "xml" | "xlsx") => {
    setBusy(format);
    try {
      await downloadTallyVouchers({ kind, from, to, format });
      toast.success(t("workspace.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="px-card">
      <p className="flex items-center gap-2 font-heading font-semibold">
        <span className="icon-chip size-9 text-primary">
          <FileCodeIcon className="size-4" />
        </span>
        {t("workspace.export.tally.title")}
      </p>
      <p className="text-meta text-muted-foreground">{t("workspace.export.tally.body")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs">
          {t("workspace.export.tally.kind")}
          <select className="h-11 rounded-md border bg-background px-3 text-sm" value={kind} onChange={(e) => setKind(e.target.value as "sale" | "purchase")}>
            <option value="sale">{t("workspace.export.tally.sales")}</option>
            <option value="purchase">{t("workspace.export.tally.purchases")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          {t("workspace.export.tally.from")}
          <input type="date" className="h-11 rounded-md border bg-background px-3 text-sm" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs">
          {t("workspace.export.tally.to")}
          <input type="date" className="h-11 rounded-md border bg-background px-3 text-sm" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(["xml", "xlsx"] as const).map((f) => (
          <Button key={f} variant="outline" className="h-11" disabled={!!busy || !from || !to} onClick={() => void run(f)}>
            {busy === f ? <Loader2Icon className="animate-spin" /> : f === "xml" ? <FileCodeIcon /> : <FileSpreadsheetIcon />}
            {f === "xml" ? t("workspace.export.tally.xml") : t("workspace.export.excel")}
          </Button>
        ))}
      </div>
    </Card>
  );
}
