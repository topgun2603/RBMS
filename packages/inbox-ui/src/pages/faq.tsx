"use client";

import * as React from "react";
import { BookOpenIcon, FolderIcon, Loader2Icon, PencilIcon, PlusIcon, ThumbsDownIcon, ThumbsUpIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  Card,
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
  Stagger,
  StaggerItem,
  StatusPill,
  Switch,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useI18n } from "@srirealtime/web";
import { useFaqArticleMutations, useFaqArticles, useFaqCategories, useFaqCategoryMutations } from "../lib/queries";
import type { FaqArticle, FaqCategory } from "../lib/types";

type StatusFilter = "" | "published" | "draft";
const ALL = "__all";
const NONE_CAT = "__none";

export default function FaqPage() {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("");
  const [cat, setCat] = React.useState<string>(ALL);
  const debounced = useDebounced(q.trim(), 300);
  const cats = useFaqCategories();
  const articles = useFaqArticles({ q: debounced, status, categoryId: cat !== ALL && cat !== NONE_CAT ? cat : undefined });
  const muts = useFaqArticleMutations();
  const [editCat, setEditCat] = React.useState<FaqCategory | "new" | null>(null);
  const items = (articles.data?.items ?? []).filter((a) => (cat === NONE_CAT ? !a.categoryId : true));
  const catName = (id: string | null) => cats.data?.find((c) => c.id === id)?.name ?? t("inbox.faq.uncategorised");
  const filtered = !!(debounced || status || cat !== ALL);

  const toggle = async (a: FaqArticle, on: boolean) => {
    try {
      await muts.publish.mutateAsync({ id: a.id, on });
      toast.success(on ? t("inbox.faq.publishedToast", { title: a.title }) : t("inbox.faq.unpublishedToast", { title: a.title }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const add = (
    <Button asChild size="lg">
      <ModuleLink to="faq/new">
        <PlusIcon /> {t("inbox.faq.new")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page>
      <PageHeading icon={BookOpenIcon} title={t("inbox.faq.title")} description={t("inbox.faq.subtitle")} actions={add} />
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
              {[{ id: ALL, name: t("inbox.faq.allCategories") }, ...(cats.data ?? []), { id: NONE_CAT, name: t("inbox.faq.uncategorised") }].map((c) => (
                <li key={c.id} className="group flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => setCat(c.id)}
                    aria-pressed={cat === c.id}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                      cat === c.id && "bg-primary/10 font-medium text-primary",
                    )}
                  >
                    <FolderIcon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{c.name}</span>
                  </button>
                  {"slug" in c && (
                    <Button variant="ghost" size="icon-sm" className="opacity-60 group-hover:opacity-100 max-lg:hidden" onClick={() => setEditCat(c as FaqCategory)} aria-label={t("inbox.faq.editCategory", { name: c.name })}>
                      <PencilIcon />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="grid min-w-0 content-start gap-3">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <SearchField value={q} onChange={setQ} placeholder={t("inbox.faq.search")} />
            <ChipGroup<StatusFilter>
              size="sm"
              aria-label={t("inbox.faq.status")}
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: t("inbox.common.all") },
                { value: "published", label: t("inbox.faq.published") },
                { value: "draft", label: t("inbox.faq.draft") },
              ]}
            />
          </div>
          {articles.isError ? (
            <QueryError error={articles.error} onRetry={() => void articles.refetch()} />
          ) : articles.isPending ? (
            <div className="grid gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={BookOpenIcon} title={filtered ? t("inbox.common.noMatch") : t("inbox.faq.emptyTitle")} description={filtered ? undefined : t("inbox.faq.emptyBody")} action={filtered ? undefined : add} />
          ) : (
            <Stagger className={cn("grid gap-2", articles.isPlaceholderData && "opacity-60")}>
              {items.map((a) => {
                const votes = a.helpfulYes + a.helpfulNo;
                return (
                  <StaggerItem key={a.id}>
                    <Card className="flex-row items-center gap-3 p-3 sm:p-4">
                      <ModuleLink to={`faq/${a.id}`} className="min-w-0 flex-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <p className="truncate font-medium hover:text-primary">{a.title}</p>
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
                          <span>{catName(a.categoryId)}</span>
                          <span className="font-mono">/{a.slug}</span>
                          <span className="inline-flex items-center gap-1" title={t("inbox.faq.helpful")}>
                            <ThumbsUpIcon className="size-3" aria-hidden />
                            <span className="sr-only">{t("inbox.faq.helpfulYes")}</span>
                            {a.helpfulYes}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <ThumbsDownIcon className="size-3" aria-hidden />
                            <span className="sr-only">{t("inbox.faq.helpfulNo")}</span>
                            {a.helpfulNo}
                          </span>
                          {votes > 0 && <span>{t("inbox.faq.helpfulPct", { pct: Math.round((a.helpfulYes / votes) * 100) })}</span>}
                        </p>
                      </ModuleLink>
                      <StatusPill tone={a.status === "published" ? "success" : "neutral"} className="max-sm:hidden">
                        {a.status === "published" ? t("inbox.faq.published") : t("inbox.faq.draft")}
                      </StatusPill>
                      <Switch checked={a.status === "published"} disabled={muts.publish.isPending} onCheckedChange={(on) => void toggle(a, on)} aria-label={t("inbox.faq.publishToggle", { title: a.title })} />
                    </Card>
                  </StaggerItem>
                );
              })}
            </Stagger>
          )}
        </div>
      </div>
      <CategoryDialog value={editCat} onClose={() => setEditCat(null)} />
    </Page>
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
