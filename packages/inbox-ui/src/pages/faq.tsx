"use client";

import * as React from "react";
import { BookOpenIcon, FolderIcon, Loader2Icon, PencilIcon, PlusIcon, ThumbsDownIcon, ThumbsUpIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  ChipGroup,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  DataTable,
  DataTableToolbar,
  StatusPill,
  Switch,
  Textarea,
  toast,
  type DataTableColumn,
} from "@rbms/ui";
import {
  ConfirmDialog,
  describeError,
  ModuleLink,
  Page,
  PageHeading,
  QueryError,
  useI18n,
  useModuleNavigate,
  useQueryParams,
  useServerTable,
  type ServerFilterDefs,
} from "@rbms/web";
import { qk, useFaqArticleMutations, useFaqCategories, useFaqCategoryMutations } from "../lib/queries";
import type { FaqArticleListItem, FaqCategory } from "../lib/types";

const STATUSES = ["published", "draft"] as const;
const ALL = "all";
/** The API's "no category" value (`categoryId=none`). */
const NONE_CAT = "none";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function FaqPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <FaqManager />
    </React.Suspense>
  );
}

function FaqManager() {
  const { t, formatDate, formatNumber } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const cats = useFaqCategories();
  const muts = useFaqArticleMutations();
  const [editCat, setEditCat] = React.useState<FaqCategory | "new" | null>(null);
  const catList = React.useMemo(() => cats.data ?? [], [cats.data]);
  const catName = React.useCallback((id: string | null) => catList.find((c) => c.id === id)?.name ?? t("inbox.faq.uncategorised"), [catList, t]);

  const publish = muts.publish;
  const toggle = React.useCallback(
    async (a: FaqArticleListItem, on: boolean) => {
      try {
        await publish.mutateAsync({ id: a.id, on });
        toast.success(on ? t("inbox.faq.publishedToast", { title: a.title }) : t("inbox.faq.unpublishedToast", { title: a.title }));
      } catch (err) {
        toast.error(describeError(err, t));
      }
    },
    [publish, t],
  );
  const publishing = publish.isPending;

  // A category id from a shared link stays selected even before the categories have loaded.
  const linkedCats = React.useMemo(() => (params?.get("categoryId") ?? "").split(",").filter((v) => UUID_RE.test(v)), [params]);
  const filters = React.useMemo(
    () =>
      ({
        // Both are driven by the category list and the status pills rather than toolbar buttons.
        categoryId: {
          kind: "options",
          label: t("inbox.faq.category"),
          single: true,
          hidden: true,
          options: [
            ...catList.map((c) => ({ value: c.id, label: c.name })),
            ...linkedCats.filter((id) => !catList.some((c) => c.id === id)).map((id) => ({ value: id, label: t("inbox.faq.category") })),
            { value: NONE_CAT, label: t("inbox.faq.uncategorised") },
          ],
        },
        status: {
          kind: "options",
          label: t("inbox.faq.status"),
          single: true,
          hidden: true,
          options: STATUSES.map((s) => ({ value: s, label: t(`inbox.faq.${s}`) })),
        },
      }) satisfies ServerFilterDefs,
    [t, catList, linkedCats],
  );

  const columns = React.useMemo<DataTableColumn<FaqArticleListItem>[]>(
    () => [
      {
        id: "title",
        header: t("inbox.faq.articleTitle"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[28rem]",
        cell: (a) => (
          <div className="grid min-w-0">
            <ModuleLink to={`faq/${a.id}`} className="truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
              {a.title}
            </ModuleLink>
            <span className="truncate font-mono text-xs text-muted-foreground">/{a.slug}</span>
          </div>
        ),
        cardCell: (a) => a.title,
      },
      {
        id: "category",
        header: t("inbox.faq.category"),
        hideBelow: "md",
        card: "subtitle",
        cell: (a) => <span className={cn(!a.categoryId && "text-muted-foreground")}>{catName(a.categoryId)}</span>,
        cardCell: (a) => catName(a.categoryId),
      },
      { id: "helpful", header: t("inbox.faq.helpfulYes"), sortable: true, sortDescFirst: true, card: "meta", cell: (a) => <Helpful a={a} /> },
      {
        id: "updated",
        header: t("inbox.faq.col.updated"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "lg",
        cell: (a) => <span className="text-muted-foreground tabular-nums">{formatDate(a.updatedAt, { day: "numeric", month: "short", year: "numeric" })}</span>,
      },
      {
        id: "status",
        header: t("inbox.faq.col.status"),
        sortable: true,
        hideable: false,
        card: "right",
        cell: (a) => (
          <span className="flex items-center gap-2">
            <Switch checked={a.status === "published"} disabled={publishing} onCheckedChange={(on) => void toggle(a, on)} aria-label={t("inbox.faq.publishToggle", { title: a.title })} />
            <StatusPill tone={a.status === "published" ? "success" : "neutral"} className="max-sm:hidden">
              {a.status === "published" ? t("inbox.faq.published") : t("inbox.faq.draft")}
            </StatusPill>
          </span>
        ),
      },
    ],
    [t, formatDate, catName, publishing, toggle],
  );

  const st = useServerTable<FaqArticleListItem, typeof filters>({
    queryKey: qk.faqArticleTable,
    path: "/support/faq/articles",
    columns,
    filters,
    defaultSort: "order",
    search: t("inbox.faq.search"),
    storageKey: "inbox-faq",
  });

  const cat = st.filters.categoryId;
  const status = st.filters.status;
  const catCounts = st.facets?.category;
  const statusCounts = st.facets?.status;
  const sum = (c?: Record<string, number>) => (c ? Object.values(c).reduce((a, b) => a + b, 0) : undefined);
  const count = (n: number | undefined) => (n !== undefined ? formatNumber(n) : undefined);
  const selectedCat = cat.value[0] ?? ALL;
  const filtered = st.table.activeFilterCount > 0 || cat.value.length > 0 || status.value.length > 0;
  const catItems = [
    { id: ALL, name: t("inbox.faq.allCategories"), n: sum(catCounts), category: null as FaqCategory | null },
    ...catList.map((c) => ({ id: c.id, name: c.name, n: catCounts ? (catCounts[c.id] ?? 0) : undefined, category: c as FaqCategory | null })),
    { id: NONE_CAT, name: t("inbox.faq.uncategorised"), n: catCounts ? (catCounts[NONE_CAT] ?? 0) : undefined, category: null as FaqCategory | null },
  ];

  const add = (
    <Button asChild size="lg">
      <ModuleLink to="faq/new">
        <PlusIcon /> {t("inbox.faq.new")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page>
      <PageHeading
        icon={BookOpenIcon}
        title={t("inbox.faq.title")}
        description={st.total !== undefined && st.total > 0 && !filtered ? t("inbox.faq.count", { count: st.total }) : t("inbox.faq.subtitle")}
        actions={add}
      />
      <div className="grid gap-section lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="grid content-start gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("inbox.faq.categories")}</h2>
            <Button variant="ghost" size="icon-sm" onClick={() => setEditCat("new")} aria-label={t("inbox.faq.newCategory")}>
              <PlusIcon />
            </Button>
          </div>
          {cats.isError ? (
            <QueryError compact error={cats.error} onRetry={() => void cats.refetch()} />
          ) : cats.isPending ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : (
            <ul className="flex gap-1 overflow-x-auto pb-1 lg:grid lg:overflow-visible" aria-label={t("inbox.faq.categories")}>
              {catItems.map((c) => (
                <li key={c.id} className="group flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => cat.set(c.id === ALL ? [] : [c.id])}
                    aria-pressed={selectedCat === c.id}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                      selectedCat === c.id && "bg-primary/10 font-medium text-primary",
                    )}
                  >
                    <FolderIcon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{c.name}</span>
                    {c.n !== undefined && <span className="ml-auto pl-1 text-xs text-muted-foreground tabular-nums">{formatNumber(c.n)}</span>}
                  </button>
                  {c.category && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="opacity-60 group-hover:opacity-100 max-lg:hidden"
                      onClick={() => setEditCat(c.category)}
                      aria-label={t("inbox.faq.editCategory", { name: c.name })}
                    >
                      <PencilIcon />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="min-w-0">
          <DataTableToolbar
            table={st.table}
            quickFilters={
              <ChipGroup
                size="sm"
                aria-label={t("inbox.faq.status")}
                value={status.value[0] ?? ALL}
                onChange={(v) => status.set(v === ALL ? [] : [v])}
                options={[
                  { value: ALL, label: t("inbox.common.all"), meta: count(sum(statusCounts)) },
                  ...STATUSES.map((s) => ({ value: s as string, label: t(`inbox.faq.${s}`), meta: count(statusCounts ? (statusCounts[s] ?? 0) : undefined) })),
                ]}
              />
            }
          />
          <DataTable
            table={st.table}
            onRowClick={(a) => navigate(`faq/${a.id}`)}
            empty={
              filtered ? undefined : (
                <EmptyState className="border-0 bg-transparent" icon={BookOpenIcon} title={t("inbox.faq.emptyTitle")} description={t("inbox.faq.emptyBody")} action={add} />
              )
            }
          />
        </div>
      </div>
      <CategoryDialog value={editCat} onClose={() => setEditCat(null)} />
    </Page>
  );
}

function Helpful({ a }: { a: FaqArticleListItem }) {
  const { t } = useI18n();
  const votes = a.helpfulYes + a.helpfulNo;
  return (
    <span className="inline-flex items-center gap-3 text-sm text-muted-foreground tabular-nums" title={t("inbox.faq.helpful")}>
      <span className="inline-flex items-center gap-1">
        <ThumbsUpIcon className="size-3.5" aria-hidden />
        <span className="sr-only">{t("inbox.faq.helpfulYes")}</span>
        {a.helpfulYes}
      </span>
      <span className="inline-flex items-center gap-1">
        <ThumbsDownIcon className="size-3.5" aria-hidden />
        <span className="sr-only">{t("inbox.faq.helpfulNo")}</span>
        {a.helpfulNo}
      </span>
      {votes > 0 && <span className="text-xs" title={t("inbox.faq.helpfulPct", { pct: Math.round((a.helpfulYes / votes) * 100) })}>{Math.round((a.helpfulYes / votes) * 100)}%</span>}
    </span>
  );
}

function CategoryDialog({ value, onClose }: { value: FaqCategory | "new" | null; onClose: () => void }) {
  const { t } = useI18n();
  const m = useFaqCategoryMutations();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [tried, setTried] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const existing = value && value !== "new" ? value : null;
  React.useEffect(() => {
    setName(existing?.name ?? "");
    setDescription(existing?.description ?? "");
    setTried(false);
  }, [value, existing]);
  const busy = m.create.isPending || m.update.isPending;
  const save = async () => {
    setTried(true);
    if (!name.trim()) return;
    try {
      if (existing) await m.update.mutateAsync({ id: existing.id, name: name.trim(), description: description.trim() || null });
      else await m.create.mutateAsync({ name: name.trim(), description: description.trim() || null });
      toast.success(t("inbox.faq.categorySaved"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <>
      <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{existing ? t("inbox.faq.editCategory", { name: existing.name }) : t("inbox.faq.newCategory")}</DialogTitle>
            <DialogDescription>{t("inbox.faq.categoryHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field invalid={tried && !name.trim()}>
              <FieldLabel>{t("inbox.faq.categoryName")}</FieldLabel>
              <FieldControl>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
              </FieldControl>
              <FieldError>{tried && !name.trim() ? t("inbox.tpl.required") : null}</FieldError>
            </Field>
            <Field>
              <FieldLabel optional={t("inbox.common.optional")}>{t("inbox.faq.categoryDescription")}</FieldLabel>
              <FieldControl>
                <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
              </FieldControl>
            </Field>
            <DialogFooter className="gap-2">
              {existing && (
                <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => setConfirm(true)}>
                  <Trash2Icon /> {t("inbox.common.delete")}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                {t("inbox.common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2Icon className="animate-spin" />}
                {t("inbox.common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("inbox.faq.deleteCategoryTitle")}
        description={t("inbox.faq.deleteCategoryBody")}
        confirmLabel={t("inbox.common.delete")}
        onConfirm={async () => {
          try {
            await m.remove.mutateAsync(existing!.id);
            onClose();
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </>
  );
}
