"use client";

import * as React from "react";
import { CheckCircle2Icon, FileTextIcon, NewspaperIcon, PencilLineIcon, PlusIcon } from "lucide-react";
import { Button, ChipGroup, DataTable, DataTableToolbar, EmptyState, type DataTableColumn } from "@srirealtime/ui";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { PERMS, useCan } from "../lib/access";
import { sk } from "../lib/queries";
import { CONTENT_STATUSES } from "../lib/content";
import type { CmsPageSummary, CmsPostSummary, ContentStatus } from "../lib/types";
import { ContentStatusPill, Thumb } from "./bits";
import { PagesIllustration } from "./illustrations";

type Row = CmsPageSummary & Partial<Pick<CmsPostSummary, "coverUrl" | "tags" | "excerpt">>;

const STATUS_ICON = { published: CheckCircle2Icon, draft: PencilLineIcon } as const;

/** Pages or blog posts: a server-paged table (search, status, sort by updated / published / title) linking to the editor. */
export function ContentList({ kind }: { kind: "page" | "post" }) {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <ContentTable kind={kind} />
    </React.Suspense>
  );
}

function ContentTable({ kind }: { kind: "page" | "post" }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const canEdit = useCan(PERMS.cms);
  const isPage = kind === "page";
  const base = isPage ? "pages" : "blog";
  const Icon = isPage ? FileTextIcon : NewspaperIcon;

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("site.common.status"),
          options: CONTENT_STATUSES.map((s) => ({ value: s, label: t(`site.status.${s}`), icon: STATUS_ICON[s] })),
        },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<Row>[]>(() => {
    const day = (iso: string | null) => (iso ? formatDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "—");
    return [
      {
        id: "title",
        header: t("site.content.col.title"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[28rem]",
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-3">
            {isPage ? (
              <span className="icon-chip size-9 shrink-0 rounded-xl text-primary">
                <FileTextIcon className="size-4" />
              </span>
            ) : (
              <Thumb src={r.coverUrl} className="size-10" />
            )}
            <ModuleLink to={`${base}/${r.id}`} className="min-w-0 truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
              {r.title}
            </ModuleLink>
          </div>
        ),
        cardCell: (r) => r.title,
      },
      {
        id: "address",
        header: t("site.content.col.address"),
        card: "subtitle",
        hideBelow: "md",
        className: "max-w-[16rem] truncate",
        cell: (r) => <span className="font-mono text-xs text-muted-foreground">{isPage ? `/${r.slug}` : `/blog/${r.slug}`}</span>,
      },
      ...(isPage
        ? []
        : [
            {
              id: "tags",
              header: t("site.posts.tags"),
              hideBelow: "lg",
              card: "meta",
              cell: (r) =>
                r.tags?.length ? (
                  <span className="flex flex-wrap gap-x-2 text-xs text-primary">
                    {r.tags.slice(0, 3).map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            } satisfies DataTableColumn<Row>,
          ]),
      {
        id: "status",
        header: t("site.common.status"),
        card: "right",
        cell: (r) => <ContentStatusPill status={r.status} />,
      },
      {
        id: "published",
        header: t("site.content.col.published"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "md",
        cell: (r) => <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{day(r.publishedAt)}</span>,
      },
      {
        id: "updated",
        header: t("site.content.col.updated"),
        sortable: true,
        sortDescFirst: true,
        card: "meta",
        cell: (r) => <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{day(r.updatedAt)}</span>,
        cardCell: (r) => t("site.common.updated", { date: formatDate(r.updatedAt, { day: "numeric", month: "short" }) }),
      },
    ];
  }, [t, formatDate, isPage, base]);

  const st = useServerTable<Row, typeof filters>({
    queryKey: isPage ? sk.pageList : sk.postList,
    path: isPage ? "/cms/pages" : "/cms/posts",
    columns,
    filters,
    defaultSort: "-updated",
    search: t(isPage ? "site.pages.search" : "site.posts.search"),
    storageKey: isPage ? "site-pages" : "site-posts",
  });

  const status = st.filters.status;
  const counts = st.facets?.status;
  const allCount = counts ? CONTENT_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0) : undefined;
  const filtered = st.table.activeFilterCount > 0;

  const add = canEdit ? (
    <Button asChild size="lg">
      <ModuleLink to={`${base}/new`}>
        <PlusIcon /> {t(isPage ? "site.pages.add" : "site.posts.add")}
      </ModuleLink>
    </Button>
  ) : null;

  return (
    <Page>
      <PageHeading
        icon={Icon}
        title={t(isPage ? "site.pages.title" : "site.posts.title")}
        description={allCount !== undefined && allCount > 0 ? t(isPage ? "site.pages.count" : "site.posts.count", { count: allCount }) : t(isPage ? "site.pages.subtitle" : "site.posts.subtitle")}
        actions={add}
      />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup<ContentStatus | "all" | "">
            size="sm"
            aria-label={t("site.common.status")}
            value={status.value.length === 0 ? "all" : status.value.length === 1 ? (status.value[0] as ContentStatus) : ""}
            onChange={(v) => status.set(v === "all" || v === "" ? [] : [v])}
            options={[
              { value: "all", label: t("site.common.all"), meta: allCount || undefined },
              ...CONTENT_STATUSES.map((s) => ({ value: s, label: t(`site.status.${s}`), meta: counts ? counts[s] || undefined : undefined })),
            ]}
          />
        }
      />
      <DataTable
        table={st.table}
        onRowClick={(r) => navigate(`${base}/${r.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<PagesIllustration />}
              icon={Icon}
              title={t(isPage ? "site.pages.emptyTitle" : "site.posts.emptyTitle")}
              description={t(isPage ? "site.pages.emptyBody" : "site.posts.emptyBody")}
              action={add ?? undefined}
            />
          )
        }
      />
    </Page>
  );
}
