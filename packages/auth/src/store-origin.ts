/**
 * Where a shopper's sign-in may be handed back to: the storefront origins of ONE shop. Firebase can't authorize every
 * `<shop>.rbms.in`, so sign-in happens on the landing site and a single-use handoff code goes back to the storefront
 * (docs/firebase-auth.md section 7). The code signs someone in, so the destination is decided here from the shop's own
 * configuration, never from what the query string claims.
 */

/** A shop as the storefront sign-in sees it. `origins` are the exact origins its storefront is served from. */
export interface StoreSignInShop {
  id: string;
  slug: string;
  name: string;
  origins: string[];
}

export interface StoreOriginsPort {
  /** The active shop with this slug and its storefront origins, or null. */
  shop(slug: string): Promise<StoreSignInShop | null>;
}

/** "HTTP://Anbu.LocalHost:3003/x?y#z" gives "http://anbu.localhost:3003"; null for anything that isn't a plain http(s) origin. */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string" || raw.length > 300) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  return u.origin.toLowerCase();
}

/**
 * The origins one shop's storefront is served from: each `STORE_PUBLIC_URL` template with the shop's slug (one template,
 * or per-app "EC=...,BL=..." entries), plus `https://<domain>` for each verified custom domain.
 */
export function storeOriginsFor(templateSetting: string, slug: string, verifiedDomains: readonly string[]): string[] {
  const templates = templateSetting.includes("=")
    ? templateSetting.split(",").map((e) => e.slice(e.indexOf("=") + 1).trim())
    : [templateSetting.trim()];
  const out = new Set<string>();
  for (const t of templates) {
    const o = t ? normalizeOrigin(t.replaceAll("{slug}", slug)) : null;
    if (o) out.add(o);
  }
  for (const d of verifiedDomains) {
    const o = normalizeOrigin(`https://${d.trim()}`);
    if (o) out.add(o);
  }
  return [...out];
}

/** The normalised origin when it is exactly one of `allowed`, else null. */
export function matchStoreOrigin(origin: string | null | undefined, allowed: readonly string[]): string | null {
  const o = normalizeOrigin(origin);
  return o && allowed.includes(o) ? o : null;
}

/** A redirect-mode return URL: must sit on the (already validated) origin and carry no credentials or fragment. */
export function matchStoreReturn(returnUrl: string | null | undefined, origin: string): string | null {
  if (!returnUrl) return null;
  let u: URL;
  try {
    u = new URL(returnUrl);
  } catch {
    return null;
  }
  if (u.origin.toLowerCase() !== origin || u.username || u.password) return null;
  u.hash = "";
  u.searchParams.delete("handoff");
  return u.toString();
}
