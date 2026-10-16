"use client";

import * as React from "react";
import { DownloadIcon, FileSpreadsheetIcon, FileTextIcon, Loader2Icon } from "lucide-react";
import { Button, Card, EmptyState, Skeleton, Stagger, StaggerItem, toast } from "@srirealtime/ui";
import { describeError, QueryError, useFeatures, useI18n } from "@srirealtime/web";
import { downloadExport, useExporters } from "../../lib/queries";
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
  if (!list.length) return <EmptyState icon={DownloadIcon} title={t("workspace.export.empty")} />;

  return (
    <div className="grid gap-3">
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
