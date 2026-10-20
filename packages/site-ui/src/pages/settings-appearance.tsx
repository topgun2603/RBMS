"use client";

import * as React from "react";
import { ArrowRightIcon, BriefcaseIcon, CheckIcon, ExternalLinkIcon, LayoutTemplateIcon, PaletteIcon, SlidersHorizontalIcon, SparklesIcon } from "lucide-react";
import { Button, cn, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, toast } from "@srirealtime/ui";
import { THEME_OPTIONS, THEME_PRESETS, themePreset, type StoreTheme, type ThemeOptionKey } from "@srirealtime/branding/theme";
import { BUSINESS_TYPES, copyFor, PACKS, packOrDefault } from "@srirealtime/verticals";
import { describeError, ModuleLink, Page, PageHeading, QueryError, SettingsNav, useI18n, useSettingsHref, useShop, useWebFonts } from "@srirealtime/web";
import { ReadOnlyNote, SaveBar, Section } from "../components/bits";
import { Choice } from "../components/brand-fields";
import { ThemePreview } from "../components/theme-preview";
import { useUnsavedGuard } from "../components/unsaved-guard";
import { useIsManager } from "../lib/access";
import { draftFrom, draftFromPreset, useBrandingTokens, useSaveAppearance, useSaveBusinessType, type AppearanceDraft } from "../lib/appearance";
import { useStoreSettings } from "../lib/queries";
import { useStoreUrl } from "../lib/store-url";

const RADII = [
  { value: 0, key: "square" },
  { value: 0.375, key: "soft" },
  { value: 0.75, key: "round" },
  { value: 1.25, key: "extra" },
] as const;

/**
 * Settings → Appearance: the shop's trade (business pack) and its store's look. Pick a preset (it brings its own
 * colours and fonts), then change the layout: header, hero, product cards, picture shape, buttons, spacing, section
 * style, pattern, headings and corners. Colours, fonts, logo and light / dark mode are the shop's identity and live in
 * Settings → Branding; this page shows them. The preview redraws on every change; Save writes the brand tokens (and
 * the trade, when changed).
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
        <div className="grid gap-section 2xl:grid-cols-[minmax(0,1fr)_420px]">
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
  const setTheme = <K extends ThemeOptionKey>(k: K, v: StoreTheme[K]) => setDraft((d) => ({ ...d, theme: { ...d.theme, [k]: v } }));
  const settingsHref = useSettingsHref();

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
  return (
    <form onSubmit={submit} className="grid gap-section">
      <div className="grid items-start gap-section 2xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
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
                <Button type="button" variant="outline" size="sm" onClick={() => setDraft(draftFromPreset(recommended))}>
                  <SparklesIcon /> {t("site.appearance.useRecommended", { name: recommended.name })}
                </Button>
              </div>
            )}
          </Section>

          <Section icon={LayoutTemplateIcon} title={t("site.appearance.presetsTitle")} description={t("site.appearance.presetsBody")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {THEME_PRESETS.map((p) => {
                const on = draft.preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!canEdit}
                    aria-pressed={on}
                    onClick={() => setDraft(draftFromPreset(p))}
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

          <Section icon={SlidersHorizontalIcon} title={t("site.appearance.layoutTitle")} description={t("site.appearance.layoutBody")}>
            <Choice
              label={t("site.appearance.headings")}
              value={draft.theme.headings}
              onChange={(v) => setTheme("headings", v)}
              disabled={!canEdit}
              options={THEME_OPTIONS.headings.map((v) => ({ value: v, label: t(`site.appearance.opt.headings.${v}`) }))}
            />
            {(["header", "hero", "card", "imageRatio", "buttons", "sections", "motif", "density"] as const).map((k) => (
              <Choice
                key={k}
                label={t(`site.appearance.opt.${k}.label`)}
                value={draft.theme[k]}
                onChange={(v) => setTheme(k, v as StoreTheme[typeof k])}
                disabled={!canEdit}
                options={(THEME_OPTIONS[k] as readonly string[]).map((v) => ({ value: v, label: t(`site.appearance.opt.${k}.${v}`) }))}
              />
            ))}
            <Choice
              label={t("site.appearance.corners")}
              value={String(RADII.reduce((best, r) => (Math.abs(r.value - draft.radius) < Math.abs(best.value - draft.radius) ? r : best)).value)}
              onChange={(v) => set({ radius: Number(v) })}
              disabled={!canEdit}
              options={RADII.map((r) => ({ value: String(r.value), label: t(`site.appearance.radius.${r.key}`) }))}
            />
          </Section>
        </div>

        <aside className="order-first grid w-full max-w-2xl gap-3 2xl:sticky 2xl:top-4 2xl:order-none 2xl:max-w-none">
          <div className="flex items-center justify-between gap-2">
            <Label>{t("site.appearance.preview")}</Label>
            {storeUrl && (
              <Button asChild variant="ghost" size="sm">
                <a href={storeUrl("/")} target="_blank" rel="noreferrer">
                  {t("site.appearance.openStore")} <ExternalLinkIcon />
                </a>
              </Button>
            )}
          </div>
          <ThemePreview draft={draft} copy={copyFor(pack, locale)} shopName={shop.shopName || "Your shop"} />
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
