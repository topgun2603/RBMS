import { permissionMatches, permissionsAllow, sha256, type PermissionDef } from "@rbms/core";
import { randomBytes } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const API_KEY_RANDOM_LENGTH = 32;
/** Stored (and shown in lists) so staff can tell keys apart: `sk_live_` + the first 4 random characters. */
export const API_KEY_PREFIX_LENGTH = 12;
export const API_KEY_RE = /^sk_(live|test)_[0-9A-Za-z]{32}$/;

export type ApiKeyMode = "live" | "test";

/** Unbiased base62 string from crypto random bytes (rejection sampling). */
export function randomBase62(length: number): string {
  let out = "";
  while (out.length < length) {
    const buf = randomBytes(length * 2);
    for (const b of buf) {
      // 248 = 62 * 4: values >= 248 would bias the first characters.
      if (b < 248) out += BASE62[b % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export const hashApiKey = (token: string) => sha256(token);
export const apiKeyPrefix = (token: string) => token.slice(0, API_KEY_PREFIX_LENGTH);

/** Mode for new keys: live in production, test elsewhere. */
export const keyModeFor = (production: boolean): ApiKeyMode => (production ? "live" : "test");

/** A new key. `token` is shown to the user once; only `hash` and `prefix` are stored. */
export function generateApiKey(mode: ApiKeyMode) {
  const token = `sk_${mode}_${randomBase62(API_KEY_RANDOM_LENGTH)}`;
  return { token, hash: hashApiKey(token), prefix: apiKeyPrefix(token), mode };
}

/** Well-formed key for this environment (production accepts only `sk_live_`). */
export function isApiKeyToken(token: string, production: boolean): boolean {
  const m = API_KEY_RE.exec(token);
  if (!m) return false;
  return production ? m[1] === "live" : true;
}

/** Any bearer that looks like an API key (so auth can leave it alone and we can answer 401 for a bad one). */
export const looksLikeApiKey = (token: string | null | undefined): token is string =>
  !!token && (token.startsWith("sk_live_") || token.startsWith("sk_test_"));

export interface ScopeGrantor {
  /** Owners, admins and super-admins may grant any scope. */
  fullAccess: boolean;
  /** The creator's own permission patterns. */
  permissions: readonly string[];
}

export type ScopeCheck = { ok: true; scopes: string[] } | { ok: false; invalid: string[]; notHeld: string[] };

const SCOPE_RE = /^(\*|[a-z0-9-]+(\.([a-z0-9-]+|\*))*)$/;

/**
 * Validates API key scopes against the registered permission defs:
 * - each scope is a permission key, or a pattern (`invoices.*`, `*`) that covers at least one registered key;
 * - a grantor without full access may only grant keys they hold themselves (no privilege escalation): every
 *   registered key a scope covers must be allowed by the grantor's permissions.
 * Returns the de-duplicated scopes, or the offending ones.
 */
export function validateScopes(scopes: readonly string[], registry: readonly PermissionDef[], grantor?: ScopeGrantor): ScopeCheck {
  const keys = [...new Set(registry.map((p) => p.key))];
  const unique = [...new Set(scopes.map((s) => s.trim()))];
  const invalid: string[] = [];
  const notHeld: string[] = [];
  for (const scope of unique) {
    const covered = SCOPE_RE.test(scope) ? keys.filter((k) => permissionMatches(scope, k)) : [];
    if (covered.length === 0) {
      invalid.push(scope);
      continue;
    }
    if (grantor && !grantor.fullAccess && !covered.every((k) => permissionsAllow(grantor.permissions, k))) notHeld.push(scope);
  }
  if (invalid.length || notHeld.length) return { ok: false, invalid, notHeld };
  return { ok: true, scopes: unique };
}
