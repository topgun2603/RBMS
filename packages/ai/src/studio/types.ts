import type { ZodType } from "zod";

/** Studio assistant (docs/ai.md, Phase 4 part A). The safety core: typed operations on the shop's existing configuration. */

export type Risk = "low" | "medium" | "high";
export type Lang = "en" | "ta";
export interface Bi {
  en: string;
  ta: string;
}

/** An operation could not run (unknown id, value out of range, would lock people out...). Code-level, shown to the owner. */
export class OpError extends Error {
  constructor(
    public readonly code: string,
    public readonly text: Bi,
  ) {
    super(text.en);
  }
}

/** Who asks. `fullAccess` = owner or admin. Everything else needs the op's own permission. */
export interface StudioActor {
  userId: string;
  fullAccess: boolean;
  permissions: string[];
  /** The read-only demo role: never plans or applies. */
  demo?: boolean;
}

/** Things the ops need to know that are not in the areas: platform lists and the shop's references. */
export interface StudioEnv {
  now: Date;
  /** Effective platform defaults of the brand tokens (the branding service's defaults). */
  brandDefaults: Record<string, unknown>;
  /** Every permission key the platform defines (for validating role edits). */
  knownPermissions: string[];
  /** Which sign-in methods exist on this platform. */
  signInPlatform: Record<string, boolean>;
  /** The shop's business type ("" when none). */
  trade: string;
  /** Slugs the shop has: categories, collections, pages (menu links and sections may only point at these). */
  refs: { categories: string[]; collections: string[]; pages: string[]; categoryIds: string[] };
  /** Feature keys the owner may switch (shopToggle) with their label. */
  toggles: { key: string; label: string }[];
}

/** Named pieces of the shop's configuration an op reads and changes. See `areas.ts`. */
export type AreaId = string;

export class StudioState {
  private readonly data = new Map<AreaId, unknown>();
  private readonly original = new Map<AreaId, string>();
  readonly written = new Set<AreaId>();

  constructor(initial: Record<AreaId, unknown> = {}) {
    for (const [k, v] of Object.entries(initial)) this.load(k, v);
  }
  load(area: AreaId, value: unknown) {
    this.data.set(area, structuredClone(value));
    this.original.set(area, JSON.stringify(value ?? null));
  }
  has(area: AreaId) {
    return this.data.has(area);
  }
  get<T>(area: AreaId): T {
    if (!this.data.has(area)) throw new OpError("area_missing", { en: "Could not read that part of the shop.", ta: "கடையின் அந்தப் பகுதியைப் படிக்க முடியவில்லை." });
    return this.data.get(area) as T;
  }
  set(area: AreaId, value: unknown) {
    this.data.set(area, value);
    this.written.add(area);
  }
  /** Areas whose content now differs from what was loaded. */
  changed(): AreaId[] {
    return [...this.data.keys()].filter((a) => JSON.stringify(this.data.get(a) ?? null) !== this.original.get(a));
  }
  before(area: AreaId): unknown {
    const s = this.original.get(area);
    return s === undefined ? undefined : JSON.parse(s);
  }
  after(area: AreaId): unknown {
    return this.data.get(area);
  }
  clone(): StudioState {
    const c = new StudioState();
    for (const [k, v] of this.data) c.data.set(k, structuredClone(v));
    for (const [k, v] of this.original) c.original.set(k, v);
    for (const k of this.written) c.written.add(k);
    return c;
  }
}

export interface OpDef<P = any> {
  kind: string;
  group: OpGroup;
  label: Bi;
  /** What it changes, in one line each (shown in the plan card). */
  changes: Bi;
  risk: Risk;
  /** Permission the actor needs (owners and admins hold every one). null = no key, see `fullAccess`. */
  permission: string | null;
  /** The same route is owner/admin only in the app: needs a full-access role, whatever custom permissions the person has. */
  fullAccess: boolean;
  /** Feature keys that must be on for the shop (plan, app profile and the shop's own switch). */
  features: string[];
  schema: ZodType<P, any, any>;
  /** One compact line per parameter for the planner prompt. */
  help: string;
  /** Areas read and written for these parameters. */
  areas(p: P): AreaId[];
  /** Mutates the state or throws OpError. May return heads-up warnings. */
  run(p: P, st: StudioState, env: StudioEnv): void | Bi[];
  /** Plain words for this op with its values (en + ta). */
  describe(p: P): Bi;
  /** Targets two ops can fight over: the same key in two ops of one plan is reported as a conflict when they disagree. */
  target?(p: P): string | null;
  /** Visual (storefront) change: the live preview shows it. */
  visual?: boolean;
}

export type OpGroup = "theme" | "home" | "menus" | "pages" | "store" | "bills" | "team" | "signin" | "features" | "ai" | "catalogue";

export const OP_GROUP_LABEL: Record<OpGroup, Bi> = {
  theme: { en: "Store look", ta: "கடையின் தோற்றம்" },
  home: { en: "Home page", ta: "முகப்புப் பக்கம்" },
  menus: { en: "Menus", ta: "மெனுக்கள்" },
  pages: { en: "Pages", ta: "பக்கங்கள்" },
  store: { en: "Store settings", ta: "கடை அமைப்புகள்" },
  bills: { en: "Bills and receipts", ta: "பில்கள், ரசீதுகள்" },
  team: { en: "Roles and discounts", ta: "பணிகள், தள்ளுபடி வரம்பு" },
  signin: { en: "Sign-in", ta: "உள்நுழைவு" },
  features: { en: "Features", ta: "வசதிகள்" },
  ai: { en: "AI settings", ta: "AI அமைப்புகள்" },
  catalogue: { en: "Product groups", ta: "பொருள் வகைகள்" },
};

/** A planned operation as stored and shown. */
export interface PlannedOp {
  kind: string;
  params: Record<string, unknown>;
  /** The model flagged this as the closest doable thing, not what was asked. */
  alternative?: boolean;
  why?: string;
}

export type OpStatus = "ok" | "blocked" | "invalid";

export interface CheckedOp extends PlannedOp {
  status: OpStatus;
  label: Bi;
  description: Bi;
  risk: Risk;
  group: OpGroup;
  /** Why it is blocked or invalid. */
  problem?: { code: string; text: Bi };
  /** Heads-up that does not stop it (hides a section on all screens...). */
  warnings: Bi[];
  /** Areas this op touches. */
  areas: AreaId[];
  visual: boolean;
}

export type Classification = "full" | "partial" | "none";

export interface ChangeLine {
  area: AreaId;
  /** "Primary colour" */
  label: Bi;
  before: Bi;
  after: Bi;
}

export interface StudioPreview {
  /** Full brand tokens after the change (feeds the live store preview), when the look changes. */
  tokens?: Record<string, unknown>;
  /** Home sections after the change, with ids, when the home page changes. */
  sections?: Record<string, unknown>[];
  lines: ChangeLine[];
}

export const FEATURE_THEMES = [
  "storefront-look",
  "home-page",
  "store-settings",
  "bills-documents",
  "team-permissions",
  "sign-in",
  "marketing-engagement",
  "integrations",
  "catalogue-products",
  "reports-accounting",
  "other",
] as const;
export type FeatureTheme = (typeof FEATURE_THEMES)[number];

export interface Unsupported {
  text: string;
  /** What the platform is missing, in a sentence. */
  missing: string;
  theme: FeatureTheme;
}

export type { ZodType };
