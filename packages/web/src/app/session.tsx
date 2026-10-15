"use client";

import * as React from "react";
import { canManageShop, effectiveRoles } from "../lib/auth";
import { useFeatures } from "../lib/features";
import { permissionAllows, type PermissionHolder, type PermissionReq } from "../lib/permissions";
import type { MeResponse } from "../lib/types";
import { visibleFor, type GateContext } from "./model";
import { joinPath, useOptionalWebApp } from "./navigation";
import type { Gated, MountedModule, SettingsPage, WebApp } from "./types";

export interface SessionValue {
  me: MeResponse;
  /** Effective shop roles (a super-admin counts as owner). */
  roles: string[];
  /** Owner or admin. */
  canManage: boolean;
  /** Permission patterns from /auth/me (null when the API sent none). */
  permissions: readonly string[] | null;
  /** `can("orders.cancel")` / `can(["a", "b"])` (any-of). Owners, admins and super-admins always can. */
  can: (req: PermissionReq | undefined) => boolean;
}

const SessionContext = React.createContext<SessionValue | null>(null);

export function SessionProvider({ me, children }: { me: MeResponse; children: React.ReactNode }) {
  const value = React.useMemo<SessionValue>(() => {
    const canManage = canManageShop(me);
    const permissions = Array.isArray(me.permissions) ? me.permissions : null;
    const holder: PermissionHolder = { fullAccess: canManage, permissions };
    return { me, roles: effectiveRoles(me), canManage, permissions, can: (req) => permissionAllows(holder, req) };
  }, [me]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** `can(req)` for the signed-in member; false outside the signed-in area. */
export function usePermission(req: PermissionReq | undefined): boolean {
  const session = useOptionalSession();
  return session ? session.can(req) : false;
}

/** The signed-in member (inside the app's signed-in area). */
export function useSession(): SessionValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside the signed-in area of a WebApp");
  return ctx;
}
export const useOptionalSession = () => React.useContext(SessionContext);

const NO_ACCESS: GateContext["access"] = { fullAccess: false, permissions: [] };

/** Gate context of the signed-in member (roles, permissions, features). Outside a session nothing gated by role/permission passes. */
export function useGateContext(): GateContext {
  const features = useFeatures();
  const session = useOptionalSession();
  return React.useMemo<GateContext>(
    () => ({
      roles: session?.roles ?? [],
      access: session ? { fullAccess: session.canManage, permissions: session.permissions } : NO_ACCESS,
      checkFeature: features.check,
    }),
    [features, session],
  );
}

/** `(gated, module?) => boolean`: role, permission and feature (server + the module's restriction) checks in one place. */
export function useVisible(): (g: Gated, module?: Pick<MountedModule, "features">) => boolean {
  const ctx = useGateContext();
  return React.useMemo(() => visibleFor(ctx), [ctx]);
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
