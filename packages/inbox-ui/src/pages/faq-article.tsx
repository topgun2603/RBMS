"use client";

import * as React from "react";
import { BookOpenIcon, EyeIcon, Loader2Icon, PencilLineIcon, SaveIcon, SearchIcon, ThumbsDownIcon, ThumbsUpIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  cn,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, Page, PageHeading, QueryError, useI18n, useModuleNavigate, useRouteParams } from "@srirealtime/web";
import { Section } from "../components/bits";
import { Markdown } from "../components/markdown";
import { useFaqArticle, useFaqArticleMutations, useFaqCategories } from "../lib/queries";
import type { FaqArticle } from "../lib/types";

const NONE = "__none";

/** Same rule as the server's slugify for Latin titles; empty for Tamil-only titles (the server then picks one). */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

interface Draft {
  title: string;
  slug: string;
  slugTouched: boolean;
  body: string;
  categoryId: string;
  sort: string;
  seoTitle: string;
  seoDescription: string;
}

const fromArticle = (a: FaqArticle | undefined): Draft => ({
  title: a?.title ?? "",
  slug: a?.slug ?? "",
  slugTouched: !!a,
  body: a?.body ?? "",
  categoryId: a?.categoryId ?? NONE,
  sort: String(a?.sort ?? 0),
  seoTitle: a?.seo?.title ?? "",
  seoDescription: a?.seo?.description ?? "",
});

export default function FaqArticlePage() {
  const { id } = useRouteParams<{ id?: string }>();
  const existing = id && id !== "new" ? id : null;
  const article = useFaqArticle(existing);
  if (existing && article.isError) {
    return (
      <Page>
        <QueryError error={article.error} onRetry={() => void article.refetch()} />
      </Page>
    );
  }
  if (existing && !article.data) {
    return (
      <Page>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-96 rounded-2xl" />
      </Page>
    );
  }
  return <Editor key={article.data?.id ?? "new"} article={article.data} />;
}

function Editor({ article }: { article: FaqArticle | undefined }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const cats = useFaqCategories();
  const m = useFaqArticleMutations();
  const [d, setD] = React.useState<Draft>(() => fromArticle(article));
  const [tried, setTried] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [view, setView] = React.useState<"write" | "preview">("write");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const dirty = JSON.stringify(d) !== JSON.stringify(fromArticle(article));
  const published = article?.status === "published";
  const slugOk = !d.slug || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug);
  const errors = { title: d.title.trim().length < 3 ? t("inbox.faq.err.title") : null, slug: slugOk ? null : t("inbox.faq.err.slug") };
  const busy = m.create.isPending || m.update.isPending;

  const save = async (status?: "published") => {
    setTried(true);
    if (errors.title || errors.slug) return;
    const body = {
      title: d.title.trim(),
      slug: d.slug.trim() || null,
      body: d.body,
      categoryId: d.categoryId === NONE ? null : d.categoryId,
      sort: Number(d.sort) || 0,
      seo: d.seoTitle.trim() || d.seoDescription.trim() ? { title: d.seoTitle.trim() || undefined, description: d.seoDescription.trim() || undefined } : null,
      ...(status ? { status } : {}),
    };
    try {
      if (article) {
        await m.update.mutateAsync({ id: article.id, ...body });
        toast.success(t("inbox.faq.saved"));
      } else {
        const a = await m.create.mutateAsync(body);
        toast.success(status ? t("inbox.faq.publishedToast", { title: a.title }) : t("inbox.faq.saved"));
        navigate(`faq/${a.id}`, { replace: true });
      }
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const votes = (article?.helpfulYes ?? 0) + (article?.helpfulNo ?? 0);

  const editor = (
    <Field>
      <FieldLabel>{t("inbox.faq.body")}</FieldLabel>
      <FieldControl>
        <Textarea value={d.body} onChange={(e) => set("body", e.target.value)} rows={18} maxLength={20_000} className="min-h-80 font-mono text-sm leading-6" />
      </FieldControl>
      <FieldHint>{t("inbox.faq.markdownHint")}</FieldHint>
    </Field>
  );
  const preview = (
    <div className="min-h-80 rounded-xl border bg-card p-4">
      <p role="heading" aria-level={2} className="mb-3 font-heading text-lg font-semibold">
        {d.title || t("inbox.faq.untitled")}
      </p>
      {d.body.trim() ? <Markdown source={d.body} /> : <p className="text-sm text-muted-foreground">{t("inbox.faq.nothingYet")}</p>}
    </div>
  );

  return (
    <Page>
      <PageHeading
        icon={BookOpenIcon}
        back={{ href: "faq", label: t("inbox.faq.title") }}
        title={article ? article.title : t("inbox.faq.new")}
        description={article ? (article.publishedAt ? t("inbox.faq.publishedOn", { date: formatDate(article.publishedAt, { dateStyle: "medium" }) }) : t("inbox.faq.notPublished")) : t("inbox.faq.newBody")}
        actions={
          <>
            {article && (
              <StatusPill tone={published ? "success" : "neutral"} size="md">
                {published ? t("inbox.faq.published") : t("inbox.faq.draft")}
              </StatusPill>
            )}
            {article && (
              <Button variant="outline" size="lg" onClick={() => setConfirm(true)} aria-label={t("inbox.common.delete")}>
                <Trash2Icon />
              </Button>
            )}
            {!article && (
              <Button variant="outline" size="lg" onClick={() => void save("published")} disabled={busy}>
                {t("inbox.faq.saveAndPublish")}
              </Button>
            )}
            <Button size="lg" onClick={() => void save()} disabled={busy || (!!article && !dirty)}>
              {busy ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
              {t("inbox.common.save")}
            </Button>
          </>
        }
      />

      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid min-w-0 content-start gap-4">
          <Section icon={PencilLineIcon} title={t("inbox.faq.content")}>
            <Field invalid={tried && !!errors.title}>
              <FieldLabel>{t("inbox.faq.articleTitle")}</FieldLabel>
              <FieldControl>
                <Input
                  value={d.title}
                  maxLength={200}
                  onChange={(e) => setD((p) => ({ ...p, title: e.target.value, ...(p.slugTouched ? {} : { slug: slugify(e.target.value) }) }))}
                  autoFocus={!article}
                />
              </FieldControl>
              <FieldError>{tried ? errors.title : null}</FieldError>
            </Field>
            {/* Side by side from xl; tabs below that. */}
            <div className="hidden gap-4 xl:grid xl:grid-cols-2">
              {editor}
              <div className="grid content-start gap-2">
                <p className="flex min-h-5 items-end text-sm font-medium">{t("inbox.faq.preview")}</p>
                {preview}
              </div>
            </div>
            <Tabs value={view} onValueChange={(v) => setView(v as "write" | "preview")} className="xl:hidden">
              <TabsList>
                <TabsTrigger value="write">
                  <PencilLineIcon /> {t("inbox.faq.write")}
                </TabsTrigger>
                <TabsTrigger value="preview">
                  <EyeIcon /> {t("inbox.faq.preview")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="write" className="mt-3">
                {editor}
              </TabsContent>
              <TabsContent value="preview" className="mt-3">
                {preview}
              </TabsContent>
            </Tabs>
          </Section>

          <Section icon={SearchIcon} title={t("inbox.faq.seo")} description={t("inbox.faq.seoHint")}>
            <Field>
              <FieldLabel optional={t("inbox.common.optional")} aside={<span className="tabular-nums">{d.seoTitle.length}/70</span>}>
                {t("inbox.faq.seoTitle")}
              </FieldLabel>
              <FieldControl>
                <Input value={d.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} maxLength={70} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel optional={t("inbox.common.optional")} aside={<span className="tabular-nums">{d.seoDescription.length}/320</span>}>
                {t("inbox.faq.seoDescription")}
              </FieldLabel>
              <FieldControl>
                <Textarea rows={3} value={d.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} maxLength={320} />
              </FieldControl>
            </Field>
          </Section>
        </div>

        <aside className="grid content-start gap-section">
          <Section icon={BookOpenIcon} title={t("inbox.faq.settings")}>
            {article && (
              <Field>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel>{t("inbox.faq.published")}</FieldLabel>
                  <FieldControl>
                    <Switch
                      checked={published}
                      disabled={m.publish.isPending}
                      onCheckedChange={(on) =>
                        m.publish.mutate(
                          { id: article.id, on },
                          {
                            onSuccess: () => toast.success(on ? t("inbox.faq.publishedToast", { title: article.title }) : t("inbox.faq.unpublishedToast", { title: article.title })),
                            onError: (err) => toast.error(describeError(err, t)),
                          },
                        )
                      }
                    />
                  </FieldControl>
                </div>
                <FieldHint>{t("inbox.faq.publishHint")}</FieldHint>
              </Field>
            )}
            <Field>
              <FieldLabel>{t("inbox.faq.category")}</FieldLabel>
              <Select value={d.categoryId} onValueChange={(v) => set("categoryId", v)}>
                <FieldControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  <SelectItem value={NONE}>{t("inbox.faq.uncategorised")}</SelectItem>
                  {(cats.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field invalid={tried && !!errors.slug}>
              <FieldLabel optional={t("inbox.common.optional")}>{t("inbox.faq.slug")}</FieldLabel>
              <FieldControl>
                <InputGroup>
                  <InputGroupAddon>/</InputGroupAddon>
                  <InputGroupInput value={d.slug} onChange={(e) => setD((p) => ({ ...p, slug: e.target.value.toLowerCase(), slugTouched: true }))} maxLength={80} className="font-mono" />
                </InputGroup>
              </FieldControl>
              <FieldHint>{t("inbox.faq.slugHint")}</FieldHint>
              <FieldError>{tried ? errors.slug : null}</FieldError>
            </Field>
            <FieldRow cols={1}>
              <Field>
                <FieldLabel>{t("inbox.faq.sort")}</FieldLabel>
                <FieldControl>
                  <Input inputMode="numeric" value={d.sort} onChange={(e) => set("sort", e.target.value.replace(/\D/g, ""))} />
                </FieldControl>
                <FieldHint>{t("inbox.faq.sortHint")}</FieldHint>
              </Field>
            </FieldRow>
          </Section>
          {article && (
            <Section icon={ThumbsUpIcon} title={t("inbox.faq.helpful")}>
              <div className="flex items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 text-success-ink">
                  <ThumbsUpIcon className="size-4" aria-hidden /> {t("inbox.faq.yesCount", { count: article.helpfulYes })}
                </span>
                <span className="inline-flex items-center gap-1.5 text-danger-ink">
                  <ThumbsDownIcon className="size-4" aria-hidden /> {t("inbox.faq.noCount", { count: article.helpfulNo })}
                </span>
              </div>
              {votes > 0 ? (
                <div className="h-2 overflow-hidden rounded-full bg-destructive/30" role="meter" aria-valuemin={0} aria-valuemax={votes} aria-valuenow={article.helpfulYes} aria-label={t("inbox.faq.helpful")}>
                  <div className={cn("h-full rounded-full bg-success")} style={{ width: `${(article.helpfulYes / votes) * 100}%` }} />
                </div>
              ) : (
                <p className="text-meta text-muted-foreground">{t("inbox.faq.noVotes")}</p>
              )}
            </Section>
          )}
        </aside>
      </div>

      {article && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t("inbox.faq.deleteTitle")}
          description={t("inbox.faq.deleteBody", { title: article.title })}
          confirmLabel={t("inbox.common.delete")}
          onConfirm={async () => {
            try {
              await m.remove.mutateAsync(article.id);
              navigate("faq", { replace: true });
            } catch (err) {
              toast.error(describeError(err, t));
              throw err;
            }
          }}
        />
      )}
    </Page>
  );
}
