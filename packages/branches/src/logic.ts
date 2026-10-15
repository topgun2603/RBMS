/**
 * Pure rules of the branches module: codes, bill prefixes, GSTIN ↔ state checks, deactivation rules and the
 * per-request branch choice. No database, no Fastify.
 */

// ---------------------------------------------------------------- GST helpers
// Same rules as @srirealtime/gst (which this package may not import): format + mod-36 check character.

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** GST state / UT codes in current use (retired 25 and 28 left out), same list as @srirealtime/gst. */
export const GST_STATE_CODES: readonly string[] = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "20", "21", "22", "23", "24", "26", "27", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "97",
];

export const normalizeGstin = (gstin: string) => gstin.replace(/\s+/g, "").toUpperCase();

function gstinCheckChar(first14: string): string | null {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]!);
    if (v < 0) return null;
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

export function isValidGstin(gstin: string | null | undefined): boolean {
  if (typeof gstin !== "string") return false;
  const g = normalizeGstin(gstin);
  return GSTIN_FORMAT.test(g) && gstinCheckChar(g.slice(0, 14)) === g[14];
}

/** "33" / "3" / 33 → "33"; anything else → null. */
export function normalizeStateCode(code: string | number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const s = String(code).trim();
  return /^\d{1,2}$/.test(s) ? s.padStart(2, "0") : null;
}

export const isValidStateCode = (code: string | null | undefined) => {
  const c = normalizeStateCode(code);
  return c !== null && GST_STATE_CODES.includes(c);
};

export const stateFromGstin = (gstin: string | null | undefined): string | null => {
  if (typeof gstin !== "string") return null;
  const m = /^\s*(\d{2})/.exec(gstin);
  return m ? normalizeStateCode(m[1]) : null;
};

export type GstCheck = { ok: true; gstin: string | null; stateCode: string | null } | { ok: false; field: "gstin" | "stateCode"; message: string };

/**
 * Validates a branch's GSTIN and state together. The GSTIN (optional) must be valid; the state (optional, taken from
 * the GSTIN when missing) must be a GST state code and equal the GSTIN's first two digits.
 */
export function checkGstState(gstin: string | null | undefined, stateCode: string | null | undefined): GstCheck {
  const g = gstin ? normalizeGstin(gstin) : null;
  if (g && !isValidGstin(g)) return { ok: false, field: "gstin", message: "Enter a valid 15-character GSTIN" };
  let state: string | null = null;
  if (stateCode !== null && stateCode !== undefined && String(stateCode).trim() !== "") {
    state = normalizeStateCode(stateCode);
    if (!state || !isValidStateCode(state)) return { ok: false, field: "stateCode", message: "Choose a valid GST state" };
  }
  const fromGstin = g ? stateFromGstin(g) : null;
  if (g && !state) state = fromGstin;
  if (g && fromGstin !== state) {
    return {
      ok: false,
      field: "gstin",
      message: `This GSTIN is registered in state ${fromGstin}, but the branch is in state ${state}. Use the GSTIN of the branch's state.`,
    };
  }
  return { ok: true, gstin: g, stateCode: state };
}

// ---------------------------------------------------------------- codes and prefixes

/** Branch codes: up to 16 of A-Z, 0-9, "-" or "_", starting with a letter or digit (same as stock location codes). */
export const BRANCH_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,15}$/;
export const DEFAULT_BRANCH_CODE = "MAIN";
export const DEFAULT_BRANCH_NAME = "Main";

/** Bill number prefixes: at most 6 of A-Z, 0-9 and "-" (GST rule 46 keeps the whole number within 16 characters). */
export const MAX_PREFIX_LENGTH = 6;
export const DEFAULT_INVOICE_PREFIX = "INV";
export const INVOICE_PREFIX_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{0,4}[A-Z0-9])?$/;

export const normalizeCode = (code: string) => code.trim().toUpperCase();

/** Upper-cases and keeps A-Z, 0-9 and "-", max 6, no trailing "-"; empty → "INV" (the invoices module's rule). */
export function sanitizePrefix(prefix: string | null | undefined): string {
  const p = (prefix ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/^-+/, "")
    .slice(0, MAX_PREFIX_LENGTH)
    .replace(/-+$/, "");
  return p || DEFAULT_INVOICE_PREFIX;
}

/** Null when `prefix` (already upper-cased) is usable, else the message. */
export function prefixProblem(prefix: string): string | null {
  if (!INVOICE_PREFIX_PATTERN.test(prefix)) {
    return "Bill prefix: 1 to 6 letters, digits or -, starting and ending with a letter or digit";
  }
  return null;
}

/**
 * A free prefix for a new branch from its code: "MDU-NORTH" → "MDU-NO"; when taken, the last characters become a
 * number ("MDU-N2", "MDU-N3", ...). `taken` is compared case-insensitively.
 */
export function suggestPrefix(code: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toUpperCase()));
  const base = sanitizePrefix(code.replace(/_/g, "-"));
  if (!used.has(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const suffix = String(n);
    const candidate = `${base.slice(0, MAX_PREFIX_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("No free bill prefix");
}

// ---------------------------------------------------------------- lifecycle rules

/** Null when the branch may be closed, else why not: not the default branch, and never the last active one. */
export function deactivateProblem(branch: { isDefault: boolean; active: boolean }, activeCount: number): string | null {
  if (!branch.active) return null;
  if (branch.isDefault) return "This is the main branch. Make another branch the main branch first, then close this one.";
  if (activeCount <= 1) return "A shop needs at least one open branch";
  return null;
}

// ---------------------------------------------------------------- the request's branch

export interface BranchLite {
  id: string;
  code: string;
  locationId: string | null;
  isDefault: boolean;
}

export interface Assignment {
  branchId: string;
  isDefault: boolean;
}

/**
 * Who is asking:
 * - `all`: owners, admins and super-admins (every branch);
 * - `assigned`: other staff (their assigned branches; none assigned = the default branch);
 * - `public`: no signed-in member (shoppers, public links): always the default branch, the header is ignored.
 */
export type BranchAccess = { kind: "all"; assignments?: Assignment[] } | { kind: "assigned"; assignments: Assignment[] } | { kind: "public" };

export type BranchChoice =
  | { ok: true; branch: BranchLite | null }
  | { ok: false; error: "not_found" | "forbidden"; header: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Finds an active branch by id or (case-insensitive) code. */
export function findBranch<T extends BranchLite>(branches: readonly T[], ref: string): T | undefined {
  const r = ref.trim();
  if (UUID.test(r)) {
    const id = r.toLowerCase();
    return branches.find((b) => b.id.toLowerCase() === id);
  }
  const code = r.toUpperCase();
  return branches.find((b) => b.code === code);
}

const byCode = <T extends BranchLite>(a: T, b: T) => a.code.localeCompare(b.code);

/** The shop's default branch among `active` (first by code if the default is missing or closed). */
export function shopDefault<T extends BranchLite>(active: readonly T[]): T | null {
  return active.find((b) => b.isDefault) ?? [...active].sort(byCode)[0] ?? null;
}

/** Branches the caller may work in, in display order (default first, then by code). */
export function usableBranches<T extends BranchLite>(active: readonly T[], access: BranchAccess): T[] {
  const sorted = [...active].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || byCode(a, b));
  if (access.kind === "all") return sorted;
  const fallback = shopDefault(active);
  if (access.kind === "public") return fallback ? [fallback] : [];
  const ids = new Set(access.assignments.map((a) => a.branchId));
  const mine = sorted.filter((b) => ids.has(b.id));
  // Staff without (open) assignments work at the default branch.
  return mine.length > 0 ? mine : fallback ? [fallback] : [];
}

/**
 * The branch for a request. `active` are the shop's open branches; `header` is the raw `x-branch` value.
 * - no branches → null (header ignored);
 * - header (not for `public`) → that branch if it exists and is usable, else `not_found` / `forbidden`;
 * - otherwise the user's home branch (default assignment), else their only usable branch, else the shop default
 *   when usable, else the first usable branch.
 */
export function chooseBranch<T extends BranchLite>(
  active: readonly T[],
  access: BranchAccess,
  header?: string | null,
): { ok: true; branch: T | null } | { ok: false; error: "not_found" | "forbidden"; header: string } {
  if (active.length === 0) return { ok: true, branch: null };
  const usable = usableBranches(active, access);
  const ref = access.kind === "public" ? "" : (header ?? "").trim();
  if (ref) {
    const hit = findBranch(active, ref);
    if (!hit) return { ok: false, error: "not_found", header: ref };
    if (!usable.some((b) => b.id === hit.id)) return { ok: false, error: "forbidden", header: ref };
    return { ok: true, branch: hit };
  }
  const assignments = access.kind === "public" ? [] : (access.assignments ?? []);
  const homeId = assignments.find((a) => a.isDefault)?.branchId;
  const home = homeId ? usable.find((b) => b.id === homeId) : undefined;
  if (home) return { ok: true, branch: home };
  if (usable.length === 1) return { ok: true, branch: usable[0]! };
  const def = usable.find((b) => b.isDefault);
  return { ok: true, branch: def ?? usable[0] ?? null };
}

// ---------------------------------------------------------------- dates (IST)

const IST_OFFSET_MS = 330 * 60_000;

/** "YYYY-MM-DD" of `d` in India time. */
export const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Default summary range: first of the current IST month to today (both inclusive). */
export function monthToDate(now: Date): { from: string; to: string } {
  const today = istDate(now);
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Days between two "YYYY-MM-DD" dates (to − from). */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
