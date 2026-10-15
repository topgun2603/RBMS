/**
 * Pure permission helpers (mirrors @srirealtime/core's matcher, which UI modules can't import).
 * Patterns: "*" (everything), "orders.*" (the module and all its keys), "*.view" (any module's view key).
 */

export function permissionMatches(granted: string, key: string): boolean {
  if (granted === "*" || granted === key) return true;
  if (!granted.includes("*")) return false;
  const g = granted.split(".");
  const k = key.split(".");
  for (let i = 0; i < g.length; i++) {
    const seg = g[i]!;
    const last = i === g.length - 1;
    if (seg === "*" && last) return k.length >= i; // `module.*` also matches `module` itself
    if (i >= k.length) return false;
    if (seg !== "*" && seg !== k[i]) return false;
  }
  return g.length === k.length;
}

export const permissionsAllow = (granted: readonly string[] | undefined, key: string): boolean =>
  (granted ?? []).some((g) => permissionMatches(g, key));

/** True when `p` is a pattern (contains "*") rather than one concrete key. */
export const isPattern = (p: string) => p.includes("*");

/** The pattern in `granted` (other than `key` itself) that already covers `key`, if any. */
export const coveringPattern = (granted: readonly string[], key: string): string | null =>
  granted.find((g) => g !== key && isPattern(g) && permissionMatches(g, key)) ?? null;

/** Role key from a display name: lowercase ASCII, digits and hyphens, starting with a letter, 2–32 chars. */
export const ROLE_KEY_RE = /^[a-z][a-z0-9-]{1,31}$/;

export function roleKeyFrom(name: string, taken: ReadonlySet<string> = new Set()): string {
  let base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/g, "");
  if (base.length < 2) base = "role";
  let key = base;
  for (let i = 2; taken.has(key) || !ROLE_KEY_RE.test(key); i++) key = `${base}-${i}`.slice(0, 32);
  return key;
}

/** English names of the server's built-in role templates (packages/staff/src/templates.ts). */
export const BUILTIN_ROLE_NAMES: Record<string, string> = {
  default: "Staff (default)",
  manager: "Manager",
  cashier: "Cashier",
  accountant: "Accountant",
  delivery: "Delivery",
  "stock-keeper": "Stock keeper",
};

/** The built-in role that applies to staff without a custom role; not assigned by hand. */
export const DEFAULT_ROLE_KEY = "default";
