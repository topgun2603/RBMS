import type { HomeSectionInput } from "../lib/content";
import type { AppearanceDraft } from "../lib/appearance";
import type { BrandDraft } from "../lib/brand";
import { sectionsFromItems, type EditorItem } from "../lib/hidden";

/*
 * Editor drafts → what the live preview sends to the store. Pure.
 */

type Colors = { primary: string; accent: string | null; background: string | null; foreground: string | null };
const colorsOf = (c: Colors) => ({
  primary: c.primary,
  ...(c.accent ? { accent: c.accent } : {}),
  ...(c.background ? { background: c.background } : {}),
  ...(c.foreground ? { foreground: c.foreground } : {}),
});

/** Settings → Appearance draft → brand tokens (the same object `useSaveAppearance` saves, nulls left out). */
export function appearanceTokens(d: AppearanceDraft): Record<string, unknown> {
  return {
    colors: colorsOf(d.colors),
    fontSans: d.fontSans,
    ...(d.fontHeading && d.fontHeading !== d.fontSans ? { fontHeading: d.fontHeading } : {}),
    radius: d.radius,
    mode: d.mode,
    theme: d.theme,
    ...(d.preset ? { preset: d.preset } : {}),
  };
}

/** Saved tokens as `/branding` returns them (the fields Branding doesn't edit come from here). */
export interface SavedTokens {
  colors: { primary: string; accent?: string; background?: string; foreground?: string; secondary?: string };
  fontSans: string;
  fontHeading?: string;
  radius?: number;
  mode: "light" | "dark" | "system";
  theme?: Record<string, string>;
  preset?: string;
}

/** Settings → Branding draft over the saved tokens (radius and theme variants stay as saved). */
export function brandTokens(d: BrandDraft, saved: SavedTokens | null | undefined): Record<string, unknown> {
  return {
    ...(saved?.radius !== undefined ? { radius: saved.radius } : {}),
    ...(saved?.theme ? { theme: saved.theme } : {}),
    ...(saved?.preset ? { preset: saved.preset } : {}),
    colors: { ...(saved?.colors.secondary ? { secondary: saved.colors.secondary } : {}), ...colorsOf(d.colors) },
    fontSans: d.fontSans,
    ...(d.fontHeading && d.fontHeading !== d.fontSans ? { fontHeading: d.fontHeading } : {}),
    mode: d.mode,
  };
}

/**
 * Home editor items → the sections the preview renders, each with an id so a click in the store maps back to its item:
 * the section's own id when it has one, else the editor key. Hidden items are sent too (the store leaves them out,
 * like the live site).
 */
export function previewSections(items: readonly EditorItem[]): HomeSectionInput[] {
  const sections = sectionsFromItems(items);
  return sections.map((s, i) => ({ ...s, id: s.id ?? items[i]!.key }) as HomeSectionInput);
}

/** The editor item a preview section id belongs to (see previewSections). */
export function itemKeyForSection(items: readonly EditorItem[], sectionId: string): string | null {
  return items.find((it) => (it.form.id ?? it.key) === sectionId)?.key ?? null;
}

/** The preview section id of an editor item. */
export const sectionIdForItem = (it: EditorItem): string => it.form.id ?? it.key;
