import { badRequest } from "@rbms/core";
import type { z } from "zod";
import { splitPatch, type Layer } from "./merge";

export const isPlainObject = (v: unknown): v is Layer => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validates a patch: set keys against `schema.partial().strict()`, cleared (null) keys must exist in
 * the schema, and when `allowedKeys` is given every touched key must be in it.
 * Returns the parsed patch with cleared keys as `null`.
 */
export function validatePatch(schema: z.AnyZodObject, patch: unknown, allowedKeys?: readonly string[]): Layer {
  if (!isPlainObject(patch)) throw badRequest("Settings patch must be an object");
  const { set, cleared } = splitPatch(patch);
  const known = new Set(Object.keys(schema.shape));
  const unknown = cleared.filter((k) => !known.has(k));
  if (unknown.length) throw badRequest(`Unknown setting keys: ${unknown.join(", ")}`, { keys: unknown });
  if (allowedKeys) {
    const allowed = new Set(allowedKeys);
    const blocked = [...Object.keys(set), ...cleared].filter((k) => !allowed.has(k));
    if (blocked.length) throw badRequest(`These settings cannot be changed per user: ${blocked.join(", ")}`, { keys: blocked });
  }
  const parsed = schema.partial().strict().parse(set) as Layer;
  const out: Layer = { ...parsed };
  for (const k of cleared) out[k] = null;
  return out;
}
