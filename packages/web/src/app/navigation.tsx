"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FeatureAllowContext } from "../lib/features";
import { joinPath } from "./model";
import type { MountedModule, WebApp } from "./types";

export { joinPath, matchPattern, normalizeBase, relativeTo } from "./model";

// ------------------------------------------------------------------------------------------ contexts

export const WebAppContext = React.createContext<WebApp | null>(null);

export function useWebApp(): WebApp {
  const ctx = React.useContext(WebAppContext);
  if (!ctx) throw new Error("useWebApp must be used inside <WebAppRouter>");
  return ctx;
}
export const useOptionalWebApp = () => React.useContext(WebAppContext);

export interface ModuleContextValue {
  id: string;
  basePath: string;
}
const ModuleContext = React.createContext<ModuleContextValue>({ id: "", basePath: "/" });

/** Renders `children` as part of `module`: relative links resolve against its basePath, features against its restriction. */
export function ModuleScope({ module, children }: { module: MountedModule; children: React.ReactNode }) {
  const value = React.useMemo(() => ({ id: module.id, basePath: module.basePath }), [module.id, module.basePath]);
  return (
    <ModuleContext.Provider value={value}>
      <FeatureAllowContext.Provider value={module.features}>{children}</FeatureAllowContext.Provider>
    </ModuleContext.Provider>
  );
}

export const useModule = () => React.useContext(ModuleContext);

const ParamsContext = React.createContext<Record<string, string>>({});
export const RouteParamsProvider = ParamsContext.Provider;

/** Path params of the current module route ("invoices/:id" → { id }). */
export function useRouteParams<T extends Record<string, string> = Record<string, string>>(): T {
  return React.useContext(ParamsContext) as T;
}

// ------------------------------------------------------------------------------------------ hooks

/** Absolute href for a path relative to the current module: useModuleHref("invoices/42") → "/billing/invoices/42". */
export function useModuleHref(): (to: string) => string;
export function useModuleHref(to: string): string;
export function useModuleHref(to?: string): string | ((to: string) => string) {
  const { basePath } = useModule();
  const fn = React.useCallback((t: string) => joinPath(basePath, t), [basePath]);
  return to === undefined ? fn : fn(to);
}

/** Href of an app settings page: useSettingsHref()("features") → "/settings/features". */
export function useSettingsHref(): (path?: string) => string {
  const app = useOptionalWebApp();
  const base = app?.settingsPath ?? "/settings";
  return React.useCallback((p = "") => joinPath(base, p), [base]);
}

/** The current path ("/billing/invoices") and query string. */
export const useCurrentPath = () => usePathname() ?? "/";
export const useQueryParams = useSearchParams;

export interface NavigateOptions {
  replace?: boolean;
  scroll?: boolean;
}

/**
 * Navigation inside the module. `to` is module-relative ("invoices/42"); "?tab=gst" keeps the current path and
 * swaps the query string ("?" alone clears it). For app-level paths use useAppNavigate().
 */
export function useModuleNavigate() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const { basePath } = useModule();
  return React.useCallback(
    (to: string, opts: NavigateOptions = {}) => {
      const href = to.startsWith("?") ? `${pathname}${to === "?" ? "" : to}` : joinPath(basePath, to);
      if (opts.replace) router.replace(href, { scroll: opts.scroll });
      else router.push(href, { scroll: opts.scroll });
    },
    [router, pathname, basePath],
  );
}

/** Navigation to app-level paths ("/settings/features", "/login"). */
export function useAppNavigate() {
  const router = useRouter();
  return React.useCallback(
    (href: string, opts: NavigateOptions = {}) => (opts.replace ? router.replace(href, { scroll: opts.scroll }) : router.push(href, { scroll: opts.scroll })),
    [router],
  );
}

type AnchorProps = Omit<React.ComponentProps<"a">, "href">;

/** Link to a path relative to the current module (`to="invoices/new"`). `href` instead is an app-absolute path. */
export const ModuleLink = React.forwardRef<HTMLAnchorElement, AnchorProps & ({ to: string; href?: never } | { href: string; to?: never }) & { replace?: boolean; scroll?: boolean; prefetch?: boolean }>(
  function ModuleLink({ to, href, replace, scroll, prefetch, ...props }, ref) {
    const resolve = useModuleHref();
    const target = href ?? resolve(to ?? "");
    return <Link ref={ref} href={target} replace={replace} scroll={scroll} prefetch={prefetch} {...props} />;
  },
);

/** Plain next/link for app-absolute hrefs (used by the shell). */
export { Link as AppLink };
