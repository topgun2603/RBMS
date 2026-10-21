"use client";

import * as React from "react";
import { ArrowRightIcon, BadgeCheckIcon, PaletteIcon, TypeIcon } from "lucide-react";
import { Button, Label, Skeleton, toast } from "@srirealtime/ui";
import { describeError, ModuleLink, Page, PageHeading, QueryError, SettingsNav, useI18n, useSettingsHref, useShop, useWebFonts } from "@srirealtime/web";
import { ReadOnlyNote, SaveBar, Section } from "../components/bits";
import { Choice, ColorField, FontField } from "../components/brand-fields";
import { ImageField } from "../components/image-field";
import { LivePreview } from "../components/live-preview";
import { brandTokens, type SavedTokens } from "../components/live-preview-drafts";
import { useUnsavedGuard } from "../components/unsaved-guard";
import { useIsManager } from "../lib/access";
import { brandDraftFrom, useBrand, useSaveBrand, type BrandDraft } from "../lib/brand";

/**
 * Settings → Branding: the shop's identity, the same everywhere it shows up (online store, bills and receipts,
 * emails, this app): logo, favicon, brand colours, fonts and light / dark mode. The store's layout is Appearance.
 */
export default function BrandingPage() {
  const { t } = useI18n();
  const brand = useBrand();
  const canEdit = useIsManager();
  return (
    <Page width="full" className="pb-0">
      <SettingsNav />
      <PageHeading icon={BadgeCheckIcon} title={t("site.brand.title")} description={t("site.brand.subtitle")} />
      {!canEdit && <ReadOnlyNote>{t("site.common.readOnlySettings")}</ReadOnlyNote>}
      {brand.isError ? (
        <QueryError error={brand.error} onRetry={() => void brand.refetch()} />
      ) : !brand.data ? (
        <div className="grid gap-section xl:grid-cols-[minmax(0,1fr)_380px]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <Editor initial={brandDraftFrom(brand.data)} saved={brand.data.tokens as SavedTokens} canEdit={canEdit} />
      )}
    </Page>
  );
}

function Editor({ initial, saved, canEdit }: { initial: BrandDraft; saved: SavedTokens; canEdit: boolean }) {
  const { t } = useI18n();
  const settingsHref = useSettingsHref();
  const save = useSaveBrand();
  const [draft, setDraft] = React.useState(initial);
  const [base, setBase] = React.useState(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  useUnsavedGuard(dirty);
  useWebFonts([draft.fontSans, draft.fontHeading]);

  const set = (patch: Partial<BrandDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setColor = (k: keyof BrandDraft["colors"], v: string | null) => setDraft((d) => ({ ...d, colors: { ...d.colors, [k]: v } }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saved = brandDraftFrom(await save.mutateAsync(draft));
      setDraft(saved);
      setBase(saved);
      toast.success(t("site.brand.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-section">
      <div className="grid items-start gap-section xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <div className="grid min-w-0 gap-section">
          <Section icon={BadgeCheckIcon} title={t("site.brand.identityTitle")} description={t("site.brand.identityBody")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>{t("site.brand.logo")}</Label>
                <ImageField value={draft.logoUrl} onChange={(v) => set({ logoUrl: v })} disabled={!canEdit} aspect="aspect-[3/1]" label={t("site.brand.logo")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("site.brand.logoDark")}</Label>
                <ImageField value={draft.logoDarkUrl} onChange={(v) => set({ logoDarkUrl: v })} disabled={!canEdit} aspect="aspect-[3/1]" label={t("site.brand.logoDark")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("site.brand.favicon")}</Label>
                <ImageField value={draft.faviconUrl} onChange={(v) => set({ faviconUrl: v })} disabled={!canEdit} aspect="aspect-square" className="max-w-32" label={t("site.brand.favicon")} />
              </div>
            </div>
          </Section>

          <Section icon={PaletteIcon} title={t("site.appearance.coloursTitle")} description={t("site.appearance.coloursBody")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField label={t("site.appearance.primary")} value={draft.colors.primary} onChange={(v) => v && setColor("primary", v)} disabled={!canEdit} />
              <ColorField label={t("site.appearance.accent")} value={draft.colors.accent} onChange={(v) => setColor("accent", v)} disabled={!canEdit} optional />
              <ColorField label={t("site.appearance.background")} value={draft.colors.background} onChange={(v) => setColor("background", v)} disabled={!canEdit} optional />
              <ColorField label={t("site.appearance.text")} value={draft.colors.foreground} onChange={(v) => setColor("foreground", v)} disabled={!canEdit} optional />
            </div>
            <Choice
              label={t("site.appearance.mode")}
              value={draft.mode}
              onChange={(v) => set({ mode: v })}
              disabled={!canEdit}
              options={(["light", "dark", "system"] as const).map((m) => ({ value: m, label: t(`site.appearance.modes.${m}`) }))}
            />
          </Section>

          <Section icon={TypeIcon} title={t("site.appearance.typeTitle")} description={t("site.appearance.typeBody")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FontField label={t("site.appearance.headingFont")} value={draft.fontHeading} onChange={(v) => set({ fontHeading: v })} disabled={!canEdit} />
              <FontField label={t("site.appearance.bodyFont")} value={draft.fontSans} onChange={(v) => set({ fontSans: v })} disabled={!canEdit} />
            </div>
          </Section>
        </div>

        <aside className="order-first grid w-full max-w-2xl gap-3 xl:sticky xl:top-4 xl:order-none xl:max-w-none">
          <Label>{t("site.appearance.preview")}</Label>
          <BrandCard draft={draft} />
          {/* The real store with the unsaved colours and fonts (the logo shows there once saved). */}
          <LivePreview tokens={brandTokens(draft, saved)} mode="browse" className="h-[60dvh]" />
          <p className="text-meta text-muted-foreground">{t("site.brand.previewNote")}</p>
          <div>
            <Button asChild variant="outline" size="sm">
              <ModuleLink href={settingsHref("appearance")}>
                {t("site.brand.toAppearance")} <ArrowRightIcon className="rtl:rotate-180" />
              </ModuleLink>
            </Button>
          </div>
        </aside>
      </div>
      {canEdit && <SaveBar dirty={dirty} saving={save.isPending} onDiscard={() => setDraft(base)} />}
    </form>
  );
}

/** A small card in the brand: logo (or the shop's name), a heading, body text and a button. */
function BrandCard({ draft }: { draft: BrandDraft }) {
  const { t } = useI18n();
  const shop = useShop();
  const dark = draft.mode === "dark";
  const bg = draft.colors.background ?? (dark ? "#111827" : "#ffffff");
  const fg = draft.colors.foreground ?? (dark ? "#f9fafb" : "#111827");
  const logo = dark && draft.logoDarkUrl ? draft.logoDarkUrl : draft.logoUrl;
  const name = shop.shopName || "Your shop";
  return (
    <div className="grid gap-4 rounded-2xl p-5 ring-1 ring-border" style={{ background: bg, color: fg, fontFamily: `"${draft.fontSans}", sans-serif` }}>
      <div className="flex h-9 items-center">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- preview of an uploaded logo
          <img src={logo} alt="" className="h-9 w-auto max-w-40 object-contain" />
        ) : (
          <span className="text-lg font-bold" style={{ fontFamily: `"${draft.fontHeading}", serif` }}>
            {name}
          </span>
        )}
      </div>
      <p className="text-2xl leading-tight font-semibold" style={{ fontFamily: `"${draft.fontHeading}", serif` }}>
        {t("site.brand.sampleHeading")}
      </p>
      <p className="text-sm opacity-80">{t("site.brand.sampleBody", { name })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: draft.colors.primary }}>
          {t("site.brand.sampleButton")}
        </span>
        {draft.colors.accent && <span className="rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: draft.colors.accent }}>{t("site.brand.sampleTag")}</span>}
      </div>
    </div>
  );
}
