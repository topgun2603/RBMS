import { notFound } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { TtlCache } from "./cache";
import { applyPatch, mergeLayers, pickKeys, resolveSettings, type Layer } from "./merge";
import { settingsValues } from "./schema";
import { validatePatch } from "./validate";

export interface SettingsScope {
  tenantId?: string | null;
  /** User overrides only apply together with a tenantId. */
  userId?: string | null;
}

/** A patch: set keys to values, or to `null` to remove that layer's override. */
export type SettingsPatch<T> = { [K in keyof T]?: T[K] | null };

export interface DefineSettingsOptions<T> {
  /** Keys a signed-in user may override for themselves. Default: none. */
  userOverridable?: (keyof T)[];
  /** Keys returned to anonymous callers by the HTTP API. Default: none. */
  publicKeys?: (keyof T)[];
}

export interface SettingsHandle<T> {
  readonly namespace: string;
  /** Merged settings: defaults < app < tenant < user (shallow, per top-level key). */
  get(scope?: SettingsScope): Promise<T>;
  /** Only `publicKeys` of the merged settings. */
  getPublic(scope?: SettingsScope): Promise<Partial<T>>;
  /** Each setter returns the merged settings at the scope it wrote. */
  setApp(patch: SettingsPatch<T>): Promise<T>;
  setTenant(tenantId: string, patch: SettingsPatch<T>): Promise<T>;
  setUser(tenantId: string, userId: string, patch: SettingsPatch<T>): Promise<T>;
}

export interface NamespaceInfo {
  namespace: string;
  userOverridable: string[];
  publicKeys: string[];
}

interface Definition {
  namespace: string;
  schema: z.AnyZodObject;
  defaults: Layer;
  userOverridable: string[];
  publicKeys: string[];
}

interface Layers {
  app: Layer | null;
  tenant: Layer | null;
  user: Layer | null;
}

export interface SettingsServiceOptions {
  db: Db;
  cacheTtlMs?: number;
}

export class SettingsService {
  private readonly db: Db;
  private readonly defs = new Map<string, Definition>();
  private readonly cache: TtlCache<Layer>;

  constructor(opts: SettingsServiceOptions) {
    this.db = opts.db;
    this.cache = new TtlCache(opts.cacheTtlMs ?? 30_000);
  }

  define<S extends z.AnyZodObject>(
    namespace: string,
    schema: S,
    defaults: z.infer<S>,
    opts: DefineSettingsOptions<z.infer<S>> = {},
  ): SettingsHandle<z.infer<S>> {
    if (this.defs.has(namespace)) throw new Error(`Settings namespace "${namespace}" is already defined`);
    const def: Definition = {
      namespace,
      schema,
      defaults: schema.parse(defaults) as Layer,
      userOverridable: (opts.userOverridable ?? []).map(String),
      publicKeys: (opts.publicKeys ?? []).map(String),
    };
    this.defs.set(namespace, def);
    return this.handle(namespace) as SettingsHandle<z.infer<S>>;
  }

  /** Untyped handle for a defined namespace; throws notFound otherwise. */
  handle(namespace: string): SettingsHandle<Layer> {
    const def = this.def(namespace);
    return {
      namespace,
      get: (scope = {}) => this.resolve(def, scope),
      getPublic: async (scope = {}) => pickKeys(await this.resolve(def, scope), def.publicKeys),
      setApp: (patch) => this.write(def, null, null, patch),
      setTenant: (tenantId, patch) => this.write(def, tenantId, null, patch),
      setUser: (tenantId, userId, patch) => this.write(def, tenantId, userId, patch),
    };
  }

  getNamespace(namespace: string, scope: SettingsScope = {}): Promise<Layer> {
    return this.resolve(this.def(namespace), scope);
  }

  namespaces(): NamespaceInfo[] {
    return [...this.defs.values()].map((d) => ({
      namespace: d.namespace,
      userOverridable: [...d.userOverridable],
      publicKeys: [...d.publicKeys],
    }));
  }

  has(namespace: string) {
    return this.defs.has(namespace);
  }

  private def(namespace: string): Definition {
    const def = this.defs.get(namespace);
    if (!def) throw notFound("Settings namespace");
    return def;
  }

  private async resolve(def: Definition, scope: SettingsScope): Promise<Layer> {
    const tenantId = scope.tenantId ?? null;
    const userId = tenantId ? (scope.userId ?? null) : null;
    const key = cacheKey(def.namespace, tenantId, userId);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const layers = await this.loadLayers(this.db, def.namespace, tenantId, userId);
    const value = this.compute(def, layers);
    this.cache.set(key, value);
    return value;
  }

  private compute(def: Definition, l: Layers): Layer {
    return resolveSettings(def.schema, def.defaults, [l.app, l.tenant, pickKeys(l.user, def.userOverridable)]) as Layer;
  }

  private async loadLayers(db: DbOrTx, namespace: string, tenantId: string | null, userId: string | null): Promise<Layers> {
    const appScope = and(isNull(settingsValues.tenantId), isNull(settingsValues.userId));
    let scopeFilter: SQL | undefined = appScope;
    if (tenantId) {
      const tenantScope = and(
        eq(settingsValues.tenantId, tenantId),
        userId ? or(isNull(settingsValues.userId), eq(settingsValues.userId, userId)) : isNull(settingsValues.userId),
      );
      scopeFilter = or(appScope, tenantScope);
    }
    const rows = await db
      .select({ tenantId: settingsValues.tenantId, userId: settingsValues.userId, value: settingsValues.value })
      .from(settingsValues)
      .where(and(eq(settingsValues.namespace, namespace), scopeFilter));
    const layers: Layers = { app: null, tenant: null, user: null };
    for (const r of rows) {
      if (r.tenantId === null && r.userId === null) layers.app = r.value;
      else if (r.tenantId === tenantId && r.userId === null) layers.tenant = r.value;
      else if (r.tenantId === tenantId && userId && r.userId === userId) layers.user = r.value;
    }
    return layers;
  }

  private async write(def: Definition, tenantId: string | null, userId: string | null, patch: unknown): Promise<Layer> {
    const parsed = validatePatch(def.schema, patch, userId ? def.userOverridable : undefined);

    const merged = await this.db.transaction(async (tx) => {
      const layers = await this.loadLayers(tx, def.namespace, tenantId, userId);
      const level: keyof Layers = userId ? "user" : tenantId ? "tenant" : "app";
      const next = applyPatch(layers[level], parsed);
      layers[level] = next;

      // Validate the merged result at this scope against the full schema (throws ZodError â†’ 400).
      const below = level === "app" ? [next] : level === "tenant" ? [layers.app, next] : [layers.app, layers.tenant, next];
      def.schema.parse(mergeLayers(def.defaults, ...below));

      const where = and(
        eq(settingsValues.namespace, def.namespace),
        tenantId ? eq(settingsValues.tenantId, tenantId) : isNull(settingsValues.tenantId),
        userId ? eq(settingsValues.userId, userId) : isNull(settingsValues.userId),
      );
      if (Object.keys(next).length === 0) {
        await tx.delete(settingsValues).where(where);
      } else {
        await tx
          .insert(settingsValues)
          .values({ namespace: def.namespace, tenantId, userId, value: next })
          .onConflictDoUpdate({
            target: [settingsValues.namespace, settingsValues.tenantId, settingsValues.userId],
            set: { value: next, updatedAt: new Date() },
          });
      }
      return this.compute(def, layers);
    });

    this.invalidate(def.namespace, tenantId, userId);
    return merged;
  }

  private invalidate(namespace: string, tenantId: string | null, userId: string | null) {
    if (!tenantId) this.cache.deletePrefix(`${namespace}|`);
    else if (!userId) this.cache.deletePrefix(`${namespace}|${tenantId}|`);
    else this.cache.deletePrefix(cacheKey(namespace, tenantId, userId));
  }
}

const cacheKey = (namespace: string, tenantId: string | null, userId: string | null) =>
  `${namespace}|${tenantId ?? ""}|${userId ?? ""}`;
