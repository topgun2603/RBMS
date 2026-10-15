/** Seller portal pages (module-relative patterns, static segments before ":id"). Pure, for the portal router and tests. */
export type PortalPage = "dashboard" | "onboarding" | "products" | "product-new" | "product-edit" | "orders" | "payouts" | "profile";

const PAGES: [pattern: string, page: PortalPage][] = [
  ["", "dashboard"],
  ["onboarding", "onboarding"],
  ["products", "products"],
  ["products/new", "product-new"],
  ["products/:id", "product-edit"],
  ["orders", "orders"],
  ["payouts", "payouts"],
  ["profile", "profile"],
];

/** Path relative to the module base ("/" or "/seller"), or null when outside it. */
export function relativePath(base: string, path: string): string | null {
  const p = (path.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  if (base === "/" || base === "") return p.replace(/^\/+/, "");
  if (p === base) return "";
  return p.startsWith(`${base}/`) ? p.slice(base.length + 1) : null;
}

/** Which portal page a relative path shows (null = not found). */
export function portalPageOf(rel: string): { page: PortalPage; params: Record<string, string> } | null {
  const r = rel.split("/").filter(Boolean);
  for (const [pattern, page] of PAGES) {
    const p = pattern.split("/").filter(Boolean);
    if (p.length !== r.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < p.length; i++) {
      if (p[i]!.startsWith(":")) params[p[i]!.slice(1)] = decodeURIComponent(r[i]!);
      else if (p[i] !== r[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { page, params };
  }
  return null;
}

/** Portal nav: [href, label key, phone tab]. */
export const PORTAL_NAV = [
  { href: "", page: "dashboard", label: "marketplace.portal.nav.home" },
  { href: "products", page: "products", label: "marketplace.portal.nav.products" },
  { href: "orders", page: "orders", label: "marketplace.portal.nav.orders" },
  { href: "payouts", page: "payouts", label: "marketplace.portal.nav.payouts" },
  { href: "profile", page: "profile", label: "marketplace.portal.nav.profile" },
] as const;
