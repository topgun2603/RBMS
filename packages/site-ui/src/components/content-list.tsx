"use client";

import * as React from "react";
import { ChevronRightIcon, FileTextIcon, NewspaperIcon, PlusIcon } from "lucide-react";
import { Button, Card, ChipGroup, cn, EmptyState, Skeleton, Stagger, StaggerItem } from "@srirealtime/ui";
import { ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useI18n } from "@srirealtime/web";
import { PERMS, useCan } from "../lib/access";
import { usePages, usePosts } from "../lib/queries";
import type { CmsPageSummary, CmsPostSummary, ContentStatus } from "../lib/types";
import { ContentStatusPill, Thumb } from "./bits";
import { PagesIllustration } from "./illustrations";

type Filter = "all" | ContentStatus;

/** Pages or blog posts: search, status chips, rows linking to the editor. */
export function ContentList({ kind }: { kind: "page" | "post" }) {
  const { t, formatDate } = useI18n();
  const canEdit = useCan(PERMS.cms);
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const debounced = useDebounced(q.trim(), 300);
  const f = { q: debounced || undefined, status: filter === "all" ? undefined : filter };
  const pages = usePages(f, kind === "page");
  const posts = usePosts(f, kind === "post");
  const list = kind === "page" ? pages : posts;
  const items = (list.data?.items ?? []) as (CmsPageSummary | CmsPostSummary)[];
  const base = kind === "page" ? "pages" : "blog";
  const Icon = kind === "page" ? FileTextIcon : NewspaperIcon;
  const filtered = !!debounced || filter !== "all";

  const add = canEdit ? (
    <Button asChild size="lg">
      <ModuleLink to={`${base}/new`}>
        <PlusIcon /> {t(kind === "page" ? "site.pages.add" : "site.posts.add")}
      </ModuleLink>
    </Button>
  ) : null;

  return (
    <Page className="max-w-4xl">
      <PageHeading icon={Icon} title={t(kind === "page" ? "site.pages.title" : "site.posts.title")} description={t(kind === "page" ? "site.pages.subtitle" : "site.posts.subtitle")} actions={add} />
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <SearchField value={q} onChange={setQ} placeholder={t(kind === "page" ? "site.pages.search" : "site.posts.search")} />
        <ChipGroup<Filter>
          value={filter}
          onChange={setFilter}
          aria-label={t("site.common.status")}
          options={[
            { value: "all", label: t("site.common.all") },
            { value: "published", label: t("site.status.published") },
            { value: "draft", label: t("site.status.draft") },
          ]}
        />
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Card className="gap-0 divide-y p-0">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="size-10 rounded-xl" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          illustration={filtered ? undefined : <PagesIllustration />}
          icon={Icon}
          title={filtered ? t("site.common.noMatch") : t(kind === "page" ? "site.pages.emptyTitle" : "site.posts.emptyTitle")}
          description={filtered ? undefined : t(kind === "page" ? "site.pages.emptyBody" : "site.posts.emptyBody")}
          action={filtered ? undefined : add}
        />
      ) : (
        <Card className={cn("gap-0 overflow-hidden p-0 transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <Stagger className="divide-y">
            {items.map((it) => {
              const post = kind === "post" ? (it as CmsPostSummary) : null;
              return (
                <StaggerItem key={it.id}>
                  <ModuleLink to={`${base}/${it.id}`} className="group flex items-center gap-3 px-4 py-3 outline-none hover:bg-accent/40 focus-visible:bg-accent/40">
                    {post ? (
                      <Thumb src={post.coverUrl} className="size-12" />
                    ) : (
                      <span className="icon-chip size-10 shrink-0 rounded-xl text-primary">
                        <FileTextIcon className="size-4" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium group-hover:text-primary">{it.title}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="font-mono">{kind === "page" ? `/${it.slug}` : `/blog/${it.slug}`}</span>
                        <span>· {t("site.common.updated", { date: formatDate(it.updatedAt, { day: "numeric", month: "short" }) })}</span>
                        {post?.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-primary">
                            #{tag}
                          </span>
                        ))}
                      </p>
                    </div>
                    <ContentStatusPill status={it.status} className="shrink-0" />
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </ModuleLink>
                </StaggerItem>
              );
            })}
          </Stagger>
        </Card>
      )}
    </Page>
  );
}
