"use client";

import * as React from "react";
import { displayName, useFeature, useOptionalShop, usePermission, useSession, useTenantSlug } from "@srirealtime/web";
import { POS_FEATURES, POS_PERMISSIONS } from "../lib/access";
import { setPosBranch, useMyBranches, useSellerProfile } from "../lib/api";
import { useOnline, type OnlineState } from "../lib/online";
import { storageKey, useLocalState } from "../lib/storage";
import type { Branch, SellerProfile } from "../lib/types";
import { useTerminal, type TerminalEnv } from "./terminal/terminal-context";

export interface PosEnv {
  tenant: string | null;
  userId: string;
  cashier: string;
  shopName: string;
  seller: Partial<SellerProfile>;
  sellerLoading: boolean;
  /** GST state of the counter (branch state, else the business profile's). Null = profile incomplete. */
  sellerState: string | null;
  branch: Branch | null;
  branches: Branch[];
  setBranch: (code: string) => void;
  online: OnlineState;
  /** Terminal mode (paired device, PIN session); null for the normal signed-in counter. */
  terminal: TerminalEnv | null;
  has: {
    catalogue: boolean;
    inventory: boolean;
    loyalty: boolean;
    whatsapp: boolean;
    creditBook: boolean;
    reports: boolean;
    branches: boolean;
    /** Paired terminals + PIN unlock (the POS catalogue cache, terminal mode). */
    terminals: boolean;
    /** Weigh tickets can be scanned. */
    weighing: boolean;
  };
  can: { discount: boolean; price: boolean; cancel: boolean; creditNote: boolean; till: boolean };
}

const PosContext = React.createContext<PosEnv | null>(null);

export function usePos(): PosEnv {
  const ctx = React.useContext(PosContext);
  if (!ctx) throw new Error("usePos must be used inside <PosProvider>");
  return ctx;
}

export function PosProvider({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  const tenant = useTenantSlug();
  const shop = useOptionalShop();
  const seller = useSellerProfile();
  const online = useOnline();
  const has = {
    catalogue: useFeature(POS_FEATURES.catalogue),
    inventory: useFeature(POS_FEATURES.inventory),
    loyalty: useFeature(POS_FEATURES.loyalty),
    whatsapp: useFeature(POS_FEATURES.whatsapp),
    creditBook: useFeature(POS_FEATURES.creditBook),
    reports: useFeature(POS_FEATURES.reports),
    branches: useFeature(POS_FEATURES.branches),
    terminals: useFeature(POS_FEATURES.terminals),
    weighing: useFeature(POS_FEATURES.weighing),
  };
  const terminal = useTerminal();
  // On a paired device the device's own feature list (GET /pos/device) is the word.
  if (terminal) {
    has.terminals = terminal.has(POS_FEATURES.terminals);
    has.weighing = terminal.has(POS_FEATURES.weighing);
  }
  const terminalBranch = terminal?.device.terminal.branchId ?? null;
  const can = {
    discount: usePermission(POS_PERMISSIONS.discount),
    price: usePermission(POS_PERMISSIONS.price),
    cancel: usePermission(POS_PERMISSIONS.cancel),
    creditNote: usePermission(POS_PERMISSIONS.creditNote),
    till: usePermission(POS_PERMISSIONS.till),
  };
  const branchesQuery = useMyBranches(has.branches);
  const [storedBranch, setStoredBranch] = useLocalState<string | null>(storageKey("branch", tenant, me.user.id), null);
  const allBranches = React.useMemo(() => branchesQuery.data?.items ?? [], [branchesQuery.data]);
  // A terminal belongs to one branch: no switching there.
  const branches = React.useMemo(() => {
    const own = terminalBranch ? allBranches.filter((b) => b.id === terminalBranch) : [];
    return own.length ? own : allBranches;
  }, [allBranches, terminalBranch]);
  const branch = React.useMemo(() => {
    if (branches.length === 0) return null;
    const d = branchesQuery.data;
    return (
      branches.find((b) => b.code === storedBranch) ??
      branches.find((b) => b.id === d?.currentBranchId) ??
      branches.find((b) => b.isHome) ??
      branches.find((b) => b.id === d?.defaultBranchId) ??
      branches[0]!
    );
  }, [branches, branchesQuery.data, storedBranch]);

  // Every POS call sends x-branch from now on (set during render so the first queries already carry it).
  setPosBranch(branch?.code ?? null);
  React.useEffect(() => () => setPosBranch(null), []);

  const values = seller.data ?? {};
  const value: PosEnv = {
    tenant: tenant ?? null,
    userId: me.user.id,
    cashier: displayName(me.user),
    shopName: shop?.shopName ?? terminal?.device.shop.name ?? values.legalName ?? tenant ?? "",
    seller: values,
    sellerLoading: seller.isLoading,
    sellerState: branch?.stateCode || values.stateCode || null,
    branch,
    branches,
    setBranch: setStoredBranch,
    online,
    terminal,
    has,
    can,
  };
  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
}
