"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, BriefcaseIcon, RotateCcwIcon, CheckIcon, ExternalLinkIcon, LayoutDashboardIcon, LayoutGridIcon, LayoutListIcon, LayoutTemplateIcon, PaletteIcon, PanelTopIcon, ShirtIcon, SlidersHorizontalIcon, SparklesIcon } from "lucide-react";
import { Button, ChipGroup, cn, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, toast } from "@srirealtime/ui";
import { LAYOUT_OPTIONS, THEME_OPTIONS, THEME_PRESETS, themePreset, type LayoutOptionKey, type LayoutTheme, type StoreTheme, type ThemeOptionKey } from "@srirealtime/branding/theme";
import { MobileNavSketch, PageLayoutPicker } from "../components/page-layout-thumbs";
import { BUSINESS_TYPES, copyFor, PACKS, packOrDefault } from "@srirealtime/verticals";
import { api, describeError, ModuleLink, Page, PageHeading, QueryError, SettingsNav, useI18n, useSettingsHref, useShop, useWebFonts } from "@srirealtime/web";
import { ReadOnlyNote, SaveBar, Section } from "../components/bits";
import { Choice } from "../components/brand-fields";
import type { PreviewView } from "../components/theme-preview";
import { LivePreview } from "../components/live-preview";
import { appearanceTokens, previewViewOfPath } from "../components/live-preview-drafts";
import { useUnsavedGuard } from "../components/unsaved-guard";
import { useIsManager } from "../lib/access";
import { differsFromPreset, draftFrom, draftFromPreset, resetToPreset, useBrandingTokens, useSaveAppearance, useSaveBusinessType, type AppearanceDraft } from "../lib/appearance";
import { useStoreSettings } from "../lib/queries";
import { useStoreUrl } from "../lib/store-url";

const RADII = [
  { value: 0, key: "square" },
  { value: 0.375, key: "soft" },
  { value: 0.75, key: "round" },
  { value: 1.25, key: "extra" },
] as const;

/** Theme options per editor section (labels: site.appearance.opt.<key>.*). */
const HEADER_KEYS = ["header", "headerStyle", "sticky", "megaMenu", "announcement", "footer"] as const;
const CARD_KEYS = ["card", "cardHover", "cardButton", "imageRatio"] as const;
const PRODUCT_KEYS = ["productLayout", "productDetails", "stickyBuy", "productTrust", "related"] as const;
const LAYOUT_KEYS = ["hero", "buttons", "sections", "motif", "density"] as const;
const LISTING_KEYS = ["listingFilters", "listingColumns", "listingView", "listingPaging", "categoryHeader", "subcategories", "compare"] as const;
const PRODUCT_PAGE_KEYS: ReadonlySet<ThemeOptionKey> = new Set(PRODUCT_KEYS);
const LISTING_PAGE_KEYS: ReadonlySet<ThemeOptionKey> = new Set(LISTING_KEYS);

/**
 * Settings → Appearance: the shop's trade (business pack) and its store's look. Pick a preset (it brings its own
 * colours and fonts), then change the parts: header & footer (layout, look, sticking, shop menu, offer ribbon, footer),
 * product cards (look, hover, buttons, picture shape), the product page (photos, details, buy bar, trust badges,
 * similar products), category / search pages (filters, columns, grid or list, paging, header, sub-category chips,
 * compare) and the rest of the layout (banner, buttons, spacing, sections, pattern, headings, corners).
 * Colours, fonts, logo and light / dark mode are the shop's identity and live in Settings → Branding; this page shows
 * them. The preview (home or product page) redraws on every change; Save writes the brand tokens (and the trade).
 */
export default function AppearancePage() {
  const { t } = useI18n();
  const branding = useBrandingTokens();
  const store = useStoreSettings();
  const canEdit = useIsManager();
  return (
    <Page width="full" className="pb-0">
      <SettingsNav />
      <PageHeading icon={PaletteIcon} title={t("site.appearance.title")} description={t("site.appearance.subtitle")} />
      {!canEdit && <ReadOnlyNote>{t("site.common.readOnlySettings")}</ReadOnlyNote>}
      {branding.isError ? (
        <QueryError error={branding.error} onRetry={() => void branding.refetch()} />
      ) : !branding.data || !store.data ? (
        <div className="grid gap-section xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : (
        <Editor initial={draftFrom(branding.data)} businessType={store.data.businessType ?? ""} canEdit={canEdit} />
      )}
    </Page>
  );
}

function Editor({ initial, businessType: savedType, canEdit }: { initial: AppearanceDraft; businessType: string; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const shop = useShop();
  const storeUrl = useStoreUrl();
  const save = useSaveAppearance();
  const saveType = useSaveBusinessType();
  const [draft, setDraft] = React.useState(initial);
  const [type, setType] = React.useState(savedType);
  const [base, setBase] = React.useState({ draft: initial, type: savedType });
  const pack = packOrDefault(type, shop.tenant.appId ?? null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.draft) || type !== base.type;
  useUnsavedGuard(dirty);
  useWebFonts([draft.fontSans, draft.fontHeading]);

  const set = (patch: Partial<AppearanceDraft>) => setDraft((d) => ({ ...d, ...patch, preset: patch.preset !== undefined ? patch.preset : d.preset }));
  const [view, setView] = React.useState<PreviewView>("home");
  // Where the shopper-style browsing inside the frame went (null = the chip's page). Tracking it keeps the frame
  // controlled: a chip (or an option change) brings the frame back to its page even when the chip is already active.
  const [framePath, setFramePath] = React.useState<string | null>(null);
  const sampleProduct = useSampleProductSlug();
  const previewPath = framePath ?? (view === "product" ? (sampleProduct ? `/p/${sampleProduct}` : "/products") : view === "listing" ? "/products" : "/");
  const showView = (v: PreviewView) => {
    setView(v);
    setFramePath(null);
  };
  const onFrameNavigate = (path: string) => {
    setFramePath(path);
    const v = previewViewOfPath(path);
    if (v) setView(v);
  };
  const setTheme = <K extends ThemeOptionKey>(k: K, v: StoreTheme[K]) => {
    setDraft((d) => ({ ...d, theme: { ...d.theme, [k]: v } }));
    // Show the page the change is on.
    showView(PRODUCT_PAGE_KEYS.has(k) ? "product" : LISTING_PAGE_KEYS.has(k) ? "listing" : "home");
  };
  /** Page layout and phone navigation (branding LAYOUT_OPTIONS); a preset keeps them (they are the shop's structure). */
  const setLayout = <K extends LayoutOptionKey>(k: K, v: LayoutTheme[K]) => {
    setDraft((d) => ({ ...d, theme: { ...d.theme, [k]: v } }));
    showView(k === "pageLayout" && v === "rail" ? "listing" : "home");
  };
  const pickPreset = (next: AppearanceDraft) =>
    setDraft((d) => ({ ...next, theme: { ...next.theme, pageLayout: next.theme.pageLayout ?? d.theme.pageLayout, mobileNav: next.theme.mobileNav ?? d.theme.mobileNav } }));
  const settingsHref = useSettingsHref();
  const choices = (keys: readonly ThemeOptionKey[]) =>
    keys.map((k) => (
      <Choice
        key={k}
        label={t(`site.appearance.opt.${k}.label`)}
        value={draft.theme[k]}
        onChange={(v) => setTheme(k, v as StoreTheme[typeof k])}
        disabled={!canEdit}
        options={(THEME_OPTIONS[k] as readonly string[]).map((v) => ({ value: v, label: t(`site.appearance.opt.${k}.${v}`) }))}
      />
    ));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (type !== base.type) await saveType.mutateAsync(type);
      const b = await save.mutateAsync(draft);
      const saved = draftFrom(b);
      setDraft(saved);
      setBase({ draft: saved, type });
      toast.success(t("site.appearance.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const recommended = themePreset(pack.preset);
  // The shop's own preset, when its colours / fonts / options were changed since: "Reset to <preset>" puts it back.
  const currentPreset = draft.preset ? themePreset(draft.preset) : undefined;
  const canReset = !!currentPreset && canEdit && differsFromPreset(draft, currentPreset);
  return (
    <form onSubmit={submit} className="grid gap-section">
      <div className="grid items-start gap-section xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <div className="grid min-w-0 gap-section">
          <Section icon={BriefcaseIcon} title={t("site.appearance.businessTitle")} description={t("site.appearance.businessBody")}>
            <Select value={type || pack.id} onValueChange={setType} disabled={!canEdit}>
              <SelectTrigger className="w-full sm:w-96" aria-label={t("site.appearance.businessTitle")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_TYPES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {locale === "ta" ? PACKS[b].nameTa : PACKS[b].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-meta text-muted-foreground">{pack.tagline}</p>
            {recommended && draft.preset !== recommended.id && canEdit && (
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => pickPreset(draftFromPreset(recommended))}>
                  <SparklesIcon /> {t("site.appearance.useRecommended", { name: recommended.name })}
                </Button>
              </div>
            )}
          </Section>

          <Section icon={LayoutTemplateIcon} title={t("site.appearance.presetsTitle")} description={t("site.appearance.presetsBody")}>
            {canReset && currentPreset && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button type="button" variant="outline" size="sm" onClick={() => setDraft((d) => resetToPreset(d, currentPreset))} data-testid="reset-preset">
                  <RotateCcwIcon /> {t("site.appearance.resetPreset", { name: currentPreset.name })}
                </Button>
                <span className="text-meta text-muted-foreground">{t("site.appearance.resetPresetHint")}</span>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {THEME_PRESETS.map((p) => {
                const on = draft.preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!canEdit}
                    aria-pressed={on}
                    onClick={() => pickPreset(draftFromPreset(p))}
                    className={cn(
                      "group grid gap-2 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                      on ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50",
                    )}
                  >
                    <span className="flex h-14 overflow-hidden rounded-lg" style={{ background: p.colors.background ?? "#fff" }}>
                      <span className="w-1/2" style={{ background: p.colors.primary }} />
                      <span className="grid w-1/2 place-items-center text-lg font-semibold" style={{ fontFamily: `"${p.fontHeading}", serif`, color: p.colors.foreground ?? "#111" }}>
                        Aa
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{p.name}</span>
                      {on && <CheckIcon className="size-4 text-primary" />}
                      {!on && p.id === pack.preset && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{t("site.appearance.forYou")}</span>}
                    </span>
                    <span className="line-clamp-2 text-meta text-muted-foreground">{p.description}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section icon={PaletteIcon} title={t("site.appearance.brandTitle")} description={t("site.appearance.brandBody")}>
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1.5" aria-hidden>
                {[draft.colors.primary, draft.colors.accent, draft.colors.background, draft.colors.foreground]
                  .filter((c): c is string => Boolean(c))
                  .map((c, i) => (
                    <span key={i} className="size-7 rounded-full ring-1 ring-border" style={{ background: c }} />
                  ))}
              </span>
              <span className="text-sm">
                <span className="font-semibold" style={{ fontFamily: `"${draft.fontHeading}", serif` }}>
                  {draft.fontHeading}
                </span>
                <span className="text-muted-foreground"> · </span>
                <span style={{ fontFamily: `"${draft.fontSans}", sans-serif` }}>{draft.fontSans}</span>
              </span>
              <Button asChild variant="outline" size="sm" className="ms-auto">
                <ModuleLink href={settingsHref("branding")}>
                  {t("site.appearance.editBrand")} <ArrowRightIcon className="rtl:rotate-180" />
                </ModuleLink>
              </Button>
            </div>
          </Section>

          <Section icon={PanelTopIcon} title={t("site.appearance.headerTitle")} description={t("site.appearance.headerBody")}>
            {choices(HEADER_KEYS)}
            {draft.theme.headerStyle === "transparent" && <p className="-mt-2 text-meta text-muted-foreground">{t("site.appearance.opt.headerStyle.hint")}</p>}
          </Section>

          <Section icon={LayoutGridIcon} title={t("site.appearance.cardsTitle")} description={t("site.appearance.cardsBody")}>
            {choices(CARD_KEYS)}
          </Section>

          <Section icon={ShirtIcon} title={t("site.appearance.productTitle")} description={t("site.appearance.productBody")}>
            {choices(PRODUCT_KEYS)}
          </Section>

          <Section icon={LayoutListIcon} title={t("site.appearance.listingTitle")} description={t("site.appearance.listingBody")}>
            {choices(LISTING_KEYS)}
          </Section>

          <Section icon={LayoutDashboardIcon} title={t("site.appearance.pageLayoutTitle")} description={t("site.appearance.pageLayoutBody")}>
            <PageLayoutPicker value={draft.theme.pageLayout ?? "standard"} onChange={(v) => setLayout("pageLayout", v)} disabled={!canEdit} />
            <div className="flex items-end gap-4">
              <MobileNavSketch tabs={draft.theme.mobileNav === "tabs"} className="h-20 w-auto shrink-0 text-primary" />
              <Choice
                label={t("site.appearance.opt.mobileNav.label")}
                value={draft.theme.mobileNav ?? "off"}
                onChange={(v) => setLayout("mobileNav", v)}
                disabled={!canEdit}
                options={LAYOUT_OPTIONS.mobileNav.map((v) => ({ value: v, label: t(`site.appearance.opt.mobileNav.${v}`) }))}
              />
            </div>
          </Section>

          <Section icon={SlidersHorizontalIcon} title={t("site.appearance.layoutTitle")} description={t("site.appearance.layoutBody")}>
            <Choice
              label={t("site.appearance.headings")}
              value={draft.theme.headings}
              onChange={(v) => setTheme("headings", v)}
              disabled={!canEdit}
              options={THEME_OPTIONS.headings.map((v) => ({ value: v, label: t(`site.appearance.opt.headings.${v}`) }))}
            />
            {choices(LAYOUT_KEYS)}
            <Choice
              label={t("site.appearance.corners")}
              value={String(RADII.reduce((best, r) => (Math.abs(r.value - draft.radius) < Math.abs(best.value - draft.radius) ? r : best)).value)}
              onChange={(v) => set({ radius: Number(v) })}
              disabled={!canEdit}
              options={RADII.map((r) => ({ value: String(r.value), label: t(`site.appearance.radius.${r.key}`) }))}
            />
          </Section>
        </div>

        <aside className="order-first grid w-full max-w-2xl gap-3 xl:sticky xl:top-4 xl:order-none xl:max-w-none">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>{t("site.appearance.preview")}</Label>
            <ChipGroup
              size="sm"
              aria-label={t("site.appearance.preview")}
              value={view}
              onChange={(v) => showView(v as PreviewView)}
              options={[
                { value: "home", label: t("site.appearance.previewHome") },
                { value: "listing", label: t("site.appearance.previewListing") },
                { value: "product", label: t("site.appearance.previewProduct") },
              ]}
            />
            {storeUrl && (
              <Button asChild variant="ghost" size="sm">
                <a href={storeUrl("/")} target="_blank" rel="noreferrer">
                  {t("site.appearance.openStore")} <ExternalLinkIcon />
                </a>
              </Button>
            )}
          </div>
          {/* The real store, restyled live with the unsaved look; the page chips jump to a listing or a product. */}
          <LivePreview tokens={appearanceTokens(draft)} mode="browse" path={previewPath} onNavigate={onFrameNavigate} className="h-[78dvh]" />
          <p className="text-meta text-muted-foreground">{t("site.appearance.previewNote")}</p>
        </aside>
      </div>
      {canEdit && (
        <SaveBar
          dirty={dirty}
          saving={save.isPending || saveType.isPending}
          onDiscard={() => {
            setDraft(base.draft);
            setType(base.type);
          }}
        />
      )}
    </form>
  );
}

/** A product to show the product page in the live preview (the shop's first listed one). */
function useSampleProductSlug(): string | null {
  const q = useQuery({
    queryKey: ["site", "appearance", "sample-product"],
    queryFn: () => api.get<{ items: { slug: string }[] }>("/catalog/public/products", { limit: 1 }),
    staleTime: 5 * 60_000,
  });
  return q.data?.items[0]?.slug ?? null;
}
