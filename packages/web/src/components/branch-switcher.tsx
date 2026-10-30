"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDownIcon, HomeIcon, StoreIcon } from "lucide-react";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  motion,
  toast,
} from "@rbms/ui";
import { api } from "../lib/api";
import { setStoredBranch, useStoredBranch } from "../lib/branch";
import { useFeature } from "../lib/features";
import { useI18n } from "../lib/i18n";
import { useTenantSlug } from "../lib/tenant";

/** Feature key of multi-branch shops (declared by @rbms/branches). */
export const MULTI_BRANCH_FEATURE = "multi-branch";

/** A branch as `GET /v1/branches/mine` returns it (the fields the switcher uses). */
export interface MyBranchItem {
  id: string;
  name: string;
  code: string;
  city: string | null;
  isDefault: boolean;
  /** The user's home branch. */
  isHome: boolean;
}

export interface MyBranchesResponse {
  items: MyBranchItem[];
  total: number;
  defaultBranchId: string;
  /** What the server chose for this request (the user's home / only / main branch when no header was sent). */
  currentBranchId: string | null;
}

export const myBranchesQueryKey = (slug: string | null | undefined) => ["branches", "mine", slug ?? null] as const;

/**
 * The branch shown as current: the stored choice when it is still one of the user's branches, else what the server
 * picked, else the home branch, else the main branch. Pure (tested).
 */
export function pickCurrentBranch(data: Pick<MyBranchesResponse, "items" | "defaultBranchId" | "currentBranchId"> | undefined, stored: string | null): MyBranchItem | null {
  if (!data || data.items.length === 0) return null;
  const by = (id: string | null | undefined) => (id ? data.items.find((b) => b.id === id) : undefined);
  return by(stored) ?? by(data.currentBranchId) ?? data.items.find((b) => b.isHome) ?? by(data.defaultBranchId) ?? data.items[0] ?? null;
}

/** Branches the signed-in user can work in, for the current shop (only fetched when `multi-branch` is on). */
export function useMyBranches() {
  const on = useFeature(MULTI_BRANCH_FEATURE);
  const slug = useTenantSlug();
  return useQuery({
    queryKey: myBranchesQueryKey(slug),
    queryFn: () => api.get<MyBranchesResponse>("/branches/mine"),
    enabled: on && !!slug,
    staleTime: 60_000,
    retry: (n, err) => (err as { status?: number }).status !== 403 && n < 1,
  });
}

/** The branch the user is working in (null for single-branch shops). */
export function useCurrentBranch(): MyBranchItem | null {
  const slug = useTenantSlug();
  const stored = useStoredBranch(slug);
  const { data } = useMyBranches();
  return pickCurrentBranch(data, stored);
}

/**
 * Top-bar branch switcher: visible when `multi-branch` is on and the user has more than one branch. The choice is
 * stored per shop and sent as `x-branch` on every API request; switching refetches every query.
 */
export function BranchSwitcher({ className }: { className?: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const slug = useTenantSlug();
  const stored = useStoredBranch(slug);
  const { data } = useMyBranches();
  const current = pickCurrentBranch(data, stored);

  // A stored branch that is no longer usable (closed, unassigned) is forgotten.
  React.useEffect(() => {
    if (data && stored && !data.items.some((b) => b.id === stored)) setStoredBranch(null, slug ?? null);
  }, [data, stored, slug]);

  if (!data || data.items.length < 2 || !current) return null;

  const choose = (b: MyBranchItem) => {
    if (b.id === current.id) return;
    setStoredBranch(b.id, slug ?? null);
    // Everything branch-scoped (bills, stock, reports) reloads for the new branch.
    void qc.invalidateQueries();
    toast.success(t("web.branch.switched", { name: b.name }));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("mr-1 max-w-[11rem] gap-1.5 rounded-full px-2.5 sm:max-w-[15rem]", className)}
          aria-label={t("web.branch.switch", { name: current.name })}
        >
          <StoreIcon className="text-primary" />
          <motion.span key={current.id} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} className="truncate">
            <span className="font-semibold sm:hidden">{current.code}</span>
            <span className="hidden sm:inline">{current.name}</span>
          </motion.span>
          <ChevronsUpDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t("web.branch.title")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {data.items.map((b) => {
          const active = b.id === current.id;
          return (
            <DropdownMenuItem key={b.id} className="min-h-11 gap-2.5" onSelect={() => choose(b)} aria-current={active ? "true" : undefined}>
              <span className={cn("icon-chip size-8 shrink-0 rounded-lg text-xs font-semibold", active ? "text-primary" : "text-muted-foreground")}>
                {b.code.slice(0, 4)}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium">{b.name}</span>
                <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {b.isDefault ? t("web.branch.main") : (b.city ?? b.code)}
                  {b.isHome && (
                    <>
                      {" · "}
                      <HomeIcon className="size-3" aria-hidden /> {t("web.branch.home")}
                    </>
                  )}
                </span>
              </span>
              {active && <CheckIcon className="text-primary" aria-hidden />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
