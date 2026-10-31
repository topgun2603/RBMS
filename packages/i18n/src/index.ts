import { defineModule } from "@rbms/core";
import type { Db } from "@rbms/db";
import type { Locale, Messages } from "./client";
import { i18nRoutes } from "./routes";
import { i18nOverrides } from "./schema";
import { I18nService } from "./service";

export interface I18nDeps {
  db: Db;
  /** Extra base messages merged over the built-in bundles. */
  bundles?: Partial<Record<Locale, Messages>>;
  /** Merged-dictionary cache TTL. Default 30s. 0 disables. */
  cacheTtlMs?: number;
}

export function createI18n(deps: I18nDeps) {
  const service = new I18nService(deps);
  const module = defineModule({ id: "i18n", tables: { i18nOverrides }, routes: i18nRoutes(service) });
  return { service, module };
}

export {
  BUILT_IN_BUNDLES,
  I18nService,
  type MessagesScope,
  type OverrideInput,
  type OverrideRef,
} from "./service";
export { buildDictionary, overrideRank, type OverrideLike } from "./dictionary";
export { en } from "./bundles/en";
export type { MessageKey } from "./bundles/en";
export { ta } from "./bundles/ta";
export * from "./client";
export * from "./schema";
