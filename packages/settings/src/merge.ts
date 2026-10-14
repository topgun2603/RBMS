import type { z } from "zod";

export type Layer = Record<string, unknown>;

/**
 * Shallow merge per top-level key: later layers win. A key whose value is `undefined` or `null`
 * in a layer does not override (nested objects are replaced as a whole, never deep-merged).
 */
export function mergeLayers(...layers: Array<Layer | null | undefined>): Layer {
  const out: Layer = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v !== undefined && v !== null) out[k] = v;
    }
  }
  return out;
}

/** Applies a patch to a stored override layer: `null` removes the override for that key. */
export function applyPatch(existing: Layer | null | undefined, patch: Layer): Layer {
  const out: Layer = { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** Keeps only `keys` from `obj` (all keys when `keys` is undefined). */
export function pickKeys(obj: Layer | null | undefined, keys: readonly string[] | undefined): Layer {
  if (!obj) return {};
  if (!keys) return { ...obj };
  const out: Layer = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

/** Splits a patch into keys being set and keys being cleared (null). */
export function splitPatch(patch: Layer): { set: Layer; cleared: string[] } {
  const set: Layer = {};
  const cleared: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) cleared.push(k);
    else if (v !== undefined) set[k] = v;
  }
  return { set, cleared };
}

/**
 * Merges layers over defaults and validates against the full schema. If stored overrides no longer
 * satisfy the schema (e.g. after a schema change), the offending top-level keys fall back to defaults
 * instead of breaking every read.
 */
export function resolveSettings<S extends z.ZodTypeAny>(schema: S, defaults: Layer, layers: Array<Layer | null | undefined>): z.infer<S> {
  const merged = mergeLayers(defaults, ...layers);
  const first = schema.safeParse(merged);
  if (first.success) return first.data;
  const repaired = { ...merged };
  for (const issue of first.error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string") continue;
    if (key in defaults) repaired[key] = defaults[key];
    else delete repaired[key];
  }
  return schema.parse(repaired);
}
