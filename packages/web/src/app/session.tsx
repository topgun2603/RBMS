"use client";

import * as React from "react";
import { canManageShop, effectiveRoles, roleAllows } from "../lib/auth";
import { useFeatures } from "../lib/features";
import type { MeResponse } from "../lib/types";
import { joinPath, useOptionalWebApp } from "./navigation";
import type { Gated, MountedModule, SettingsPage, WebApp } from "./types";

export interface SessionValue {
  me: MeResponse;
  /** Effective shop roles (a super-admin counts as owner). */
  roles: string[];
  /** Owner or admin. */
  canManage: boolean;
}

const SessionContext = React.createContext<SessionValue | null>(null);

export function SessionProvider({ me, children }: { me: MeResponse; children: React.ReactNode }) {
  const value = React.useMemo<SessionValue>(() => ({ me, roles: effectiveRoles(me), canManage: canManageShop(me) }), [me]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The signed-in member (inside the app's signed-in area). */
export function useSession(): SessionValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside the signed-in area of a WebApp");
  return ctx;
}
export const useOptionalSession = () => React.useContext(SessionContext);

/** `(gated, module?) => boolean`: feature (server + the module's restriction) and role checks in one place. */
export function useVisible() {
  const features = useFeatures();
  const session = useOptionalSession();
  const roles = session?.roles ?? [];
  return React.useCallback(
    (g: Gated, module?: Pick<MountedModule, "features">) => roleAllows(roles, g.roles) && features.check(g.feature, module?.features).ok,
    [features, roles],
  );
}

/** A settings page with the module it came from (null = built into the kit). */
export interface MountedSettingsPage extends SettingsPage {
  module: MountedModule | null;
  href: string;
}

/** Every settings page of the app in module order, the kit's own pages last. */
export function allSettingsPages(app: WebApp, builtIn: SettingsPage[]): MountedSettingsPage[] {
  const seen = new Set<string>();
  const out: MountedSettingsPage[] = [];
  const add = (p: SettingsPage, module: MountedModule | null) => {
    const path = p.path.replace(/^\/+|\/+$/g, "");
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ ...p, path, module, href: joinPath(app.settingsPath, path) });
  };
  for (const m of app.modules) for (const p of m.settings ?? []) add(p, m);
  for (const p of builtIn) add(p, null);
  return out;
}

/** Settings pages the current user may open (features + roles). */
export function useVisibleSettings(builtIn: SettingsPage[]): MountedSettingsPage[] {
  const app = useOptionalWebApp();
  const visible = useVisible();
  return React.useMemo(
    () => (app ? allSettingsPages(app, builtIn).filter((p) => visible(p, p.module ?? undefined)) : []),
    [app, builtIn, visible],
  );
}
