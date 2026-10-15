/**
 * Hidden home sections. The cms schema has a `hidden` flag on every section: hidden sections are saved in the draft
 * (and published) like any other, and the storefront skips them. The editor keeps the flag next to the form; these pure
 * helpers convert between the saved sections and the editor's items.
 */
import type { HomeSection, HomeSectionInput } from "./content";
import { fromSectionForm, toSectionForm, type SectionForm } from "./sections";
import type { ResolvedHomeSection } from "./types";

export interface EditorItem {
  key: string;
  hidden: boolean;
  form: SectionForm;
}

/** Saved sections → editor items (the hidden flag comes from each section). */
export function itemsFromSections(sections: readonly (HomeSection | HomeSectionInput)[], key: () => string): EditorItem[] {
  return sections.map((s) => ({ key: key(), hidden: s.hidden === true, form: toSectionForm(s) }));
}

/** Editor items → the draft's sections: every item, in order, with `hidden: true` on hidden ones. */
export function sectionsFromItems(items: readonly EditorItem[]): HomeSectionInput[] {
  return items.map((it) => {
    const section = fromSectionForm(it.form);
    return it.hidden ? { ...section, hidden: true } : section;
  });
}

/** Flags the locally resolved preview sections (one per item, same order) that are hidden. */
export function flagHidden(sections: readonly ResolvedHomeSection[], items: readonly Pick<EditorItem, "hidden">[]): ResolvedHomeSection[] {
  return sections.map((s, i) => (items[i]?.hidden ? ({ ...s, hidden: true } as ResolvedHomeSection) : s));
}
