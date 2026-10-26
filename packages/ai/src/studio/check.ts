import { permissionsAllow } from "@srirealtime/core";
import { createHash } from "node:crypto";
import { ALL_OPS, opOf } from "./ops";
import { buildPreview } from "./diff";
import { OpError, StudioState, type AreaId, type Bi, type CheckedOp, type Classification, type OpDef, type PlannedOp, type StudioActor, type StudioEnv, type StudioPreview, type Unsupported } from "./types";

/** Key order independent JSON, so the same configuration always hashes the same. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}
export const hashOf = (v: unknown) => createHash("sha1").update(stable(v)).digest("hex");

export interface FeatureStatus {
  enabled: boolean;
  /** app / plan: not in this plan; shop: the owner switched it off; dependency: another feature is off. */
  reason: "app" | "plan" | "dependency" | "shop" | null;
  label: string;
}

export interface CheckDeps {
  env: StudioEnv;
  actor: StudioActor;
  feature(key: string): Promise<FeatureStatus>;
  /** Current content of areas (the same readers the apply step uses). */
  readAreas(areas: AreaId[]): Promise<Record<AreaId, unknown>>;
}

export interface CheckResult {
  ops: CheckedOp[];
  classification: Classification;
  preview: StudioPreview;
  /** Areas the plan changes, with the content they had when it was checked. */
  base: Record<AreaId, unknown>;
  /** Hash of each changed area when checked: the apply step refuses if the shop moved on. */
  baseHash: Record<AreaId, string>;
  /** The simulated shop after the plan. */
  state: StudioState;
  highRisk: boolean;
  /** Per op: what its areas held before and after it ran (the "before snapshot per operation"). */
  snapshots: Record<number, Record<AreaId, { before: unknown; after: unknown }>>;
  blockedCount: number;
}

const TEXT = {
  unknown: { en: "Studio has no way to do this.", ta: "இதைச் செய்யும் வசதி Studio-வில் இல்லை." },
  demo: { en: "The demo account can only look.", ta: "டெமோ கணக்கு பார்வைக்கு மட்டுமே." },
};

const safeDescribe = (op: OpDef, p: unknown): Bi => {
  try {
    return op.describe(p);
  } catch {
    return op.label;
  }
};

export function permissionProblem(op: OpDef, a: StudioActor): Bi | null {
  if (a.demo) return TEXT.demo;
  if (a.fullAccess) return null;
  if (op.fullAccess) return { en: "Only the shop owner or an admin can change this.", ta: "இதை கடை உரிமையாளர் அல்லது நிர்வாகி மட்டுமே மாற்ற முடியும்." };
  if (op.permission && !permissionsAllow(a.permissions, op.permission)) return { en: `You need the "${op.permission}" permission for this. Ask the owner.`, ta: `இதற்கு "${op.permission}" அனுமதி வேண்டும். உரிமையாளரிடம் கேளுங்கள்.` };
  return null;
}

/** People below owner/admin can only hand out permissions they hold themselves. */
function grantScope(op: OpDef, p: Record<string, unknown>, a: StudioActor): Bi | null {
  if (a.fullAccess) return null;
  const granted = [...((op.kind === "role.create" ? (p.permissions as string[]) : op.kind === "role.edit" ? (p.add as string[]) : []) ?? [])];
  const holds = (g: string) => (g.includes("*") ? a.permissions.some((m) => m === "*" || m === g || (m.endsWith(".*") && g.startsWith(m.slice(0, -1)))) : permissionsAllow(a.permissions, g));
  for (const g of granted) if (!holds(g)) return { en: `You cannot give a role "${g}" because you do not hold it yourself.`, ta: `"${g}" அனுமதி உங்களிடம் இல்லாததால் அதை ஒரு பணிக்கு வழங்க முடியாது.` };
  return null;
}

async function featureProblem(op: OpDef, deps: CheckDeps): Promise<Bi | null> {
  for (const key of op.features) {
    const f = await deps.feature(key);
    if (f.enabled) continue;
    if (f.reason === "shop") return { en: `Turn on "${f.label}" in Settings > Features first, then ask again.`, ta: `முதலில் அமைப்புகள் > வசதிகளில் "${f.label}" ஐ இயக்குங்கள், பிறகு மீண்டும் கேளுங்கள்.` };
    if (f.reason === "dependency") return { en: `"${f.label}" needs another feature that is off. Check Settings > Features.`, ta: `"${f.label}" க்கு வேறொரு வசதி தேவை, அது நிறுத்தத்தில் உள்ளது. அமைப்புகள் > வசதிகளைப் பாருங்கள்.` };
    return { en: `"${f.label}" is available on a higher plan (Pro). Ask the owner to upgrade.`, ta: `"${f.label}" உயர்ந்த திட்டத்தில் (Pro) கிடைக்கும். மேம்படுத்த உரிமையாளரிடம் கேளுங்கள்.` };
  }
  return null;
}

/** The "checked plan" the owner sees. Every decision here is code; the model only proposed the operations. */
export async function checkPlan(planned: PlannedOp[], unsupported: Unsupported[], deps: CheckDeps): Promise<CheckResult> {
  const out: CheckedOp[] = [];
  const parsed: { op: OpDef; params: unknown; index: number }[] = [];

  planned.forEach((raw, index) => {
    const op = opOf(raw.kind);
    const base = { kind: raw.kind, params: raw.params, alternative: raw.alternative, why: raw.why, warnings: [] as Bi[], areas: [] as AreaId[], visual: false };
    if (!op) {
      out.push({ ...base, status: "invalid", label: TEXT.unknown, description: TEXT.unknown, risk: "low", group: "theme", problem: { code: "unknown_operation", text: TEXT.unknown } });
      return;
    }
    const r = op.schema.safeParse(raw.params);
    const shell = { ...base, label: op.label, risk: op.risk, group: op.group, visual: !!op.visual };
    if (!r.success) {
      const issue = r.error.issues[0];
      const t = { en: `The details are not valid (${issue?.path.join(".") || "value"}: ${issue?.message ?? "invalid"}).`, ta: `விவரங்கள் சரியில்லை (${issue?.path.join(".") || "மதிப்பு"}: ${issue?.message ?? "தவறு"}).` };
      out.push({ ...shell, status: "invalid", description: op.label, problem: { code: "invalid_params", text: t } });
      return;
    }
    const params = r.data as Record<string, unknown>;
    const description = safeDescribe(op, params);
    out.push({ ...shell, params, description, status: "ok", areas: op.areas(params) });
    parsed.push({ op, params, index });
  });

  const block = (i: number, code: string, text: Bi) => {
    const o = out[i]!;
    o.status = "blocked";
    o.problem = { code, text };
  };

  // Permission, feature, grant scope.
  for (const { op, params, index } of parsed) {
    const perm = permissionProblem(op, deps.actor) ?? grantScope(op, params as Record<string, unknown>, deps.actor);
    if (perm) {
      block(index, "permission", perm);
      continue;
    }
    const feat = await featureProblem(op, deps);
    if (feat) block(index, "feature", feat);
  }

  // Simulate in order on a copy of the shop's configuration.
  const okOps = parsed.filter((p) => out[p.index]!.status === "ok");
  const areaIds = [...new Set(okOps.flatMap((p) => out[p.index]!.areas))];
  const initial = areaIds.length ? await deps.readAreas(areaIds) : {};
  const state = new StudioState(initial);
  const snapshots: CheckResult["snapshots"] = {};
  // Conflicts: two operations of one kind that set the same thing to different values (checked against steps that really ran).
  const ran = new Map<string, string>();
  for (const { op, params, index } of okOps) {
    if (op.target && !/^(home|menu|role|page)./.test(op.kind)) {
      const key = `${op.kind}|${op.target(params)}`;
      const mine = stable(params);
      const prior = ran.get(key);
      if (prior !== undefined) {
        block(index, prior === mine ? "duplicate" : "conflict", prior === mine ? { en: "The same step appears twice.", ta: "அதே படி இரண்டு முறை உள்ளது." } : { en: "Two steps in this request set the same thing to different values. Ask for one of them.", ta: "இந்தக் கோரிக்கையில் இரண்டு படிகள் ஒரே விஷயத்தை வெவ்வேறு மதிப்புகளுக்கு மாற்றுகின்றன. ஒன்றை மட்டும் கேளுங்கள்." });
        continue;
      }
    }
    const trial = state.clone();
    const before: Record<AreaId, unknown> = {};
    for (const a of out[index]!.areas) before[a] = structuredClone(trial.get(a));
    try {
      const warn = op.run(params, trial, deps.env);
      out[index]!.warnings = warn ?? [];
      // Commit the trial into the running state.
      for (const a of out[index]!.areas) state.set(a, trial.get(a));
      if (op.target && !/^(home|menu|role|page)./.test(op.kind)) ran.set(`${op.kind}|${op.target(params)}`, stable(params));
      snapshots[index] = Object.fromEntries(out[index]!.areas.map((a) => [a, { before: before[a], after: structuredClone(state.get(a)) }]));
    } catch (e) {
      const text = e instanceof OpError ? e.text : { en: "This step could not be prepared.", ta: "இந்தப் படியைத் தயார் செய்ய முடியவில்லை." };
      out[index]!.status = "invalid";
      out[index]!.problem = { code: e instanceof OpError ? e.code : "failed", text };
    }
  }

  const changed = state.changed();
  const base: Record<AreaId, unknown> = {};
  const baseHash: Record<AreaId, string> = {};
  for (const a of changed) {
    base[a] = state.before(a);
    baseHash[a] = hashOf(state.before(a));
  }
  const ok = out.filter((o) => o.status === "ok");
  const classification: Classification = ok.length === 0 ? "none" : unsupported.length > 0 || out.some((o) => o.status !== "ok") || ok.some((o) => o.alternative) ? "partial" : "full";
  return {
    ops: out,
    classification,
    preview: buildPreview(state, deps.env),
    base,
    baseHash,
    state,
    highRisk: ok.some((o) => o.risk === "high"),
    snapshots,
    blockedCount: out.filter((o) => o.status !== "ok").length,
  };
}

export const OP_COUNT = ALL_OPS.length;
