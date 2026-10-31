/**
 * Shop address (subdomain) rules, shared by the API (`@rbms/tenancy`) and the web apps
 * (`@rbms/tenancy/slug`, browser-safe: this file imports nothing).
 */

/** Subdomains that can never be shop slugs: platform hosts, app names and sign-up/marketing paths. */
export const RESERVED_SLUGS: readonly string[] = [
  "www",
  "api",
  "admin",
  "app",
  "apps",
  "mail",
  "email",
  "smtp",
  "ftp",
  "static",
  "cdn",
  "assets",
  "media",
  "files",
  "uploads",
  "dashboard",
  "help",
  "support",
  "status",
  "blog",
  "docs",
  "billing",
  "store",
  "stores",
  "shop",
  "seller",
  "sellers",
  "signup",
  "login",
  "logout",
  "account",
  "accounts",
  "auth",
  "pricing",
  "about",
  "contact",
  "terms",
  "privacy",
  "refunds",
  "legal",
  "root",
  "system",
  "platform",
  "srikit",
  "srirealtime",
];

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

export type SlugCheck = { ok: true } | { ok: false; reason: string; code: "length" | "format" | "reserved" };

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const isReservedSlug = (slug: string) => RESERVED_SLUGS.includes(slug);

/** 3–40 chars, lowercase a-z, 0-9 and hyphens, no leading/trailing hyphen, not reserved. */
export function validateSlug(slug: string): SlugCheck {
  if (typeof slug !== "string") return { ok: false, code: "format", reason: "Slug must be a string" };
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return { ok: false, code: "length", reason: `Slug must be ${SLUG_MIN_LENGTH} to ${SLUG_MAX_LENGTH} characters` };
  }
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      code: "format",
      reason: "Slug may only contain lowercase letters, digits and hyphens, and cannot start or end with a hyphen",
    };
  }
  if (isReservedSlug(slug)) return { ok: false, code: "reserved", reason: `"${slug}" is reserved` };
  return { ok: true };
}

/** "Sri Murugan Stores!" → "sri-murugan-stores" (ASCII only; non-Latin names give ""). Max 40 chars. */
export function slugify(text: string): string {
  return (text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Candidate addresses when `slug` is taken or invalid: with the city/area, a "-shop"/"-stores" ending, then numbers.
 * Only valid slugs are returned (the caller removes taken ones).
 */
export function slugCandidates(slug: string, opts: { city?: string | null; count?: number } = {}): string[] {
  const base = slugify(slug).slice(0, SLUG_MAX_LENGTH - 4).replace(/-+$/g, "") || "shop";
  const city = opts.city ? slugify(opts.city) : "";
  const fit = (s: string) => s.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
  const out = [
    ...(city ? [fit(`${base}-${city}`), fit(`${city}-${base}`)] : []),
    fit(`${base}-shop`),
    fit(`${base}-stores`),
    fit(`my-${base}`),
    ...Array.from({ length: Math.max(opts.count ?? 9, 1) }, (_, i) => fit(`${base}${i + 1}`)),
  ];
  return [...new Set(out)].filter((s) => s !== slug && validateSlug(s).ok);
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
