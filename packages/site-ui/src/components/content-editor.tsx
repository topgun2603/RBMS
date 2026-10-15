"use client";

import * as React from "react";
import {
  ExternalLinkIcon,
  EyeOffIcon,
  FileTextIcon,
  ImageIcon,
  Link2Icon,
  Loader2Icon,
  MoreVerticalIcon,
  NewspaperIcon,
  RocketIcon,
  Rows3Icon,
  Trash2Icon,
} from "lucide-react";
import { Button, cn, controlHeight, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, Label, Textarea, toast } from "@srirealtime/ui";
import { ApiError, ConfirmDialog, describeError, Page, PageHeading, useI18n, useModuleHref } from "@srirealtime/web";
import { PERMS, useCan } from "../lib/access";
import { checkBlocks, fromBlockForm, toBlockForm, type BlockForm } from "../lib/blocks";
import { CMS_LIMITS } from "../lib/content";
import { cleanSlugInput, slugify } from "../lib/format";
import { useDeletePage, useDeletePost, usePagePublish, usePostPublish, useSavePage, useSavePost } from "../lib/queries";
import { RESERVED_SLUGS } from "../lib/slug";
import { slugIssue, type SlugIssue } from "../lib/slug-check";
import { useStoreUrl } from "../lib/store-url";
import type { CmsPage, CmsPost } from "../lib/types";
import { BlockEditor } from "./block-editor";
import { ContentStatusPill, FieldError, Optional, ReadOnlyNote, SaveBar, Section, TextField } from "./bits";
import { ImageField } from "./image-field";
import { fromSeoForm, SeoPanel, toSeoForm, type SeoForm } from "./seo-panel";
import { TagInput } from "./tag-input";
import { useUnsavedGuard } from "./unsaved-guard";

type Kind = "page" | "post";

interface Draft {
  title: string;
  slug: string;
  blocks: BlockForm[];
  seo: SeoForm;
  excerpt: string;
  coverUrl: string;
  tags: string[];
  authorName: string;
}

function toDraft(item: CmsPage | CmsPost | null | undefined): Draft {
  const post = item as CmsPost | null | undefined;
  return {
    title: item?.title ?? "",
    slug: item?.slug ?? "",
    blocks: (item?.blocks ?? []).map((b, i) => toBlockForm(b, `b${i}`)),
    seo: toSeoForm(item?.seo),
    excerpt: post?.excerpt ?? "",
    coverUrl: post?.coverUrl ?? "",
    tags: post?.tags ?? [],
    authorName: post?.authorName ?? "",
  };
}

/** Comparable content (block keys don't count). */
const fingerprint = (d: Draft) => JSON.stringify({ ...d, blocks: d.blocks.map(fromBlockForm) });

/** Server slug errors → field reason: 409 = taken, 400 mentioning "reserved" = reserved, other 400 on slug = invalid. */
export function slugIssueFromError(err: unknown): SlugIssue | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 409) return "taken";
  if (err.status === 400) {
    if (/reserved/i.test(err.message) || (err.details as { slug?: string } | undefined)?.slug) return "reserved";
    if (/address|slug/i.test(err.message)) return "invalid";
  }
  return null;
}

/** Page or blog post editor: title, address, blocks, SEO (+ cover, excerpt, tags, author for posts), publish. */
export function ContentEditor({ kind, item }: { kind: Kind; item?: CmsPage | CmsPost }) {
  const { t, formatDate } = useI18n();
  const href = useModuleHref();
  const storeUrl = useStoreUrl();
  const canEdit = useCan(PERMS.cms);
  const isNew = !item;
  const listHref = kind === "page" ? "pages" : "blog";
  const savePage = useSavePage();
  const savePost = useSavePost();
  const pubPage = usePagePublish();
  const pubPost = usePostPublish();
  const delPage = useDeletePage();
  const delPost = useDeletePost();
  const save = kind === "page" ? savePage : savePost;
  const pub = kind === "page" ? pubPage : pubPost;

  const [server, setServer] = React.useState<CmsPage | CmsPost | null>(item ?? null);
  const [d, setD] = React.useState<Draft>(() => toDraft(item));
  const [baseline, setBaseline] = React.useState(() => fingerprint(toDraft(item)));
  const [showErrors, setShowErrors] = React.useState(false);
  const [slugServerIssue, setSlugServerIssue] = React.useState<SlugIssue | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const dirty = fingerprint(d) !== baseline;
  const busy = save.isPending || pub.isPending;
  const guard = useUnsavedGuard(dirty && !busy);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const blockCheck = React.useMemo(() => checkBlocks(d.blocks), [d.blocks]);
  const effectiveSlug = d.slug.trim() || slugify(d.title);
  const slugLocal = slugIssue(d.slug.trim());
  const slugProblem = slugLocal ?? slugServerIssue;
  const titleError = !d.title.trim() ? "required" : null;
  const path = kind === "page" ? `/${effectiveSlug}` : `/blog/${effectiveSlug}`;
  const live = server?.status === "published";

  const validate = () => {
    const problems = (titleError ? 1 : 0) + (slugLocal ? 1 : 0) + Object.keys(blockCheck.errors).length;
    if (problems) {
      setShowErrors(true);
      toast.error(t("site.editor.fixErrors", { count: problems }));
      const firstBad = d.blocks.find((b) => blockCheck.errors[b.key]);
      const target = titleError ? "ce-title" : slugLocal ? "ce-slug" : firstBad ? `ce-block-${firstBad.key}` : null;
      if (target) requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return false;
    }
    return true;
  };

  const body = () => {
    const blocks = blockCheck.blocks ?? [];
    const seo = fromSeoForm(d.seo);
    const base = { title: d.title.trim(), ...(d.slug.trim() ? { slug: d.slug.trim() } : {}), blocks };
    if (kind === "page") return isNew ? { ...base, ...(seo ? { seo } : {}) } : { ...base, seo };
    const post = {
      ...base,
      tags: d.tags,
      ...(isNew
        ? {
            ...(d.excerpt.trim() ? { excerpt: d.excerpt.trim() } : {}),
            ...(d.coverUrl.trim() ? { coverUrl: d.coverUrl.trim() } : {}),
            ...(d.authorName.trim() ? { authorName: d.authorName.trim() } : {}),
            ...(seo ? { seo } : {}),
          }
        : { excerpt: d.excerpt.trim() || null, coverUrl: d.coverUrl.trim() || null, authorName: d.authorName.trim() || null, seo }),
    };
    return post;
  };

  const doSave = async (): Promise<CmsPage | CmsPost | null> => {
    if (!validate()) return null;
    try {
      const saved = await save.mutateAsync({ id: server?.id, body: body() } as never);
      setSlugServerIssue(null);
      setShowErrors(false);
      if (isNew) {
        toast.success(t(kind === "page" ? "site.pages.created" : "site.posts.created", { name: saved.title }));
        guard.leave(href(`${listHref}/${saved.id}`), { replace: true });
        return saved;
      }
      setServer(saved);
      const next = toDraft(saved);
      setD(next);
      setBaseline(fingerprint(next));
      return saved;
    } catch (err) {
      const issue = slugIssueFromError(err);
      if (issue) {
        setSlugServerIssue(issue);
        setShowErrors(true);
        document.getElementById("ce-slug")?.focus();
        toast.error(t(`site.slug.${issue}`));
      } else toast.error(describeError(err, t));
      return null;
    }
  };

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const saved = await doSave();
    if (saved && !isNew) toast.success(t("site.editor.saved"));
  };

  const setLive = async (publish: boolean) => {
    let target = server;
    if (publish && (dirty || !target)) {
      target = await doSave();
      if (!target || isNew) return;
    }
    if (!target) return;
    try {
      const p = await pub.mutateAsync({ id: target.id, publish });
      setServer(p);
      toast.success(publish ? t("site.editor.publishedToast") : t("site.editor.unpublishedToast"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const Icon = kind === "page" ? FileTextIcon : NewspaperIcon;
  const errs = showErrors;

  return (
    <Page className="max-w-6xl pb-0">
      <PageHeading
        back={{ href: listHref, label: t(kind === "page" ? "site.nav.pages" : "site.nav.blog") }}
        icon={Icon}
        title={isNew ? t(kind === "page" ? "site.pages.newTitle" : "site.posts.newTitle") : server?.title}
        description={
          server ? (
            <span className="flex flex-wrap items-center gap-2">
              <ContentStatusPill status={server.status} />
              <span className="font-mono text-xs">{kind === "page" ? `/${server.slug}` : `/blog/${server.slug}`}</span>
              {server.publishedAt && live && <span className="text-xs">{t("site.editor.publishedOn", { date: formatDate(server.publishedAt) })}</span>}
            </span>
          ) : (
            t(kind === "page" ? "site.pages.newSubtitle" : "site.posts.newSubtitle")
          )
        }
        actions={
          server && (
            <>
              {live && storeUrl && (
                <Button asChild variant="outline" size="lg">
                  <a href={storeUrl(kind === "page" ? `/${server.slug}` : `/blog/${server.slug}`)} target="_blank" rel="noreferrer">
                    <ExternalLinkIcon /> {t("site.editor.viewOnStore")}
                  </a>
                </Button>
              )}
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-lg" aria-label={t("site.common.more")}>
                      <MoreVerticalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {live && (
                      <DropdownMenuItem className="h-10" onSelect={() => void setLive(false)}>
                        <EyeOffIcon /> {t("site.editor.unpublish")}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setDeleting(true)}>
                      <Trash2Icon /> {t("site.common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )
        }
      />
      {!canEdit && <ReadOnlyNote>{t("site.common.readOnlyCms")}</ReadOnlyNote>}

      <form onSubmit={onSubmit} noValidate className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
          <Section id="ce-details" icon={Icon} title={t("site.editor.details")}>
            <TextField id="ce-title" label={t("site.editor.title")} value={d.title} maxLength={CMS_LIMITS.title} disabled={!canEdit} error={errs ? titleError : null} inputClassName="text-base" onChange={(v) => set("title", v)} />
            <div className="grid content-start gap-2">
              <Label htmlFor="ce-slug">
                <Link2Icon className="size-3.5 text-muted-foreground" /> {t("site.editor.slug")}
                {isNew && <Optional />}
              </Label>
              <div className={cn("flex items-center overflow-hidden rounded-xl border border-input bg-card shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40", controlHeight())}>
                <span className="flex h-full shrink-0 items-center border-r bg-muted/50 px-3 font-mono text-xs text-muted-foreground">{kind === "page" ? "/" : "/blog/"}</span>
                <Input
                  id="ce-slug"
                  className="h-full rounded-none border-0 font-mono shadow-none focus-visible:ring-0"
                  value={d.slug}
                  placeholder={slugify(d.title) || undefined}
                  aria-invalid={!!slugProblem}
                  aria-describedby="ce-slug-hint"
                  disabled={!canEdit}
                  onChange={(e) => {
                    setSlugServerIssue(null);
                    set("slug", cleanSlugInput(e.target.value));
                  }}
                />
              </div>
              {slugProblem ? (
                <FieldError code={`site.slug.${slugProblem}`} id="ce-slug-hint" />
              ) : (
                <p id="ce-slug-hint" className="text-xs text-muted-foreground">
                  {storeUrl ? storeUrl(path) : path} · {t("site.slug.hint")}
                </p>
              )}
              {slugProblem === "reserved" && <p className="text-xs text-muted-foreground">{t("site.slug.reservedList", { list: [...RESERVED_SLUGS].join(", ") })}</p>}
              {!isNew && server && d.slug.trim() && d.slug.trim() !== server.slug && live && <p className="text-xs text-warning-ink">{t("site.slug.changeWarning")}</p>}
            </div>
            {kind === "post" && (
              <>
                <div className="grid content-start gap-2">
                  <Label htmlFor="ce-excerpt">
                    {t("site.posts.excerpt")}
                    <Optional />
                  </Label>
                  <Textarea id="ce-excerpt" aria-describedby="ce-excerpt-hint" rows={2} maxLength={500} value={d.excerpt} disabled={!canEdit} onChange={(e) => set("excerpt", e.target.value)} />
                  <p id="ce-excerpt-hint" className="text-xs text-muted-foreground">{t("site.posts.excerptHint")}</p>
                </div>
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  <div className="grid content-start gap-2">
                    <Label htmlFor="ce-tags">
                      {t("site.posts.tags")}
                      <Optional />
                    </Label>
                    <TagInput id="ce-tags" value={d.tags} onChange={(v) => set("tags", v)} max={CMS_LIMITS.tags} disabled={!canEdit} placeholder={t("site.posts.tagsPlaceholder")} />
                  </div>
                  <TextField id="ce-author" label={t("site.posts.author")} optional value={d.authorName} maxLength={80} disabled={!canEdit} onChange={(v) => set("authorName", v)} />
                </div>
              </>
            )}
          </Section>

          {kind === "post" && (
            <Section id="ce-cover" icon={ImageIcon} title={t("site.posts.cover")} description={t("site.posts.coverHint")}>
              <ImageField value={d.coverUrl} onChange={(v) => set("coverUrl", v)} aspect="aspect-[16/9]" disabled={!canEdit} />
            </Section>
          )}

          <Section id="ce-content" icon={Rows3Icon} tone="text-info-ink" title={t("site.editor.content")} description={t("site.editor.contentHint")}>
            <BlockEditor value={d.blocks} onChange={(v) => set("blocks", v)} errors={errs ? blockCheck.errors : {}} disabled={!canEdit} idPrefix="ce" />
          </Section>
        </div>

        <aside className="grid gap-5 lg:sticky lg:top-20">
          <SeoPanel
            idPrefix="ce"
            value={d.seo}
            onChange={(v) => set("seo", v)}
            fallbackTitle={d.title}
            fallbackDescription={kind === "post" ? d.excerpt : undefined}
            url={storeUrl ? storeUrl(path) : path}
            disabled={!canEdit}
          />
        </aside>

        {canEdit && (
          <div className="lg:col-span-2">
            <SaveBar
              dirty={dirty || isNew}
              saving={save.isPending}
              status={live ? t("site.editor.liveStatus") : t("site.editor.draftStatus")}
              saveLabel={isNew ? t("site.editor.create") : live ? t("site.editor.saveLive") : t("site.editor.saveDraft")}
              onDiscard={isNew ? undefined : () => setD(toDraft(server))}
              extra={
                // A published page/post has no separate draft: saving updates the live page.
                !isNew && !live ? (
                  <Button type="button" size="lg" onClick={() => void setLive(true)} disabled={busy}>
                    {pub.isPending ? <Loader2Icon className="animate-spin" /> : <RocketIcon />}
                    {dirty ? t("site.editor.saveAndPublish") : t("site.editor.publish")}
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
      </form>

      {guard.dialog}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t(kind === "page" ? "site.pages.deleteTitle" : "site.posts.deleteTitle", { name: server?.title ?? "" })}
        description={t("site.editor.deleteBody")}
        confirmLabel={t("site.common.delete")}
        onConfirm={async () => {
          if (!server) return;
          try {
            await (kind === "page" ? delPage : delPost).mutateAsync(server.id);
            toast.success(t("site.editor.deleted", { name: server.title }));
            guard.leave(href(listHref), { replace: true });
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Page>
  );
}
