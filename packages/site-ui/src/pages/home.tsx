"use client";

import * as React from "react";
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  HomeIcon,
  LayoutTemplateIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PlusIcon,
  RocketIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  motion,
  Skeleton,
  StatusPill,
  toast,
} from "@srirealtime/ui";
import { describeError, Page, PageHeading, QueryError, useI18n, useOptionalShop, useTenantSlug, type Translator } from "@srirealtime/web";
import { SaveBar, ReadOnlyNote } from "../components/bits";
import { HomePreview } from "../components/home/home-preview";
import { SectionFields, sectionSummary } from "../components/home/section-forms";
import { SectionGallery } from "../components/home/section-gallery";
import { SECTION_ICONS } from "../components/home/section-meta";
import { usePreviewLookups } from "../components/home/use-preview-lookups";
import { fromSeoForm, SeoPanel, toSeoForm, type SeoForm } from "../components/seo-panel";
import { useDragSort } from "../components/sortable";
import { useUnsavedGuard } from "../components/unsaved-guard";
import { PERMS, useCan } from "../lib/access";
import { CMS_LIMITS, type HomeSectionType } from "../lib/content";
import { flagHidden, itemsFromSections, sectionsFromItems, type EditorItem } from "../lib/hidden";
import { useHome, useHomePreview, usePublishHome, useSaveHome } from "../lib/queries";
import { checkSection, duplicateSectionForm, newSectionForm, resolvePreview, type SectionSamples } from "../lib/sections";
import { useStoreUrl } from "../lib/store-url";
import type { StaffHome } from "../lib/types";

export default function HomeEditorPage() {
  const { t } = useI18n();
  const home = useHome();
  const slug = useTenantSlug();
  if (home.isError)
    return (
      <Page className="max-w-3xl">
        <PageHeading icon={HomeIcon} title={t("site.home.title")} />
        <QueryError error={home.error} onRetry={() => void home.refetch()} />
      </Page>
    );
  if (!home.data || slug === undefined)
    return (
      <Page wide>
        <Skeleton className="mb-5 h-10 w-64" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="grid gap-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-[28rem] w-full rounded-2xl" />
        </div>
      </Page>
    );
  return <HomeEditor initial={home.data} slug={slug} />;
}

const samplesFrom = (t: Translator, shop: string): SectionSamples => ({
  heroHeading: t("site.samples.heroHeading", { shop }),
  heroSubheading: t("site.samples.heroSubheading"),
  shopNow: t("site.samples.shopNow"),
  categoriesTitle: t("site.samples.categoriesTitle"),
  productsTitle: t("site.samples.productsTitle"),
  textHeading: t("site.samples.textHeading"),
  textBody: t("site.samples.textBody", { shop }),
  imageTextHeading: t("site.samples.imageTextHeading"),
  testimonialsTitle: t("site.samples.testimonialsTitle"),
  testimonialQuote: t("site.samples.testimonialQuote"),
  testimonialName: t("site.samples.testimonialName"),
  uspFreeShipping: t("site.samples.uspFreeShipping"),
  uspFreeShippingText: t("site.samples.uspFreeShippingText"),
  uspCod: t("site.samples.uspCod"),
  uspCodText: t("site.samples.uspCodText"),
  uspReturns: t("site.samples.uspReturns"),
  uspReturnsText: t("site.samples.uspReturnsText"),
  newsletterHeading: t("site.samples.newsletterHeading"),
  newsletterText: t("site.samples.newsletterText"),
});

const STARTER: HomeSectionType[] = ["hero", "categories", "usp", "testimonials", "newsletter"];

function snapshot(items: EditorItem[], seo: SeoForm) {
  return JSON.stringify({ sections: sectionsFromItems(items), seo: fromSeoForm(seo) });
}

function HomeEditor({ initial, slug }: { initial: StaffHome; slug: string | null }) {
  const { t, formatDate } = useI18n();
  const shop = useOptionalShop();
  const shopName = shop?.shopName ?? slug ?? "";
  const canEdit = useCan(PERMS.cms);
  const storeUrl = useStoreUrl();
  const save = useSaveHome();
  const publish = usePublishHome();

  const keySeq = React.useRef(0);
  const nextKey = React.useCallback(() => `k${keySeq.current++}`, []);
  const [server, setServer] = React.useState(initial);
  const [items, setItems] = React.useState<EditorItem[]>(() => itemsFromSections((initial.draft ?? initial.published)?.sections ?? [], nextKey));
  const [seo, setSeo] = React.useState<SeoForm>(() => toSeoForm((initial.draft ?? initial.published)?.seo));
  const [baseline, setBaseline] = React.useState(() => snapshot(items, seo));
  const [open, setOpen] = React.useState<string | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);
  const [gallery, setGallery] = React.useState<{ at: number } | null>(null);
  const [device, setDevice] = React.useState<"phone" | "desktop">("phone");
  const [armed, setArmed] = React.useState<string | null>(null);

  const current = snapshot(items, seo);
  const dirty = current !== baseline;
  const busy = save.isPending || publish.isPending;
  const guard = useUnsavedGuard(dirty && !busy);

  const checks = React.useMemo(() => new Map(items.map((it) => [it.key, checkSection(it.form)])), [items]);
  // Hidden sections are saved too, so they must be valid as well.
  const invalid = items.filter((it) => !checks.get(it.key)?.ok);
  const forms = React.useMemo(() => items.map((i) => i.form), [items]);

  // Preview: the server's exact rendering of the saved draft when nothing is unsaved, otherwise a local approximation.
  const serverPreview = useHomePreview(!dirty && !!server.draft);
  const { lookups, loading: lookupsLoading } = usePreviewLookups(forms);
  const exact = !dirty && !!server.draft && !!serverPreview.data;
  // Hidden sections show in the preview too, dimmed (the server preview flags them the same way).
  const previewSections = exact ? serverPreview.data!.sections : flagHidden(resolvePreview(forms, lookups), items);
  const openForm = items.find((i) => i.key === open)?.form;

  const sort = useDragSort(items, (i) => i.key, setItems);
  const patch = (key: string, p: Partial<EditorItem>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));
  const full = items.length >= CMS_LIMITS.sections;

  const addSection = (type: HomeSectionType, at: number) => {
    const form = newSectionForm(type, samplesFrom(t, shopName));
    const item: EditorItem = { key: nextKey(), hidden: false, form };
    setItems((list) => {
      const next = [...list];
      next.splice(at, 0, item);
      return next;
    });
    setOpen(item.key);
    requestAnimationFrame(() => document.getElementById(`sec-${item.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const startWithTemplate = () => {
    const s = samplesFrom(t, shopName);
    setItems(STARTER.map((type) => ({ key: nextKey(), hidden: false, form: newSectionForm(type, s) })));
    toast.success(t("site.home.templateAdded"));
  };

  const remove = (it: EditorItem, index: number) => {
    setItems((list) => list.filter((x) => x.key !== it.key));
    toast(t("site.home.removed", { name: t(`site.home.type.${it.form.type}`) }), {
      action: { label: t("site.common.undo"), onClick: () => setItems((list) => [...list.slice(0, index), it, ...list.slice(index)]) },
    });
  };

  const doSave = async (): Promise<StaffHome | null> => {
    if (invalid.length) {
      setShowErrors(true);
      setOpen(invalid[0]!.key);
      requestAnimationFrame(() => document.getElementById(`sec-${invalid[0]!.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
      toast.error(t("site.home.fixErrors", { count: invalid.length }));
      return null;
    }
    const seoValue = fromSeoForm(seo);
    try {
      const h = await save.mutateAsync({
        sections: sectionsFromItems(items),
        ...(seoValue ? { seo: seoValue } : {}),
      });
      setServer(h);
      setBaseline(snapshot(items, seo));
      setShowErrors(false);
      return h;
    } catch (err) {
      toast.error(describeError(err, t));
      return null;
    }
  };

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const h = await doSave();
    if (h) toast.success(t("site.home.draftSaved"));
  };

  const doPublish = async () => {
    if (dirty) {
      const h = await doSave();
      if (!h) return;
    }
    try {
      const h = await publish.mutateAsync();
      setServer(h);
      toast.success(t("site.home.published"), storeUrl ? { action: { label: t("site.common.viewStore"), onClick: () => window.open(storeUrl("/"), "_blank", "noopener") } } : undefined);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const pending = dirty || server.hasUnpublishedChanges || (!server.published && items.some((i) => !i.hidden));
  const statusPill = !server.published ? (
    <StatusPill tone="warning" icon={AlertCircleIcon}>
      {t("site.home.notPublished")}
    </StatusPill>
  ) : dirty || server.hasUnpublishedChanges ? (
    <StatusPill tone="warning" icon={AlertCircleIcon}>
      {t("site.home.unpublishedChanges")}
    </StatusPill>
  ) : (
    <StatusPill tone="success" icon={CheckCircle2Icon}>
      {t("site.home.live")}
    </StatusPill>
  );

  const publishButton = canEdit && (
    <Button type="button" size="lg" onClick={() => void doPublish()} disabled={busy || !pending || items.filter((i) => !i.hidden).length === 0}>
      {publish.isPending ? <Loader2Icon className="animate-spin" /> : <RocketIcon />}
      {dirty ? t("site.home.saveAndPublish") : t("site.home.publish")}
    </Button>
  );

  return (
    <Page wide className="pb-0">
      <PageHeading
        icon={HomeIcon}
        title={t("site.home.title")}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {statusPill}
            {server.publishedAt && <span>{t("site.home.lastPublished", { date: formatDate(server.publishedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}</span>}
          </span>
        }
        actions={
          storeUrl && (
            <Button asChild variant="outline" size="lg">
              <a href={storeUrl("/")} target="_blank" rel="noreferrer">
                <ExternalLinkIcon /> {t("site.common.viewStore")}
              </a>
            </Button>
          )
        }
      />
      {!canEdit && <ReadOnlyNote>{t("site.common.readOnlyCms")}</ReadOnlyNote>}
      {!server.published && !server.draft && (
        <p className="mb-4 rounded-xl bg-info/10 p-3 text-sm text-info-ink ring-1 ring-info/25 ring-inset">{t("site.home.defaultNote")}</p>
      )}

      <form onSubmit={onSubmit} noValidate className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
          {items.length === 0 ? (
            <EmptyState
              icon={LayoutTemplateIcon}
              title={t("site.home.emptyTitle")}
              description={t("site.home.emptyBody")}
              action={
                canEdit && (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button type="button" size="lg" onClick={startWithTemplate}>
                      <WandSparklesIcon /> {t("site.home.useTemplate")}
                    </Button>
                    <Button type="button" size="lg" variant="outline" onClick={() => setGallery({ at: 0 })}>
                      <PlusIcon /> {t("site.home.addSection")}
                    </Button>
                  </div>
                )
              }
            />
          ) : (
            <ol className="grid gap-3" aria-label={t("site.home.sections")}>
              <AnimatePresence initial={false}>
                {items.map((it, i) => {
                  const Icon = SECTION_ICONS[it.form.type];
                  const check = checks.get(it.key);
                  const bad = !check?.ok;
                  const isOpen = open === it.key;
                  return (
                    <motion.li key={it.key} id={`sec-${it.key}`} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.16 }} className="scroll-mt-24">
                      <div
                        {...(canEdit ? sort.itemProps(it.key) : {})}
                        draggable={canEdit && armed === it.key}
                        onDragEnd={() => {
                          setArmed(null);
                          if (canEdit) sort.itemProps(it.key).onDragEnd();
                        }}
                        className={cn(
                          "rounded-2xl border border-card-ring bg-card shadow-elevated data-[dragging]:opacity-40 data-[over]:ring-2 data-[over]:ring-primary/50",
                          it.hidden && "border-dashed bg-muted/30 shadow-none",
                          bad && showErrors && "border-destructive/60",
                        )}
                      >
                        <div className="flex items-center gap-2 px-2 py-2 sm:px-3" onPointerDown={() => canEdit && setArmed(it.key)} onPointerUp={() => setArmed(null)}>
                          <GripVerticalIcon className={cn("hidden size-4 shrink-0 text-muted-foreground sm:block", canEdit && "cursor-grab")} aria-hidden />
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-expanded={isOpen}
                            aria-controls={`sec-body-${it.key}`}
                            onClick={() => setOpen(isOpen ? null : it.key)}
                          >
                            <span className={cn("icon-chip size-9 shrink-0 rounded-xl", it.hidden ? "text-muted-foreground" : "text-primary")}>
                              <Icon className="size-4" />
                            </span>
                            <span className="grid min-w-0 flex-1">
                              <span className="flex items-center gap-2 text-sm font-medium">
                                <span className="truncate">{t(`site.home.type.${it.form.type}`)}</span>
                                {it.hidden && (
                                  <StatusPill tone="neutral" icon={EyeOffIcon}>
                                    {t("site.home.hidden")}
                                  </StatusPill>
                                )}
                                {bad && (
                                  <StatusPill tone={showErrors ? "danger" : "warning"} icon={AlertCircleIcon}>
                                    {t("site.home.incomplete")}
                                  </StatusPill>
                                )}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">{sectionSummary(it.form, t) || "—"}</span>
                            </span>
                            <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
                          </button>
                          {canEdit && (
                            <>
                              <Button type="button" variant="ghost" size="icon-sm" className="hidden sm:inline-flex" disabled={i === 0} onClick={() => sort.move(i, -1)} aria-label={t("site.common.moveUpN", { n: i + 1 })}>
                                <ArrowUpIcon />
                              </Button>
                              <Button type="button" variant="ghost" size="icon-sm" className="hidden sm:inline-flex" disabled={i === items.length - 1} onClick={() => sort.move(i, 1)} aria-label={t("site.common.moveDownN", { n: i + 1 })}>
                                <ArrowDownIcon />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("site.common.actionsFor", { name: t(`site.home.type.${it.form.type}`) })}>
                                    <MoreVerticalIcon />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem className="h-10 sm:hidden" disabled={i === 0} onSelect={() => sort.move(i, -1)}>
                                    <ArrowUpIcon /> {t("site.common.moveUp")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="h-10 sm:hidden" disabled={i === items.length - 1} onSelect={() => sort.move(i, 1)}>
                                    <ArrowDownIcon /> {t("site.common.moveDown")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="h-10" disabled={full} onSelect={() => setGallery({ at: i + 1 })}>
                                    <PlusIcon /> {t("site.home.addBelow")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="h-10"
                                    disabled={full}
                                    onSelect={() => {
                                      const copy: EditorItem = { key: nextKey(), hidden: it.hidden, form: duplicateSectionForm(it.form) };
                                      setItems((list) => [...list.slice(0, i + 1), copy, ...list.slice(i + 1)]);
                                    }}
                                  >
                                    <CopyIcon /> {t("site.common.duplicate")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="h-10" onSelect={() => patch(it.key, { hidden: !it.hidden })}>
                                    {it.hidden ? <EyeIcon /> : <EyeOffIcon />} {it.hidden ? t("site.home.show") : t("site.home.hide")}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => remove(it, i)}>
                                    <Trash2Icon /> {t("site.common.delete")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </>
                          )}
                        </div>
                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div
                              id={`sec-body-${it.key}`}
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="border-t border-border/60 px-3 py-4 sm:px-4">
                                {it.hidden && <p className="mb-3 text-xs text-muted-foreground">{t("site.home.hiddenNote")}</p>}
                                <SectionFields
                                  form={it.form}
                                  onChange={(form) => patch(it.key, { form })}
                                  errors={showErrors && check && !check.ok ? check.errors : {}}
                                  disabled={!canEdit}
                                  idp={`h-${it.key}`}
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
          )}

          {canEdit && items.length > 0 && (
            <Button type="button" variant="outline" size="lg" className="h-12 border-dashed" disabled={full} onClick={() => setGallery({ at: items.length })}>
              <PlusIcon /> {full ? t("site.home.full", { max: CMS_LIMITS.sections }) : t("site.home.addSection")}
            </Button>
          )}

          {items.length > 0 && (
            <SeoPanel
              idPrefix="home"
              value={seo}
              onChange={setSeo}
              fallbackTitle={shopName}
              url={storeUrl ? storeUrl("/") : "/"}
              disabled={!canEdit}
            />
          )}
        </div>

        <aside className="grid min-w-0 gap-2 lg:sticky lg:top-20" aria-label={t("site.preview.label")}>
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold lg:sr-only">
            <EyeIcon className="size-4 text-primary" /> {t("site.preview.label")}
          </h2>
          <Card className="gap-0 p-3">
            <HomePreview
              sections={previewSections}
              shopName={shopName}
              loading={(!exact && lookupsLoading && previewSections.length === 0) || (!dirty && !!server.draft && serverPreview.isPending)}
              device={device}
              onDevice={setDevice}
              selectedId={openForm?.id ?? null}
              note={exact ? t("site.preview.exact") : t("site.preview.live")}
            />
          </Card>
        </aside>

        {canEdit && (
          <div className="lg:col-span-2">
            <SaveBar
              dirty={dirty}
              saving={save.isPending}
              status={pending ? t("site.home.savedNotPublished") : t("site.home.allLive")}
              saveLabel={t("site.home.saveDraft")}
              onDiscard={() => {
                setItems(itemsFromSections((server.draft ?? server.published)?.sections ?? [], nextKey));
                setSeo(toSeoForm((server.draft ?? server.published)?.seo));
                setShowErrors(false);
              }}
              extra={publishButton}
            />
          </div>
        )}
      </form>

      <SectionGallery open={!!gallery} onOpenChange={(o) => !o && setGallery(null)} onPick={(type) => addSection(type, gallery?.at ?? items.length)} />
      {guard.dialog}
    </Page>
  );
}
