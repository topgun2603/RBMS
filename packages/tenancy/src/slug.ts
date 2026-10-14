/** Subdomains that can never be tenant slugs. */
export const RESERVED_SLUGS: readonly string[] = [
  "www",
  "api",
  "admin",
  "app",
  "mail",
  "static",
  "cdn",
  "assets",
  "dashboard",
  "help",
  "support",
  "status",
  "blog",
  "docs",
];

export type SlugCheck = { ok: true } | { ok: false; reason: string };

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** 3–40 chars, lowercase a-z, 0-9 and hyphens, no leading/trailing hyphen, not reserved. */
export function validateSlug(slug: string): SlugCheck {
  if (typeof slug !== "string") return { ok: false, reason: "Slug must be a string" };
  if (slug.length < 3 || slug.length > 40) return { ok: false, reason: "Slug must be 3 to 40 characters" };
  if (!SLUG_RE.test(slug)) {
    return { ok: false, reason: "Slug may only contain lowercase letters, digits and hyphens, and cannot start or end with a hyphen" };
  }
  if (RESERVED_SLUGS.includes(slug)) return { ok: false, reason: `"${slug}" is reserved` };
  return { ok: true };
}

/** Lowercases, strips the port and any trailing dot. Returns "" for bracketed IPv6 hosts. */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) return "";
  const colon = h.indexOf(":");
  if (colon >= 0) h = h.slice(0, colon);
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

/**
 * Returns the tenant slug for a direct subdomain of `rootDomain`, otherwise null.
 * "acme.srikit.com" → "acme"; "srikit.com" → null; "a.b.srikit.com" → null; reserved names → null.
 */
export function slugFromHost(host: string | undefined | null, rootDomain: string): string | null {
  if (!host) return null;
  const h = normalizeHost(host);
  const root = normalizeHost(rootDomain);
  if (!h || !root || h === root) return null;
  if (!h.endsWith(`.${root}`)) return null;
  const sub = h.slice(0, -(root.length + 1));
  if (!sub || sub.includes(".")) return null;
  return validateSlug(sub).ok ? sub : null;
}

/** True if `host` is the root domain or any subdomain of it (so it can't be a custom domain). */
export function isPlatformHost(host: string, rootDomain: string): boolean {
  const h = normalizeHost(host);
  const root = normalizeHost(rootDomain);
  return h === root || h.endsWith(`.${root}`);
}

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Validates a custom domain such as "shop.acme.in". */
export const isValidDomain = (domain: string) => DOMAIN_RE.test(domain);
