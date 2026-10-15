"use client";

import { readStored, useStored, writeStored } from "./session";
import { currentTenantSlug } from "./tenant";

/**
 * The branch the user works in (multi-branch shops, docs/batch3.md §B3). Stored per shop in localStorage
 * (`sr_branch:<slug>` = branch id) and sent as `x-branch` on every API call by `api()` / `apiDownload()`.
 * No stored value = the server picks (the user's home branch, their only branch or the main branch).
 */
export const BRANCH_KEY_PREFIX = "sr_branch:";

/** Header the API reads the current branch from (branch id or code). */
export const BRANCH_HEADER = "x-branch";

/** Error codes the API answers a stale `x-branch` with; the kit then forgets the stored branch. */
export const BRANCH_ERROR_CODES = ["branch_not_found", "branch_forbidden"] as const;

export const branchKey = (slug: string) => `${BRANCH_KEY_PREFIX}${slug}`;

/** Stored branch id for a shop (default: the current one), or null. */
export function getStoredBranch(slug: string | null = currentTenantSlug()): string | null {
  if (!slug) return null;
  const v = readStored(branchKey(slug));
  return v && /^[0-9A-Za-z_-]{1,64}$/.test(v) ? v : null;
}

/** Remembers (or with null forgets) the branch for a shop (default: the current one). */
export function setStoredBranch(branchId: string | null, slug: string | null = currentTenantSlug()) {
  if (!slug) return;
  writeStored(branchKey(slug), branchId);
}

/** Reactive stored branch id of a shop (null during SSR / hydration and when none is stored). */
export function useStoredBranch(slug: string | null | undefined): string | null {
  const v = useStored(slug ? branchKey(slug) : `${BRANCH_KEY_PREFIX}\u0000`);
  return slug && v && /^[0-9A-Za-z_-]{1,64}$/.test(v) ? v : null;
}

/** True for API errors caused by a stored branch that is closed or no longer allowed. */
export const isBranchError = (code: string | null | undefined) => !!code && (BRANCH_ERROR_CODES as readonly string[]).includes(code);
