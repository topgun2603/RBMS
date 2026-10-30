"use client";

import { humanizeKey, useI18n, type Translator } from "@rbms/web";
import { describeAction } from "../../lib/audit-actions";

export const auditModuleLabel = (t: Translator, module: string) =>
  t.has(`workspace.audit.modules.${module}`) ? t(`workspace.audit.modules.${module}`) : humanizeKey(module);

/** Friendly text for an audit action ("Cancelled a bill"), falling back to "Changed something in Bills". */
export function actionText(t: Translator, action: string): string {
  const d = describeAction(action);
  if (d.kind === "known" && t.has(`workspace.audit.actions.${d.id}`)) return t(`workspace.audit.actions.${d.id}`);
  const verb = d.kind === "generic" ? d.verb : "other";
  return t(`workspace.audit.generic.${verb}`, { module: auditModuleLabel(t, d.module) });
}

export function useActionText() {
  const { t } = useI18n();
  return (action: string) => actionText(t, action);
}
