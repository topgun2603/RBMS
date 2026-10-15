"use client";

import { humanizeKey, type Translator } from "@srirealtime/web";
import { BUILTIN_ROLE_NAMES } from "../../lib/permissions";
import type { PermissionDef, Role } from "../../lib/types";

/** Built-in roles keep a translated name until the owner renames them. */
const untouchedBuiltin = (r: Pick<Role, "key" | "name" | "builtin">) => r.builtin && BUILTIN_ROLE_NAMES[r.key] === r.name;

export const roleName = (t: Translator, r: Pick<Role, "key" | "name" | "builtin">) =>
  untouchedBuiltin(r) && t.has(`workspace.roles.builtin.${r.key}.name`) ? t(`workspace.roles.builtin.${r.key}.name`) : r.name;

export const roleDescription = (t: Translator, r: Pick<Role, "key" | "name" | "builtin" | "description">) =>
  untouchedBuiltin(r) && t.has(`workspace.roles.builtin.${r.key}.description`) ? t(`workspace.roles.builtin.${r.key}.description`) : r.description;

export const permLabel = (t: Translator, p: Pick<PermissionDef, "key" | "label">) =>
  t.has(`workspace.perm.${p.key}`) ? t(`workspace.perm.${p.key}`) : p.label || humanizeKey(p.key);

export const permDescription = (t: Translator, p: Pick<PermissionDef, "key" | "description">) =>
  t.has(`workspace.permDesc.${p.key}`) ? t(`workspace.permDesc.${p.key}`) : p.description;

export const moduleLabel = (t: Translator, module: string) =>
  t.has(`workspace.permModule.${module}`) ? t(`workspace.permModule.${module}`) : humanizeKey(module);

/** "*.view" → "View everything", "orders.*" → "Everything in Orders", unknown keys → humanised. */
export function patternLabel(t: Translator, p: string): string {
  if (p === "*") return t("workspace.roles.pattern.all");
  if (p === "*.view") return t("workspace.roles.pattern.viewAll");
  const m = /^([a-z][a-z0-9-]*)\.\*$/.exec(p);
  if (m) return t("workspace.roles.pattern.module", { module: moduleLabel(t, m[1]!) });
  if (t.has(`workspace.perm.${p}`)) return t(`workspace.perm.${p}`);
  return humanizeKey(p);
}
