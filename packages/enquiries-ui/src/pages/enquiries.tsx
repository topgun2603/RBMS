"use client";

import * as React from "react";
import { MailIcon } from "lucide-react";
import { ChipGroup, DataTable, DataTableToolbar, EmptyState, type DataTableColumn } from "@rbms/ui";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { EnquiryStatusPill, useAgo, useStatusLabel } from "../components/bits";
import { aboutLine, phoneLabel } from "../lib/format";
import { ek } from "../lib/queries";
import { ENQUIRY_STATUSES, type Enquiry } from "../lib/types";

export default function EnquiriesPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <Enquiries />
    </React.Suspense>
  );
}

function Enquiries() {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const ago = useAgo();
  const statusLabel = useStatusLabel();
  const [topics, setTopics] = React.useState<string[]>([]);

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("enquiries.list.filterStatus"), options: ENQUIRY_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })), hidden: true },
        topic: { kind: "options", label: t("enquiries.list.filterTopic"), single: true, dynamic: true, options: topics.map((x) => ({ value: x, label: x })), hidden: topics.length === 0 },
        date: { kind: "dateRange", label: t("enquiries.list.filterDate"), presets: ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth"] },
      }) satisfies ServerFilterDefs,
    [t, statusLabel, topics],
  );

  const columns = React.useMemo<DataTableColumn<Enquiry>[]>(
    () => [
      {
        id: "number",
        header: t("enquiries.list.col.number"),
        sortable: true,
        card: "subtitle",
        cell: (r) => (
          <ModuleLink to={r.id} className="font-mono text-meta hover:underline">
            {r.number}
          </ModuleLink>
        ),
        cardCell: (r) => [r.number, phoneLabel(r.phone)].join(" · "),
      },
      {
        id: "name",
        header: t("enquiries.list.col.name"),
        sortable: true,
        hideable: false,
        card: "title",
        cell: (r) => (
          <span className="flex flex-col">
            <span className={r.status === "new" ? "flex items-center gap-1.5 font-semibold" : "font-medium"}>
              {r.status === "new" && <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />}
              {r.name}
            </span>
            <span className="text-meta tabular-nums text-muted-foreground">{phoneLabel(r.phone)}</span>
          </span>
        ),
      },
      { id: "about", header: t("enquiries.list.col.about"), card: "meta", cell: (r) => aboutLine(r) || "—" },
      { id: "status", header: t("enquiries.list.col.status"), sortable: true, card: "right", cell: (r) => <EnquiryStatusPill status={r.status} /> },
      { id: "date", header: t("enquiries.list.col.received"), sortable: true, sortDescFirst: true, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{ago(r.createdAt)}</span> },
    ],
    [t, ago],
  );

  const st = useServerTable<Enquiry, typeof filters>({
    queryKey: ek.list,
    path: "/enquiries/enquiries",
    columns,
    filters,
    defaultSort: "-date",
    search: t("enquiries.list.search"),
    storageKey: "enquiries-list",
  });

  const fetched = (st.query.data as { topics?: string[] } | undefined)?.topics;
  React.useEffect(() => {
    if (fetched && fetched.join("\n") !== topics.join("\n")) setTopics(fetched);
  }, [fetched, topics]);

  const status = st.filters.status;
  const counts = st.facets?.status;
  const all = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;
  return (
    <Page>
      <PageHeading title={t("enquiries.list.title")} description={st.total !== undefined ? t("enquiries.list.count", { count: st.total }) : t("enquiries.list.description")} />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("enquiries.list.filterStatus")}
            value={status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : ""}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("enquiries.common.all"), meta: all },
              ...ENQUIRY_STATUSES.map((s) => ({ value: s, label: statusLabel(s), meta: counts?.[s] ?? 0 })),
            ]}
          />
        }
      />
      <DataTable
        table={st.table}
        onRowClick={(r) => navigate(r.id)}
        empty={<EmptyState icon={MailIcon} title={t("enquiries.list.emptyTitle")} description={t("enquiries.list.emptyBody")} />}
      />
    </Page>
  );
}
