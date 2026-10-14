import type { CurrentPlan, Plan, UsageItem } from "./types";

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

export const paiseToRupees = (paise: number) => Math.round(paise) / 100;

/** "storage_bytes" → "Storage bytes" (used when no translation exists for a usage key). */
export function humanizeKey(key: string): string {
  const s = key.replace(/[_.-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const isUnlimited = (limit: number | null | undefined) => limit === undefined || limit === null || limit < 0;

export function usagePercent(u: Pick<UsageItem, "used" | "limit">): number {
  if (isUnlimited(u.limit)) return 0;
  if (u.limit === 0) return u.used > 0 ? 100 : 0;
  return Math.min(100, Math.round((u.used / u.limit) * 100));
}

/** Storage-ish usage keys are reported in bytes or megabytes; format accordingly. */
export function formatUsageValue(key: string, n: number): string {
  if (/bytes?$/i.test(key)) return formatBytes(n);
  if (/(^|_)mb$/i.test(key)) return formatBytes(n * 1024 * 1024);
  if (/(^|_)gb$/i.test(key)) return formatBytes(n * 1024 * 1024 * 1024);
  return n.toLocaleString("en-IN");
}

/**
 * GET /plans/current has had two shapes: `{ plan, entitlements, usage: { items } }` (current API)
 * and `{ planId, modules, limits, features, usage: { key: { used, limit } } }`. Accept both.
 */
export function normalizeCurrentPlan(raw: unknown): CurrentPlan {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ent = (r.entitlements ?? r) as Record<string, unknown>;
  const plan = (r.plan ?? null) as Plan | null;
  let usage: UsageItem[] = [];
  const u = r.usage as unknown;
  if (Array.isArray(u)) usage = u as UsageItem[];
  else if (u && typeof u === "object") {
    const items = (u as { items?: unknown }).items;
    if (Array.isArray(items)) usage = items as UsageItem[];
    else
      usage = Object.entries(u as Record<string, { used?: number; limit?: number }>).map(([key, v]) => ({
        key,
        used: Number(v?.used ?? 0),
        limit: Number(v?.limit ?? -1),
      }));
  }
  return {
    planId: (ent.planId as string | null | undefined) ?? plan?.id ?? null,
    plan,
    modules: (ent.modules as string[] | undefined) ?? plan?.modules ?? [],
    limits: (ent.limits as Record<string, number> | undefined) ?? plan?.limits ?? {},
    features: (ent.features as Record<string, boolean> | undefined) ?? plan?.features ?? {},
    usage,
  };
}

/** Roughly identifies a device from a user agent string for the sessions list. */
export function describeUserAgent(ua: string | null | undefined): { browser: string; os: string; mobile: boolean } {
  const s = ua ?? "";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\//.test(s)
      ? "Opera"
      : /Chrome\//.test(s)
        ? "Chrome"
        : /Firefox\//.test(s)
          ? "Firefox"
          : /Safari\//.test(s)
            ? "Safari"
            : /okhttp|Dart|Flutter/i.test(s)
              ? "App"
              : s
                ? "Browser"
                : "—";
  const os = /Android/.test(s)
    ? "Android"
    : /iPhone|iPad|iOS/.test(s)
      ? "iOS"
      : /Windows/.test(s)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(s)
          ? "macOS"
          : /Linux/.test(s)
            ? "Linux"
            : "";
  return { browser, os, mobile: /Mobile|Android|iPhone/.test(s) };
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** "Acme Traders Pvt" → "acme-traders-pvt" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** "98765 43210" → "+919876543210"; emails are lowercased; anything else is passed through. */
export function normalizeTarget(raw: string): { target: string; kind: "phone" | "email" | "invalid" } {
  const v = raw.trim();
  if (v.includes("@")) {
    const email = v.toLowerCase();
    return { target: email, kind: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "email" : "invalid" };
  }
  const digits = v.replace(/[^\d+]/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return { target: `+91${digits}`, kind: "phone" };
  if (/^0[6-9]\d{9}$/.test(digits)) return { target: `+91${digits.slice(1)}`, kind: "phone" };
  if (/^91[6-9]\d{9}$/.test(digits)) return { target: `+${digits}`, kind: "phone" };
  if (/^\+\d{8,15}$/.test(digits)) return { target: digits, kind: "phone" };
  return { target: v, kind: "invalid" };
}
