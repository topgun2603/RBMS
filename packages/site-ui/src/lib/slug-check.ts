import { SLUG_MAX, SLUG_RE } from "./content";
import { RESERVED_SLUGS } from "./slug";

export type SlugIssue = "invalid" | "reserved" | "taken";

/** Why a typed slug can't be used (client-side part: format and reserved words; "taken" comes from the server). */
export function slugIssue(slug: string): SlugIssue | null {
  if (!slug) return null;
  if (slug.length > SLUG_MAX || !SLUG_RE.test(slug)) return "invalid";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}
