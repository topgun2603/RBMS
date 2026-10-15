"use client";

import * as React from "react";
import {
  CalendarClockIcon,
  ChevronDownIcon,
  Columns3Icon,
  DownloadIcon,
  FilterIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  GroupIcon,
  Loader2Icon,
  RefreshCwIcon,
  SaveIcon,
  SigmaIcon,
  SlidersHorizontalIcon,
  WandSparklesIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
  StatusPill,
  toast,
} from "@srirealtime/ui";
import {
  describeError,
  ModuleLink,
  Page,
  PageHeading,
  QueryError,
  useDebounced,
  useI18n,
  useModuleNavigate,
  usePermission,
  useQueryParams,
  useRouteParams,
} from "@srirealtime/web";
import { SectionCard } from "../components/bits";
import { ColumnsPicker } from "../components/reports/columns-picker";
import { DatasetPicker } from "../components/reports/dataset-picker";
import { FiltersEditor } from "../components/reports/filters-editor";
import { GroupByEditor, MeasuresEditor } from "../components/reports/group-measures";
import { DateRangeEditor, SortLimitEditor } from "../components/reports/options-editor";
import { ReportPreview } from "../components/reports/preview";
import { SaveReportDialog } from "../components/reports/save-dialog";
import { SchedulesList } from "../components/reports/schedules-list";
import { useReportLabels } from "../components/reports/shared";
import { downloadSaved, downloadSpec, useDatasets, useRunReport, useSavedReport } from "../lib/queries/reports";
import { buildSpec, initialState, isGrouped, issuesAt, specToState, type BuilderState } from "../lib/report-spec";
import type { DatasetInfo, ReportFormat, SavedReport } from "../lib/types";

export default function ReportBuilderPage() {
  return (
    <React.Suspense fallback={<BuilderSkeleton />}>
      <ReportBuilderRoute />
    </React.Suspense>
  );
}

function ReportBuilderRoute() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id?: string }>();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const datasets = useDatasets();
  const saved = useSavedReport(id);
  const datasetId = saved.data?.dataset ?? (id ? null : params.get("dataset"));

  if (datasets.isPending || (id && saved.isPending)) return <BuilderSkeleton />;
  if (id && saved.isError) {
    return (
      <Page>
        <PageHeading title={t("growth.reports.builder.title")} back={{ href: "reports", label: t("growth.reports.title") }} />
        <QueryError error={saved.error} onRetry={() => saved.refetch()} />
      </Page>
    );
  }
  if (datasets.isError) {
    return (
      <Page>
        <PageHeading title={t("growth.reports.builder.title")} back={{ href: "reports", label: t("growth.reports.title") }} />
        <QueryError error={datasets.error} onRetry={() => datasets.refetch()} />
      </Page>
    );
  }

  if (!datasetId) {
    return (
      <Page>
        <PageHeading icon={WandSparklesIcon} title={t("growth.reports.builder.title")} description={t("growth.reports.builder.pickDataset")} back={{ href: "reports", label: t("growth.reports.title") }} />
        <DatasetPicker datasets={datasets.data} onPick={(ds) => navigate(`reports/new?dataset=${encodeURIComponent(ds)}`, { replace: true })} />
      </Page>
    );
  }

  const ds = datasets.data?.find((d) => d.id === datasetId);
  if (!ds) {
    return (
      <Page>
        <PageHeading title={t("growth.reports.builder.title")} back={{ href: "reports", label: t("growth.reports.title") }} />
        <EmptyState
          icon={FilterIcon}
          title={t("growth.reports.builder.noDatasetTitle")}
          description={t("growth.reports.builder.noDatasetBody")}
          action={
            <Button asChild variant="outline">
              <ModuleLink to="reports/new">{t("growth.reports.builder.chooseDataset")}</ModuleLink>
            </Button>
          }
        />
      </Page>
    );
  }
  return <Builder key={`${ds.id}:${saved.data?.id ?? "new"}`} ds={ds} saved={saved.data ?? null} />;
}

function Builder({ ds, saved }: { ds: DatasetInfo; saved: SavedReport | null }) {
  const { t } = useI18n();
  const L = useReportLabels();
  const navigate = useModuleNavigate();
  const canManage = usePermission("reports.manage");
  const [state, setState] = React.useState<BuilderState>(() => (saved ? specToState(ds, saved.spec) : initialState(ds)));
  const patch = (p: Partial<BuilderState>) => setState((s) => ({ ...s, ...p }));

  const built = React.useMemo(() => buildSpec(ds, state), [ds, state]);
  const specJson = built.runnable ? JSON.stringify(built.spec) : null;
  const debounced = useDebounced(specJson, 400);
  const runSpec = React.useMemo(() => (debounced ? JSON.parse(debounced) : null), [debounced]);
  const run = useRunReport(runSpec);

  // Dirty = differs from the saved report's spec (as the builder would rebuild it).
  const savedJson = React.useMemo(() => (saved ? JSON.stringify(buildSpec(ds, specToState(ds, saved.spec)).spec) : null), [ds, saved]);
  const dirty = !!saved && JSON.stringify(built.spec) !== savedJson;

  const [saveMode, setSaveMode] = React.useState<"create" | "update" | null>(null);
  const [downloading, setDownloading] = React.useState<ReportFormat | null>(null);
  const scheduleRef = React.useRef<HTMLDivElement>(null);

  const grouped = isGrouped(state);
  const blocking = built.runnable ? null : (built.issues.find((i) => i.path === "columns" || i.path === "measures") ?? null);

  const download = async (format: ReportFormat) => {
    setDownloading(format);
    try {
      if (saved && !dirty) await downloadSaved(saved, format);
      else await downloadSpec(built.spec, format, saved?.name ?? ds.label);
      toast.success(t("growth.common.downloaded"));
    } catch (e) {
      toast.error(describeError(e, t));
    } finally {
      setDownloading(null);
    }
  };

  const downloadMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={!built.runnable || !!downloading}>
          {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
          {t("growth.common.download")}
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void download("xlsx")}>
          <FileSpreadsheetIcon /> {t("growth.reports.formats.xlsx")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download("csv")}>
          <FileTextIcon /> {t("growth.reports.formats.csv")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const saveButtons = canManage ? (
    saved ? (
      <div className="flex items-center">
        <Button className="rounded-r-none" disabled={!built.runnable || !dirty} onClick={() => setSaveMode("update")}>
          <SaveIcon /> {t("growth.common.save")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" className="rounded-l-none border-l border-primary-foreground/20" aria-label={t("growth.reports.save.more")} disabled={!built.runnable}>
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setSaveMode("create")}>{t("growth.reports.save.asNew")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => scheduleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <CalendarClockIcon /> {t("growth.reports.schedule.title")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ) : (
      <Button disabled={!built.runnable} onClick={() => setSaveMode("create")}>
        <SaveIcon /> {t("growth.reports.save.button")}
      </Button>
    )
  ) : null;

  return (
    <Page wide>
      <PageHeading
        icon={WandSparklesIcon}
        title={saved?.name ?? t("growth.reports.builder.newTitle", { dataset: ds.label })}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{saved?.description || ds.description || ds.label}</span>
            {saved && <Badge variant="secondary">{ds.label}</Badge>}
            {dirty && (
              <StatusPill tone="warning" icon={RefreshCwIcon}>
                {t("growth.common.unsaved")}
              </StatusPill>
            )}
          </span>
        }
        back={{ href: "reports", label: t("growth.reports.title") }}
        actions={
          <>
            {!saved && (
              <Button asChild variant="ghost">
                <ModuleLink to="reports/new">{t("growth.reports.builder.changeDataset")}</ModuleLink>
              </Button>
            )}
            {downloadMenu}
            {saveButtons}
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <SectionCard icon={Columns3Icon} title={t("growth.reports.columns.title")} description={t("growth.reports.columns.description")}>
            <ColumnsPicker ds={ds} value={state.columns} onChange={(columns) => patch({ columns })} disabled={grouped} />
          </SectionCard>
          <SectionCard icon={FilterIcon} title={t("growth.reports.filters.title")} description={t("growth.reports.filters.description")}>
            <div className="grid gap-4">
              <DateRangeEditor ds={ds} value={state.dateRange} onChange={(dateRange) => patch({ dateRange })} issues={issuesAt(built.issues, "dateRange")} />
              <FiltersEditor ds={ds} value={state.filters} onChange={(filters) => patch({ filters })} issues={built.issues} />
            </div>
          </SectionCard>
          <SectionCard icon={GroupIcon} title={t("growth.reports.group.title")} description={t("growth.reports.group.description")}>
            <GroupByEditor ds={ds} value={state.groupBy} onChange={(groupBy) => patch({ groupBy })} issues={built.issues} />
          </SectionCard>
          <SectionCard icon={SigmaIcon} title={t("growth.reports.measures.title")} description={t("growth.reports.measures.description")}>
            <MeasuresEditor ds={ds} value={state.measures} onChange={(measures) => patch({ measures })} issues={built.issues} grouped={state.groupBy.length > 0} />
          </SectionCard>
          <SectionCard icon={SlidersHorizontalIcon} title={t("growth.reports.sort.title")}>
            <SortLimitEditor ds={ds} state={state} onChange={patch} issues={built.issues} />
          </SectionCard>
        </div>

        <div className="grid gap-4 lg:sticky lg:top-4">
          <ReportPreview
            ds={ds}
            result={runSpec ? run.data : undefined}
            loading={run.isPending}
            fetching={run.isFetching || specJson !== debounced}
            error={run.error}
            onRetry={() => run.refetch()}
            blocked={blocking ? L.issue(blocking) : null}
          />
        </div>
      </div>

      {canManage && (
        <div ref={scheduleRef} className="mt-4 scroll-mt-4">
          <SectionCard
            icon={CalendarClockIcon}
            title={t("growth.reports.schedule.title")}
            description={saved ? t("growth.reports.schedule.sectionBody") : t("growth.reports.schedule.saveFirst")}
          >
            {saved ? (
              <SchedulesList reportId={saved.id} reportName={saved.name} canManage={canManage} />
            ) : (
              <Button variant="outline" disabled={!built.runnable} onClick={() => setSaveMode("create")}>
                <SaveIcon /> {t("growth.reports.save.button")}
              </Button>
            )}
          </SectionCard>
        </div>
      )}

      <SaveReportDialog
        open={saveMode !== null}
        onOpenChange={(o) => !o && setSaveMode(null)}
        spec={built.spec}
        existing={saved}
        mode={saveMode ?? "create"}
        defaultName={ds.label}
        onSaved={(row, created) => {
          if (created) navigate(`reports/${row.id}`, { replace: !saved });
        }}
      />
    </Page>
  );
}

function BuilderSkeleton() {
  return (
    <Page wide>
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </Page>
  );
}
