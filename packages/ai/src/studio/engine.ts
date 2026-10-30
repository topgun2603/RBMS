import { AppError, badRequest, forbidden, notFound } from "@rbms/core";
import { maskText } from "../masking";
import { buildPreview } from "./diff";
import { checkPlan, hashOf, permissionProblem, type CheckResult } from "./check";
import { proposePlan, STUDIO_MAX_REQUEST, type PlanRunner } from "./plan";
import type { StudioPorts } from "./ports";
import type { StudioChangeRow, StudioStatus } from "./schema";
import type { StudioStore } from "./store";
import { opOf } from "./ops";
import { StudioState, type AreaId, type Bi, type ChangeLine, type CheckedOp, type Classification, type PlannedOp, type StudioActor, type StudioPreview, type Unsupported } from "./types";

export interface StudioDeps {
  store: StudioStore;
  ai: PlanRunner;
  ports: StudioPorts;
  /** Names for the platform feature-request page. */
  shops?: (ids: string[]) => Promise<Map<string, { slug: string; name: string }>>;
  now?: () => Date;
}

/** What a client sees of one request. */
export interface ChangeView {
  id: string;
  status: StudioStatus;
  createdAt: string;
  request: string;
  language: "en" | "ta";
  summary: string;
  notes: string;
  classification: Classification;
  ops: CheckedOp[];
  unsupported: Unsupported[];
  refused: { text: string; reason: string }[];
  preview: StudioPreview;
  highRisk: boolean;
  /** The plan can still be applied (planned, and at least one operation passed the checks). */
  canApply: boolean;
  canUndo: boolean;
  featureRequestSaved: boolean;
  credits: number;
  runId: string | null;
  appliedAt: string | null;
  undoneAt: string | null;
  error: string | null;
}

interface StoredOps {
  ops: (CheckedOp & { snapshot?: Record<AreaId, { before: unknown; after: unknown }> })[];
  refused: { text: string; reason: string }[];
  notes: string;
  featureRequestSaved: boolean;
}
interface AppliedArea {
  before: unknown;
  after: unknown;
  afterHash: string;
}

/** Order areas are written in (roles before the discount limits that name them). */
const WRITE_ORDER = ["roles", "discounts", "branding", "feature:", "settings:", "signin", "menu:", "page:", "home"];
const rank = (a: AreaId) => {
  const i = WRITE_ORDER.findIndex((p) => a === p || (p.endsWith(":") && a.startsWith(p)));
  return i < 0 ? 99 : i;
};

const STUDIO_ERR = {
  stale: (en: string, ta: string) => new AppError(409, "studio_stale", en, { ta }),
};

const TXT = {
  noOps: { en: "Nothing in this request can be done yet.", ta: "இந்தக் கோரிக்கையில் எதையும் இப்போது செய்ய முடியாது." } as Bi,
};

export class StudioService {
  private readonly now: () => Date;
  constructor(private readonly d: StudioDeps) {
    this.now = d.now ?? (() => new Date());
  }

  private view(r: StudioChangeRow): ChangeView {
    const stored = (r.ops as unknown as StoredOps | unknown[]) ?? [];
    const meta: StoredOps = Array.isArray(stored) ? { ops: stored as StoredOps["ops"], refused: [], notes: "", featureRequestSaved: false } : stored;
    const preview = (r.preview ?? { lines: [] }) as unknown as StudioPreview;
    const ops = meta.ops.map(({ snapshot: _s, ...o }) => o) as CheckedOp[];
    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      request: r.requestText,
      language: r.language === "ta" ? "ta" : "en",
      summary: r.summary,
      notes: meta.notes ?? "",
      classification: r.classification,
      ops,
      unsupported: (r.unsupported ?? []) as Unsupported[],
      refused: meta.refused ?? [],
      preview: { lines: preview.lines ?? [], ...(preview.tokens ? { tokens: preview.tokens } : {}), ...(preview.sections ? { sections: preview.sections } : {}) },
      highRisk: r.highRisk,
      canApply: r.status === "planned" && ops.some((o) => o.status === "ok"),
      canUndo: r.status === "applied",
      featureRequestSaved: !!meta.featureRequestSaved,
      credits: r.credits,
      runId: r.runId,
      appliedAt: r.appliedAt?.toISOString() ?? null,
      undoneAt: r.undoneAt?.toISOString() ?? null,
      error: r.error,
    };
  }

  private async row(tenantId: string, id: string): Promise<StudioChangeRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Studio request");
    const r = await this.d.store.getChange(tenantId, id);
    if (!r) throw notFound("Studio request");
    return r;
  }

  private checkDeps(tenantId: string, actor: StudioActor, env: Awaited<ReturnType<StudioPorts["env"]>>) {
    return {
      env,
      actor,
      feature: (key: string) => this.d.ports.feature(tenantId, key),
      readAreas: (areas: AreaId[]) => this.d.ports.readAreas(tenantId, areas),
    };
  }

  // ------------------------------------------------------------------ plan

  /** Plan and check a request. Changes nothing; the row it stores is the plan the owner confirms (or cancels). */
  async plan(tenantId: string, actor: StudioActor, request: string, opts: { trade?: string } = {}): Promise<ChangeView> {
    if (actor.demo) throw forbidden("The demo account cannot use Studio");
    const text = request.trim();
    if (text.length < 3) throw badRequest("Type what you want to change");
    if (text.length > STUDIO_MAX_REQUEST) throw badRequest(`Keep the request under ${STUDIO_MAX_REQUEST} characters`);
    const env = await this.d.ports.env(tenantId);
    const model = await proposePlan(this.d.ai, { tenantId, userId: actor.userId, request: text, ports: this.d.ports, env });
    const result = await checkPlan(model.ops, model.unsupported, this.checkDeps(tenantId, actor, env));
    const classification: Classification = model.ops.length === 0 && model.unsupported.length === 0 && model.refused.length === 0 ? "none" : result.classification;
    // Requests the platform cannot do are recorded (refusals and attempts to give instructions to the AI are not).
    let saved = false;
    if (model.unsupported.length && !model.suspicious) {
      await this.d.store.insertFeatureRequests(
        model.unsupported.map((u) => ({
          tenantId,
          trade: (opts.trade ?? env.trade ?? "").slice(0, 40),
          requestText: maskText(text, { phones: true, emails: true }).slice(0, STUDIO_MAX_REQUEST),
          language: model.language,
          missing: u.missing.slice(0, 400),
          theme: u.theme,
        })),
      );
      saved = true;
    }
    const storedOps: StoredOps = { ops: result.ops.map((o, i) => ({ ...o, snapshot: result.snapshots[i] })), refused: model.refused, notes: model.notes, featureRequestSaved: saved };
    const status: StudioStatus = result.ops.some((o) => o.status === "ok") ? "planned" : "rejected";
    const row = await this.d.store.insertChange({
        tenantId,
        userId: actor.userId,
        requestText: maskText(text, { phones: true, emails: true }).slice(0, STUDIO_MAX_REQUEST),
        language: model.language,
        summary: model.summary || (status === "rejected" ? TXT.noOps[model.language] : ""),
        classification,
        status,
        ops: storedOps as unknown as unknown[],
        unsupported: model.unsupported,
        preview: result.preview as unknown as Record<string, unknown>,
        base: result.baseHash,
        highRisk: result.highRisk,
        runId: model.runId,
        credits: model.credits,
    });
    return this.view(row);
  }

  /**
   * Checks and stores a plan that was built in code instead of by the Studio planner (the shop setup assistant, Phase 7
   * part A). The same checks, preview, apply, stale check and undo apply; `runId` / `credits` are the AI run that read
   * the answers, if any. Changes nothing.
   */
  async planFromOps(
    tenantId: string,
    actor: StudioActor,
    p: { request: string; language: "en" | "ta"; summary: string; notes: string; ops: PlannedOp[]; runId: string | null; credits: number },
  ): Promise<ChangeView> {
    if (actor.demo) throw forbidden("The demo account cannot use Studio");
    const env = await this.d.ports.env(tenantId);
    const result = await checkPlan(p.ops, [], this.checkDeps(tenantId, actor, env));
    const status: StudioStatus = result.ops.some((o) => o.status === "ok") ? "planned" : "rejected";
    const storedOps: StoredOps = { ops: result.ops.map((o, i) => ({ ...o, snapshot: result.snapshots[i] })), refused: [], notes: p.notes, featureRequestSaved: false };
    const row = await this.d.store.insertChange({
      tenantId,
      userId: actor.userId,
      requestText: maskText(p.request, { phones: true, emails: true }).slice(0, STUDIO_MAX_REQUEST),
      language: p.language,
      summary: p.summary || (status === "rejected" ? TXT.noOps[p.language] : ""),
      classification: result.classification,
      status,
      ops: storedOps as unknown as unknown[],
      unsupported: [],
      preview: result.preview as unknown as Record<string, unknown>,
      base: result.baseHash,
      highRisk: result.highRisk,
      runId: p.runId,
      credits: p.credits,
    });
    return this.view(row);
  }

  // ------------------------------------------------------------------ read

  async get(tenantId: string, id: string): Promise<ChangeView> {
    return this.view(await this.row(tenantId, id));
  }

  /** History, newest first. Plans that were never applied are included so the owner can reopen or cancel them. */
  async list(tenantId: string, limit = 30): Promise<{ items: ChangeView[] }> {
    const rows = await this.d.store.listChanges(tenantId, Math.min(Math.max(limit, 1), 100));
    return { items: rows.map((r) => this.view(r)) };
  }

  async cancel(tenantId: string, id: string, actor: StudioActor): Promise<ChangeView> {
    const r = await this.row(tenantId, id);
    if (r.status !== "planned") throw new AppError(409, "studio_not_planned", "This request is not waiting to be applied.");
    const u = await this.d.store.updateChange(r.id, { status: "cancelled" });
    void actor;
    return this.view(u);
  }

  // ------------------------------------------------------------------ apply

  private plannedOpsOf(r: StudioChangeRow): PlannedOp[] {
    const meta = r.ops as unknown as StoredOps;
    return meta.ops.filter((o) => o.status === "ok").map((o) => ({ kind: o.kind, params: o.params, alternative: o.alternative, why: o.why }));
  }

  /** Applies the plan the owner confirmed: re-checks it with the current permissions, refuses if the shop moved on, then writes through the services. */
  async apply(tenantId: string, id: string, actor: StudioActor, body: { confirmHighRisk?: boolean; ip?: string | null; userAgent?: string | null } = {}): Promise<ChangeView> {
    if (actor.demo) throw forbidden("The demo account cannot use Studio");
    const r = await this.row(tenantId, id);
    if (r.status !== "planned") throw new AppError(409, "studio_not_planned", "This request was already applied, cancelled or had nothing to apply.");
    if (r.highRisk && body.confirmHighRisk !== true) throw new AppError(400, "studio_confirm_required", "This change touches money, permissions or sign-in. Confirm it a second time to apply.");
    const env = await this.d.ports.env(tenantId);
    const planned = this.plannedOpsOf(r);
    const result: CheckResult = await checkPlan(planned, [], this.checkDeps(tenantId, actor, env));
    const bad = result.ops.find((o) => o.status !== "ok");
    if (bad) throw new AppError(409, "studio_recheck_failed", bad.problem?.text.en ?? "A step can no longer be applied.", { problem: bad.problem?.text, kind: bad.kind });
    for (const [area, hash] of Object.entries(r.base)) {
      if (result.baseHash[area] !== hash) throw STUDIO_ERR.stale("Your shop changed since this preview was made, so nothing was applied. Please ask again.", "இந்த முன்னோட்டத்துக்குப் பிறகு உங்கள் கடையில் மாற்றம் நடந்துள்ளது, அதனால் எதுவும் பயன்படுத்தப்படவில்லை. மீண்டும் கேளுங்கள்.");
    }
    const changed = result.state.changed().sort((a, b) => rank(a) - rank(b));
    if (changed.length === 0) throw new AppError(409, "studio_no_change", "The shop already looks and works this way, so there is nothing to change.");
    const ctx = { tenantId, actor, ip: body.ip ?? null, userAgent: body.userAgent ?? null };
    const done: Record<AreaId, AppliedArea> = {};
    const written: AreaId[] = [];
    try {
      for (const area of changed) {
        const before = result.state.before(area);
        await this.d.ports.writeArea(ctx, area, before, result.state.after(area));
        written.push(area);
        const back = (await this.d.ports.readAreas(tenantId, [area]))[area];
        done[area] = { before, after: back, afterHash: hashOf(back) };
      }
    } catch (e) {
      // Put back what was already written, then report.
      for (const area of [...written].reverse()) await this.d.ports.writeArea(ctx, area, done[area]?.after ?? result.state.after(area), done[area]?.before ?? result.state.before(area)).catch(() => undefined);
      await this.d.store.updateChange(r.id, { status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "failed" });
      throw e;
    }
    const meta = r.ops as unknown as StoredOps;
    const okIdx = new Map<string, number>();
    result.ops.forEach((o, i) => okIdx.set(`${o.kind}|${JSON.stringify(o.params)}`, i));
    const ops = meta.ops.map((o) => {
      const i = okIdx.get(`${o.kind}|${JSON.stringify(o.params)}`);
      return o.status === "ok" && i !== undefined ? { ...o, warnings: result.ops[i]!.warnings, snapshot: result.snapshots[i] } : o;
    });
    const now = this.now();
    const u = await this.d.store.updateChange(r.id, { status: "applied", appliedAt: now, appliedBy: actor.userId, areas: done as unknown as Record<string, unknown>, ops: { ...meta, ops } as unknown as unknown[], preview: result.preview as unknown as Record<string, unknown>, error: null });
    await this.d.ports.audit({ tenantId, userId: actor.userId, action: "studio.apply", entityId: r.id, summary: `Studio applied: ${result.ops.map((o) => o.kind).join(", ")}`, before: Object.fromEntries(changed.map((a) => [a, summaryOf(done[a]!.before)])), after: Object.fromEntries(changed.map((a) => [a, summaryOf(done[a]!.after)])), ip: body.ip });
    return this.view(u);
  }

  // ------------------------------------------------------------------ undo

  /** Restores what the change replaced. Refuses (409 with the differences) if anything it changed was changed again since. */
  async undo(tenantId: string, id: string, actor: StudioActor, body: { ip?: string | null; userAgent?: string | null } = {}): Promise<ChangeView> {
    if (actor.demo) throw forbidden("The demo account cannot use Studio");
    const r = await this.row(tenantId, id);
    if (r.status !== "applied") throw new AppError(409, "studio_not_applied", "Only an applied change can be undone.");
    const meta = r.ops as unknown as StoredOps;
    for (const o of meta.ops) {
      if (o.status !== "ok") continue;
      const op = opOf(o.kind);
      const p = op && permissionProblem(op, actor);
      if (p) throw new AppError(403, "permission_denied", p.en, { ta: p.ta });
    }
    const areas = Object.entries(r.areas as unknown as Record<AreaId, AppliedArea>).sort((a, b) => rank(b[0]) - rank(a[0]));
    const env = await this.d.ports.env(tenantId);
    const current = await this.d.ports.readAreas(tenantId, areas.map(([a]) => a));
    const conflicts: { area: AreaId; lines: ChangeLine[] }[] = [];
    for (const [area, rec] of areas) {
      if (hashOf(current[area]) === rec.afterHash) continue;
      const st = new StudioState({ [area]: rec.after });
      st.set(area, current[area]);
      conflicts.push({ area, lines: buildPreview(st, env).lines });
    }
    // A role this change created that people now hold would be stripped from them by deleting it.
    const rolesRec = (r.areas as unknown as Record<string, AppliedArea>).roles;
    if (rolesRec && !conflicts.some((c) => c.area === "roles")) {
      const before = new Set(((rolesRec.before as { roles: { key: string }[] }).roles ?? []).map((x) => x.key));
      for (const role of (rolesRec.after as { roles: { key: string }[] }).roles ?? []) {
        if (!before.has(role.key) && (await this.d.ports.roleMembers(tenantId, role.key)) > 0) {
          conflicts.push({ area: "roles", lines: [{ area: "roles", label: { en: `Role “${role.key}”`, ta: `பணி “${role.key}”` }, before: { en: "given to team members", ta: "குழு உறுப்பினர்களுக்கு வழங்கப்பட்டது" }, after: { en: "would be removed from them", ta: "அவர்களிடமிருந்து நீக்கப்படும்" } }] });
        }
      }
    }
    if (conflicts.length) {
      throw new AppError(409, "studio_changed_since", "Some of these settings were changed again after Studio applied them, so nothing was undone. Here is what changed since.", { conflicts });
    }
    const ctx = { tenantId, actor, ip: body.ip ?? null, userAgent: body.userAgent ?? null };
    const restored: AreaId[] = [];
    try {
      for (const [area, rec] of areas) {
        await this.d.ports.writeArea(ctx, area, current[area], rec.before);
        restored.push(area);
      }
    } catch (e) {
      for (const area of restored.reverse()) await this.d.ports.writeArea(ctx, area, (r.areas as unknown as Record<AreaId, AppliedArea>)[area]!.before, current[area]).catch(() => undefined);
      throw e;
    }
    const u = await this.d.store.updateChange(r.id, { status: "undone", undoneAt: this.now(), undoneBy: actor.userId });
    await this.d.ports.audit({ tenantId, userId: actor.userId, action: "studio.undo", entityId: r.id, summary: `Studio change undone: ${meta.ops.filter((o) => o.status === "ok").map((o) => o.kind).join(", ")}`, ip: body.ip });
    return this.view(u);
  }

  // ------------------------------------------------------------------ feature requests (platform)

  /** Super-admin: counts by theme and the newest requests. */
  async featureRequests(opts: { days?: number; limit?: number } = {}) {
    const since = opts.days ? new Date(this.now().getTime() - opts.days * 86_400_000) : new Date(0);
    const { byTheme, rows } = await this.d.store.featureRequests(since, Math.min(opts.limit ?? 100, 500));
    const names = (await this.d.shops?.([...new Set(rows.map((x) => x.tenantId))])) ?? new Map();
    return {
      total: byTheme.reduce((n, t) => n + t.count, 0),
      byTheme,
      items: rows.map((x) => ({ id: x.id, tenantId: x.tenantId, shop: names.get(x.tenantId)?.name ?? null, slug: names.get(x.tenantId)?.slug ?? null, trade: x.trade, request: x.requestText, language: x.language, missing: x.missing, theme: x.theme, createdAt: x.createdAt.toISOString() })),
    };
  }
}

/** A short, secret-free summary of an area for the audit log. */
function summaryOf(v: unknown): unknown {
  const s = JSON.stringify(v ?? null);
  return s.length > 1500 ? `${s.slice(0, 1500)}…` : v;
}
