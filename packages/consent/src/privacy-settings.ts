import { z } from "zod";

/**
 * Settings namespace `privacy` (apps/api: `settings.define("privacy", PRIVACY_SETTINGS_SCHEMA, PRIVACY_SETTINGS_DEFAULTS, ...)`).
 * The platform's own values are the app-level settings; a shop's values are the tenant level (a shop that never saved
 * inherits the platform's grievance contact and retention defaults).
 */
export const PRIVACY_SETTINGS_SCHEMA = z.object({
  /** Grievance officer / contact person named in the privacy notice (DPDP Act s.8(10)). */
  grievanceName: z.string().max(120),
  grievanceRole: z.string().max(80),
  grievancePhone: z.string().max(20),
  grievanceEmail: z.string().email().or(z.literal("")),
  grievanceAddress: z.string().max(300),
  /** Days to answer a rights request. Default 30: TO CONFIRM against the final DPDP Rules. */
  responseDays: z.number().int().min(1).max(90),
  /** Per retention category: `{ enabled, days }`. A category not listed uses its default. Send the whole map. */
  retention: z.record(z.string().max(60), z.object({ enabled: z.boolean(), days: z.number().int().min(1).max(36500) })),
  /** Extra sentence(s) the shop wants in its notice (e.g. an extra purpose). Shown as written. */
  noticeExtra: z.string().max(1000),
});
export type PrivacySettings = z.infer<typeof PRIVACY_SETTINGS_SCHEMA>;

export const DEFAULT_RESPONSE_DAYS = 30;
/** The Board report window for a breach (DPDP Rules 2025, r.7): 72 hours from discovery, unless the Board allows longer. */
export const BREACH_REPORT_HOURS = 72;

export const PRIVACY_SETTINGS_DEFAULTS: PrivacySettings = {
  grievanceName: "",
  grievanceRole: "",
  grievancePhone: "",
  grievanceEmail: "",
  grievanceAddress: "",
  responseDays: DEFAULT_RESPONSE_DAYS,
  retention: {},
  noticeExtra: "",
};

/** The contact keys the storefront may read without signing in. */
export const PRIVACY_SETTINGS_PUBLIC_KEYS = ["grievanceName", "grievanceRole", "grievancePhone", "grievanceEmail", "grievanceAddress"];

/** Reads a stored settings object defensively (missing or malformed keys fall back to the defaults). */
export function normalisePrivacySettings(raw: unknown): PrivacySettings {
  const base = { ...PRIVACY_SETTINGS_DEFAULTS };
  if (!raw || typeof raw !== "object") return base;
  const parsed = PRIVACY_SETTINGS_SCHEMA.partial().safeParse(raw);
  return parsed.success ? { ...base, ...stripUndefined(parsed.data) } : base;
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
