"use client";

import { useSyncExternalStore } from "react";
import { validateSlug } from "@srirealtime/tenancy/slug";
import { getStoredTenant, useStored, TENANT_KEY } from "./session";

/**
 * How an app finds the shop it works for:
 * - `{ from: "hostname" }`: the subdomain names the shop (raja.localhost:3001 → "raja"). `rootDomain` defaults to
 *   NEXT_PUBLIC_ROOT_DOMAIN, else "localhost".
 * - `{ from: "storage" }`: the user picks the shop in the UI; the slug lives in localStorage (`sr_tenant`).
 */
export type TenantStrategy = { from: "hostname"; rootDomain?: string } | { from: "storage" };

const ENV_ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost").toLowerCase().replace(/^\.+|\.+$/g, "");

let strategy: TenantStrategy = { from: "hostname" };

/** Called once by createWebApp. */
export function setTenantStrategy(next: TenantStrategy) {
  strategy = next;
}
export const getTenantStrategy = () => strategy;

/** Root domain shops live under: raja.localhost (dev) or raja.srikit.in (production). */
export function rootDomain(): string {
  return strategy.from === "hostname" && strategy.rootDomain
    ? strategy.rootDomain.toLowerCase().replace(/^\.+|\.+$/g, "")
    : ENV_ROOT;
}

/** Shop address rules (3–40 chars, a-z 0-9 -, `RESERVED_SLUGS`): one source shared with the API. */
const isShopSlug = (s: string) => validateSlug(s).ok;

/**
 * "raja.localhost:3001" → "raja"; "raja.srikit.in" → "raja" (root srikit.in);
 * "localhost", "srikit.in", "www.srikit.in", IPs and unrelated hosts → null.
 */
export function tenantFromHost(host: string | null | undefined, root: string = rootDomain()): string | null {
  if (!host) return null;
  const h = host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!h || h === root) return null;
  const suffix = `.${root}`;
  if (!h.endsWith(suffix)) return null;
  const sub = h.slice(0, -suffix.length);
  // Only the label right before the root names the shop ("x.raja.localhost" → "raja").
  const slug = sub.split(".").pop() ?? "";
  return isShopSlug(slug) ? slug : null;
}

/** Shop slug for this page (client only; null on the server or when there is none). */
export function currentTenantSlug(): string | null {
  if (typeof window === "undefined") return null;
  if (strategy.from === "storage") {
    const s = getStoredTenant();
    return s && isValidShopSlug(s) ? s : null;
  }
  return tenantFromHost(window.location.host);
}

const noopSubscribe = () => () => {};

/** `undefined` during SSR / hydration, then the slug (or null when there is no shop). */
export function useTenantSlug(): string | null | undefined {
  const stored = useStored(TENANT_KEY);
  const host = useSyncExternalStore(
    noopSubscribe,
    () => (strategy.from === "hostname" ? tenantFromHost(window.location.host) : "\u0000storage"),
    () => undefined,
  );
  if (host === undefined) return undefined;
  if (strategy.from === "storage") return stored && isValidShopSlug(stored) ? stored : null;
  return host;
}

/** URL of a shop's app on its own subdomain, keeping the current protocol and port (dev helper). */
export function shopUrl(slug: string): string {
  if (typeof window === "undefined") return `https://${slug}.${rootDomain()}`;
  const { protocol, port } = window.location;
  return `${protocol}//${slug}.${rootDomain()}${port ? `:${port}` : ""}/`;
}

/** The bare root (no shop subdomain), keeping protocol and port. */
export function rootUrl(): string {
  if (typeof window === "undefined") return "/";
  const { protocol, port } = window.location;
  return `${protocol}//${rootDomain()}${port ? `:${port}` : ""}/`;
}

export const isValidShopSlug = (s: string) => isShopSlug(s);
export { RESERVED_SLUGS, validateSlug } from "@srirealtime/tenancy/slug";
