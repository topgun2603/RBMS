import { defineModule } from "@rbms/core";
import type { Db } from "@rbms/db";
import { settingsRoutes } from "./routes";
import { settingsValues } from "./schema";
import { SettingsService } from "./service";

export interface SettingsDeps {
  db: Db;
  /** How long merged settings are cached per (namespace, tenant, user). Default 30s. 0 disables. */
  cacheTtlMs?: number;
}

export function createSettings(deps: SettingsDeps) {
  const service = new SettingsService({ db: deps.db, cacheTtlMs: deps.cacheTtlMs });
  const module = defineModule({ id: "settings", tables: { settingsValues }, routes: settingsRoutes(service) });
  return { service, module };
}

export {
  SettingsService,
  type DefineSettingsOptions,
  type NamespaceInfo,
  type SettingsHandle,
  type SettingsPatch,
  type SettingsScope,
} from "./service";
export { applyPatch, mergeLayers, resolveSettings, type Layer } from "./merge";
export * from "./schema";
