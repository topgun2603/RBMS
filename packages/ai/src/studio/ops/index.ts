import type { OpDef } from "../types";
import { HOME_OPS } from "./home";
import { MENU_PAGE_OPS } from "./menus";
import { SETTINGS_OPS } from "./settings";
import { TEAM_OPS } from "./team";
import { THEME_OPS } from "./theme";

/** Every operation Studio can perform: the whole catalogue. Anything not here is "not possible yet". */
export const ALL_OPS: readonly OpDef[] = [...THEME_OPS, ...HOME_OPS, ...MENU_PAGE_OPS, ...SETTINGS_OPS, ...TEAM_OPS];

const byKind = new Map(ALL_OPS.map((o) => [o.kind, o]));
export const opOf = (kind: string): OpDef | undefined => byKind.get(kind);
export const OP_KINDS = ALL_OPS.map((o) => o.kind) as [string, ...string[]];

export { STUDIO_ADDABLE_SECTIONS, SECTION_BLURB, findSection } from "./home";
export { NEVER_GRANT, MAX_GRANTS, grantProblem } from "./team";
export { effectiveTokens, presetTokens } from "./theme";
