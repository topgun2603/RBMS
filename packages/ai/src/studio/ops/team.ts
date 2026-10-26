import { permissionMatches } from "@srirealtime/core";
import { z } from "zod";
import { AREA, fail, type DiscountsArea, type FeatureArea, type RolesArea, type SignInArea } from "../areas";
import type { StudioEnv } from "../types";
import { defineOp } from "./util";

const ROLE_KEY = /^[a-z][a-z0-9-]{1,31}$/;
const PATTERN = /^(\*|[a-z][a-z0-9-]*)(\.(\*|[a-z][a-z0-9-]*))*$/;

/**
 * Permissions Studio never hands out, whatever the request says (including "all permissions"): anything that also
 * covers managing the team, managing AI or the shop settings. Granting those stays a manual step in Settings > Team.
 */
export const NEVER_GRANT = ["staff.manage", "ai.manage", "settings.manage"] as const;
/** Most new permission entries one request may add to a role. */
export const MAX_GRANTS = 12;

export function grantProblem(granted: string, env: StudioEnv): { en: string; ta: string } | null {
  if (!PATTERN.test(granted)) return { en: `"${granted}" is not a permission.`, ta: `"${granted}" ஒரு அனுமதி அல்ல.` };
  if (NEVER_GRANT.some((k) => permissionMatches(granted, k)))
    return { en: `"${granted}" would also let that role manage the team, AI or shop settings. Studio never grants that; do it by hand in Settings > Team if you really mean it.`, ta: `"${granted}" அனுமதி அந்தப் பணிக்கு குழு, AI அல்லது கடை அமைப்புகளை நிர்வகிக்கும் உரிமையையும் தரும். Studio அதை ஒருபோதும் வழங்காது; உண்மையிலேயே தேவையெனில் அமைப்புகள் > குழுவில் கையால் செய்யுங்கள்.` };
  if (!granted.includes("*") && !env.knownPermissions.includes(granted)) return { en: `"${granted}" is not a permission this app has.`, ta: `"${granted}" இந்தச் செயலியில் உள்ள அனுமதி அல்ல.` };
  if (granted.includes("*") && !env.knownPermissions.some((k) => permissionMatches(granted, k))) return { en: `"${granted}" matches no permission.`, ta: `"${granted}" எந்த அனுமதிக்கும் பொருந்தவில்லை.` };
  return null;
}

const perm = z.string().trim().min(1).max(100);
const roleLabel = (r: { key: string }) => r.key;

export const roleCreate = defineOp({
  kind: "role.create",
  group: "team",
  label: { en: "Create a role", ta: "பணியை (role) உருவாக்கு" },
  changes: { en: "A new staff role with a set of permissions", ta: "அனுமதிகளுடன் புதிய ஊழியர் பணி" },
  risk: "high",
  permission: "staff.manage",
  fullAccess: false,
  features: ["staff"],
  schema: z.object({ key: z.string().trim().regex(ROLE_KEY, "2-32 lowercase letters, digits or hyphens"), name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).optional(), permissions: z.array(perm).min(1).max(MAX_GRANTS) }),
  help: "key (lowercase-with-hyphens), name, description?, permissions: up to 12 keys or patterns like invoices.create, catalogue.view, *.view (from search_permissions). Never staff/ai/settings management",
  areas: () => [AREA.roles],
  target: (p) => `role:${p.key}`,
  describe: (p) => ({ en: `Create the role "${p.name}" with ${p.permissions.length} permissions`, ta: `"${p.name}" பணியை ${p.permissions.length} அனுமதிகளுடன் உருவாக்கு` }),
  run(p, st, env) {
    const cur = structuredClone(st.get<RolesArea>(AREA.roles));
    if (cur.roles.some((r) => r.key === p.key)) fail("role_exists", `A role "${p.key}" already exists.`, `"${p.key}" பணி ஏற்கனவே உள்ளது.`);
    for (const g of p.permissions) {
      const prob = grantProblem(g, env);
      if (prob) fail("forbidden_grant", prob.en, prob.ta);
    }
    cur.roles.push({ key: p.key, name: p.name, description: p.description ?? "", permissions: [...new Set(p.permissions)], builtin: false });
    st.set(AREA.roles, cur);
  },
});

export const roleEdit = defineOp({
  kind: "role.edit",
  group: "team",
  label: { en: "Change a role's permissions", ta: "பணியின் அனுமதிகளை மாற்று" },
  changes: { en: "Add or remove permissions of a role (everyone with that role is affected)", ta: "பணியின் அனுமதிகளைச் சேர்/நீக்கு (அந்தப் பணி உள்ள அனைவரும் பாதிக்கப்படுவர்)" },
  risk: "high",
  permission: "staff.manage",
  fullAccess: false,
  features: ["staff"],
  schema: z
    .object({ key: z.string().trim().regex(ROLE_KEY), add: z.array(perm).max(MAX_GRANTS).optional(), remove: z.array(perm).max(40).optional(), name: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(500).optional() })
    .refine((v) => (v.add?.length ?? 0) + (v.remove?.length ?? 0) > 0 || v.name !== undefined || v.description !== undefined, "Nothing to change"),
  help: "key: the role key from get_roles; add?: permissions to add (up to 12); remove?: permissions to remove; name?, description?",
  areas: () => [AREA.roles],
  target: (p) => `role:${p.key}`,
  describe: (p) => ({ en: `Role "${p.key}": ${[p.add?.length && `add ${p.add.join(", ")}`, p.remove?.length && `remove ${p.remove.join(", ")}`, p.name && `rename to ${p.name}`].filter(Boolean).join("; ")}`, ta: `"${p.key}" பணி: ${[p.add?.length && `சேர் ${p.add.join(", ")}`, p.remove?.length && `நீக்கு ${p.remove.join(", ")}`, p.name && `பெயர் ${p.name}`].filter(Boolean).join("; ")}` }),
  run(p, st, env) {
    const cur = structuredClone(st.get<RolesArea>(AREA.roles));
    const role = cur.roles.find((r) => r.key === p.key);
    if (!role) fail("role_not_found", `There is no role "${p.key}".`, `"${p.key}" பணி இல்லை.`);
    for (const g of p.add ?? []) {
      const prob = grantProblem(g, env);
      if (prob) fail("forbidden_grant", prob.en, prob.ta);
    }
    const removeSet = new Set(p.remove ?? []);
    const next = role.permissions.filter((x) => !removeSet.has(x));
    for (const g of p.add ?? []) if (!next.includes(g)) next.push(g);
    if (next.length === 0) fail("empty_role", "A role needs at least one permission.", "ஒரு பணிக்கு குறைந்தது ஒரு அனுமதி வேண்டும்.");
    role.permissions = next;
    if (p.name) role.name = p.name;
    if (p.description !== undefined) role.description = p.description;
    st.set(AREA.roles, cur);
    return [{ en: `Everyone with the "${roleLabel(role)}" role gets this change at once.`, ta: `"${roleLabel(role)}" பணி உள்ள அனைவருக்கும் இந்த மாற்றம் உடனே பொருந்தும்.` }];
  },
});

const rupeesToPaise = (n: number) => Math.round(n * 100);
export const discountSet = defineOp({
  kind: "discount.set_limit",
  group: "team",
  label: { en: "Set a discount limit for a role", ta: "பணிக்கு தள்ளுபடி வரம்பை அமை" },
  changes: { en: "The most discount people with a role can give on a bill without a manager's PIN", ta: "மேலாளர் PIN இல்லாமல் ஒரு பணி உள்ளவர் பில்லில் தரக்கூடிய அதிகபட்ச தள்ளுபடி" },
  risk: "high",
  permission: "staff.manage",
  fullAccess: false,
  features: ["staff"],
  schema: z
    .object({ role: z.string().trim().regex(ROLE_KEY), maxPercent: z.number().min(0).max(100).nullable().optional(), maxAmountRupees: z.number().min(0).max(10_000_000).nullable().optional() })
    .refine((v) => (v.maxPercent ?? null) !== null || (v.maxAmountRupees ?? null) !== null, "Give a percent or an amount limit"),
  help: "role: a role key from get_roles (e.g. cashier, default, manager); maxPercent? (a line's discount, 0-100); maxAmountRupees? (total discount per bill in rupees). Owners and admins are never limited",
  areas: () => [AREA.roles, AREA.discounts],
  target: (p) => `discount:${p.role}`,
  describe: (p) => ({ en: `Discount limit for "${p.role}": ${[p.maxPercent != null && `${p.maxPercent}% a line`, p.maxAmountRupees != null && `₹${p.maxAmountRupees} a bill`].filter(Boolean).join(", ")}`, ta: `"${p.role}" பணிக்கு தள்ளுபடி வரம்பு: ${[p.maxPercent != null && `வரிக்கு ${p.maxPercent}%`, p.maxAmountRupees != null && `பில்லுக்கு ₹${p.maxAmountRupees}`].filter(Boolean).join(", ")}` }),
  run(p, st) {
    const roles = st.get<RolesArea>(AREA.roles).roles;
    if (!roles.some((r) => r.key === p.role)) fail("role_not_found", `There is no role "${p.role}".`, `"${p.role}" பணி இல்லை.`);
    const cur = structuredClone(st.get<DiscountsArea>(AREA.discounts));
    const row = cur.items.find((i) => i.scope === "role" && i.subject === p.role);
    const next = { scope: "role" as const, subject: p.role, maxPercent: p.maxPercent ?? null, maxAmount: p.maxAmountRupees != null ? rupeesToPaise(p.maxAmountRupees) : null };
    if (row) Object.assign(row, next);
    else cur.items.push(next);
    st.set(AREA.discounts, cur);
    return [{ en: "Above this limit a manager must approve with their PIN at the counter.", ta: "இந்த வரம்புக்கு மேல் கவுண்டரில் மேலாளர் தம் PIN மூலம் அனுமதிக்க வேண்டும்." }];
  },
});

export const discountRemove = defineOp({
  kind: "discount.remove_limit",
  group: "team",
  label: { en: "Remove a role's discount limit", ta: "பணியின் தள்ளுபடி வரம்பை நீக்கு" },
  changes: { en: "Lets that role give any discount again", ta: "அந்தப் பணி மீண்டும் எந்தத் தள்ளுபடியும் தரலாம்" },
  risk: "high",
  permission: "staff.manage",
  fullAccess: false,
  features: ["staff"],
  schema: z.object({ role: z.string().trim().regex(ROLE_KEY) }),
  help: "role: the role key whose limit to remove",
  areas: () => [AREA.discounts],
  target: (p) => `discount:${p.role}`,
  describe: (p) => ({ en: `Remove the discount limit of "${p.role}"`, ta: `"${p.role}" பணியின் தள்ளுபடி வரம்பை நீக்கு` }),
  run(p, st) {
    const cur = structuredClone(st.get<DiscountsArea>(AREA.discounts));
    const n = cur.items.length;
    cur.items = cur.items.filter((i) => !(i.scope === "role" && i.subject === p.role));
    if (cur.items.length === n) fail("no_limit", `"${p.role}" has no discount limit.`, `"${p.role}" பணிக்கு தள்ளுபடி வரம்பு இல்லை.`);
    st.set(AREA.discounts, cur);
  },
});

// ------------------------------------------------------------------ sign-in

const METHODS = ["sms", "whatsapp", "email_code", "google", "password"] as const;
export const signinSet = defineOp({
  kind: "signin.set_methods",
  group: "signin",
  label: { en: "Sign-in options", ta: "உள்நுழைவு விருப்பங்கள்" },
  changes: { en: "Which sign-in methods staff or shoppers can use, which comes first, and two-factor for the team", ta: "ஊழியர்கள்/வாடிக்கையாளர்கள் பயன்படுத்தக்கூடிய உள்நுழைவு முறைகள், முதல் முறை, குழுவுக்கு இரு-படி சரிபார்ப்பு" },
  risk: "high",
  permission: null,
  fullAccess: true,
  features: [],
  schema: z
    .object({ audience: z.enum(["staff", "customer"]), methods: z.array(z.enum(METHODS)).min(1).max(5).optional(), default: z.enum(METHODS).optional(), requireMfa: z.boolean().optional() })
    .refine((v) => v.methods !== undefined || v.default !== undefined || v.requireMfa !== undefined, "Give a value"),
  help: "audience: staff (the team) | customer (shoppers); methods?: list of sms|whatsapp|email_code|google|password; default?: the method shown first; requireMfa?: staff only, owners/admins/managers must use two-factor",
  areas: () => [AREA.signin],
  target: (p) => `signin:${p.audience}`,
  describe: (p) => ({ en: `Sign-in for ${p.audience === "staff" ? "the team" : "shoppers"}: ${[p.methods && `methods ${p.methods.join(", ")}`, p.default && `first ${p.default}`, p.requireMfa !== undefined && `two-factor ${p.requireMfa ? "required" : "not required"}`].filter(Boolean).join("; ")}`, ta: `${p.audience === "staff" ? "குழுவின்" : "வாடிக்கையாளர்களின்"} உள்நுழைவு: ${[p.methods && `முறைகள் ${p.methods.join(", ")}`, p.default && `முதலில் ${p.default}`, p.requireMfa !== undefined && `இரு-படி ${p.requireMfa ? "கட்டாயம்" : "கட்டாயமில்லை"}`].filter(Boolean).join("; ")}` }),
  run(p, st, env) {
    const cur = structuredClone(st.get<SignInArea>(AREA.signin));
    const a = cur[p.audience];
    const methods = p.methods ? [...new Set(p.methods)] : a.methods;
    if (!methods.some((m) => env.signInPlatform[m])) fail("no_method_enabled", "At least one sign-in method that works on this platform must stay on.", "இந்தத் தளத்தில் செயல்படும் குறைந்தது ஒரு உள்நுழைவு முறை இயக்கத்தில் இருக்க வேண்டும்.");
    const def = p.default ?? (methods.includes(a.default) ? a.default : methods[0]!);
    if (!methods.includes(def)) fail("default_not_enabled", "The first method must be one of the enabled methods.", "முதல் முறை இயக்கப்பட்ட முறைகளில் ஒன்றாக இருக்க வேண்டும்.");
    if (p.requireMfa !== undefined && p.audience !== "staff") fail("mfa_staff_only", "Two-factor can only be required for the team.", "இரு-படி சரிபார்ப்பை குழுவுக்கு மட்டுமே கட்டாயமாக்க முடியும்.");
    const next: SignInArea[typeof p.audience] = { methods, default: def, ...(p.requireMfa !== undefined ? (p.requireMfa ? { requireMfa: true } : {}) : a.requireMfa ? { requireMfa: true } : {}) };
    cur[p.audience] = next;
    st.set(AREA.signin, cur);
    const removed = a.methods.filter((m) => !methods.includes(m));
    const warnings = [];
    if (removed.length) warnings.push({ en: `People who sign in with ${removed.join(", ")} will have to use another method.`, ta: `${removed.join(", ")} மூலம் உள்நுழைபவர்கள் வேறு முறையைப் பயன்படுத்த வேண்டும்.` });
    if (p.requireMfa) warnings.push({ en: "The owner, admins and managers without two-factor will be taken through its setup at their next sign-in.", ta: "இரு-படி இல்லாத உரிமையாளர், நிர்வாகிகள், மேலாளர்கள் அடுத்த உள்நுழைவில் அதை அமைக்க வேண்டும்." });
    return warnings;
  },
});

// ------------------------------------------------------------------ feature switches

export const featureToggle = defineOp({
  kind: "feature.toggle",
  group: "features",
  label: { en: "Switch a feature on or off", ta: "வசதியை இயக்கு / நிறுத்து" },
  changes: { en: "Features your plan includes that you can switch on or off for the shop", ta: "உங்கள் திட்டத்தில் உள்ள, கடைக்கு இயக்க/நிறுத்தக்கூடிய வசதிகள்" },
  risk: "medium",
  permission: null,
  fullAccess: true,
  features: [],
  schema: z.object({ feature: z.string().trim().min(1).max(80), enabled: z.boolean() }),
  help: "feature: a key from list_features (only switchable ones); enabled: true|false",
  areas: (p) => [AREA.feature(p.feature)],
  target: (p) => `feature:${p.feature}`,
  describe: (p) => ({ en: `Switch "${p.feature}" ${p.enabled ? "on" : "off"}`, ta: `"${p.feature}" வசதியை ${p.enabled ? "இயக்கு" : "நிறுத்து"}` }),
  run(p, st, env) {
    if (!env.toggles.some((t) => t.key === p.feature)) fail("not_switchable", `"${p.feature}" is not a feature you can switch from here.`, `"${p.feature}" ஐ இங்கிருந்து மாற்ற முடியாது.`);
    if (p.feature === "ai" || p.feature === "staff") fail("protected_feature", `"${p.feature}" cannot be switched from Studio.`, `"${p.feature}" ஐ Studio மூலம் மாற்ற முடியாது.`);
    const cur = structuredClone(st.get<FeatureArea>(AREA.feature(p.feature)));
    if (!cur.shopToggle) fail("not_switchable", `"${p.feature}" is not a feature you can switch from here.`, `"${p.feature}" ஐ இங்கிருந்து மாற்ற முடியாது.`);
    if (p.enabled && cur.reason && cur.reason !== "shop") fail("not_in_plan", `"${cur.label}" is not included in your plan${cur.reason === "app" ? " or app" : ""}.`, `"${cur.label}" உங்கள் திட்டத்தில் சேர்க்கப்படவில்லை.`);
    cur.shopEnabled = p.enabled;
    cur.enabled = p.enabled && (cur.reason === null || cur.reason === "shop");
    st.set(AREA.feature(p.feature), cur);
  },
});

export const TEAM_OPS = [roleCreate, roleEdit, discountSet, discountRemove, signinSet, featureToggle];
