import { AppError, badRequest, forbidden } from "@srirealtime/core";
import { PACKS } from "@srirealtime/verticals";
import { themePreset } from "@srirealtime/branding/theme";
import { neutralise } from "../assist/safety";
import { maskText } from "../masking";
import type { ChangeView, StudioService } from "../studio/engine";
import type { StudioPorts } from "../studio/ports";
import type { BrandingArea, CategoriesArea, HomeArea, SettingsArea } from "../studio/areas";
import type { StudioActor } from "../studio/types";
import { planSetup } from "./plan";
import { buildProposal, type SetupProposal } from "./proposal";
import { readWithModel, type SetupRunner } from "./read";
import { ANSWER_KEYS, MAX_ANSWER, type Answers } from "./rules";

type Bi = { en: string; ta: string };

export const SETUP_STATUSES = ["new", "planned", "applied", "undone", "dismissed"] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];

/** Progress kept in the shop's `ai` settings (`onboarding`): no table of its own. The plan itself is a Studio change row. */
export interface SetupProgress {
  status: SetupStatus;
  changeId: string | null;
  /** The answers as last sent (masked, clipped), so the page can show them again. */
  answers: Answers | null;
  language: "en" | "ta";
  updatedAt: string;
}

export interface SetupDeps {
  ai: SetupRunner;
  studio: Pick<StudioService, "planFromOps" | "apply" | "undo" | "get" | "cancel">;
  ports: Pick<StudioPorts, "readAreas" | "feature">;
  progress: { get(tenantId: string): Promise<SetupProgress | null>; set(tenantId: string, p: SetupProgress): Promise<void> };
  /** The shop's name and app. */
  shop(tenantId: string): Promise<{ name: string; appId: string | null }>;
  now?: () => Date;
}

/** What the page shows next to the Studio-style plan: where each choice came from, in both languages. */
export interface SetupSummary {
  readBy: "ai" | "rules";
  skipped: string | null;
  trade: { id: string; name: Bi; source: SetupProposal["trade"]["source"]; confidence: string; otherApp: { id: string; name: Bi; appId: string } | null; outOfScope: boolean };
  /** `names` as they will be created; `namesTa` the Tamil names (the same when the owner wrote them in Tamil). */
  categories: { names: string[]; namesTa: string[]; source: "owner" | "pack" };
  look: { preset: string; name: string; colour: string | null };
  storeLanguages: "en" | "ta" | "both";
  fulfilment: { delivery: boolean | null; pickup: boolean | null };
  hero: SetupProposal["hero"];
  notes: Bi[];
  removed: string[];
  suspicious: boolean;
}

const EMPTY: Answers = { sell: "", buyers: "", groups: "", look: "", extras: "" };

/** Answers from a request: every key a string, clipped, control and bidi characters removed. */
export function cleanAnswers(raw: Partial<Record<string, unknown>>): Answers {
  const out = { ...EMPTY };
  for (const k of ANSWER_KEYS) {
    const v = raw[k];
    out[k] = typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f​-‏‪-‮]/g, " ").trim().slice(0, MAX_ANSWER) : "";
  }
  return out;
}

/**
 * The shop setup assistant (docs/ai.md, Phase 7 part A). Five answers -> a proposal (rules, refined by one light-tier
 * reading) -> Studio operations -> a Studio change row the owner previews, applies and can undo. It never writes on its
 * own: apply and undo are the Studio engine's, with its re-check, stale check and per-area undo.
 */
export class SetupAssistant {
  private readonly now: () => Date;
  constructor(private readonly d: SetupDeps) {
    this.now = d.now ?? (() => new Date());
  }

  private async save(tenantId: string, patch: Partial<SetupProgress>) {
    const cur = (await this.d.progress.get(tenantId)) ?? { status: "new" as const, changeId: null, answers: null, language: "en" as const, updatedAt: "" };
    const next: SetupProgress = { ...cur, ...patch, updatedAt: this.now().toISOString() };
    await this.d.progress.set(tenantId, next);
    return next;
  }

  async status(tenantId: string): Promise<{ progress: SetupProgress; change: ChangeView | null }> {
    const progress = (await this.d.progress.get(tenantId)) ?? { status: "new", changeId: null, answers: null, language: "en", updatedAt: "" };
    let change: ChangeView | null = null;
    if (progress.changeId) change = await this.d.studio.get(tenantId, progress.changeId).catch(() => null);
    return { progress, change };
  }

  private async shopState(tenantId: string) {
    const areas = await this.d.ports.readAreas(tenantId, ["branding", "home", "categories", "settings:store"]);
    const features = new Set<string>();
    for (const key of ["storefront", "cms", "catalogue"]) if ((await this.d.ports.feature(tenantId, key)).enabled) features.add(key);
    return {
      branding: areas.branding as BrandingArea,
      home: areas.home as HomeArea,
      categories: areas.categories as CategoriesArea,
      store: areas["settings:store"] as SettingsArea,
      features,
    };
  }

  /** Reads the answers and stores the checked plan. Changes nothing in the shop. */
  async propose(tenantId: string, actor: StudioActor, raw: Partial<Record<string, unknown>>): Promise<{ change: ChangeView; summary: SetupSummary }> {
    if (actor.demo) throw forbidden("The demo account cannot set up a shop");
    const answers = cleanAnswers(raw);
    const said = ANSWER_KEYS.filter((k) => answers[k].length > 0);
    if (!answers.sell && !answers.groups) throw badRequest("Tell me what you sell first", { field: "sell" });
    if (said.length === 0) throw badRequest("Answer at least one question");

    const [shop, state] = await Promise.all([this.d.shop(tenantId), this.shopState(tenantId)]);
    const ctx = { shopName: shop.name, appId: shop.appId, trade: String(state.store.effective.businessType ?? "") };
    const reading = await readWithModel(this.d.ai, { tenantId, userId: actor.userId, answers });
    const proposal = buildProposal(answers, ctx, reading);
    const facts = ANSWER_KEYS.map((k) => neutralise(answers[k]).text).join(". ");
    const { ops, notes: planNotes } = planSetup(proposal, ctx, state, facts);
    const notes = [...proposal.notes, ...planNotes];
    const lang = proposal.language;
    const pack = PACKS[proposal.trade.id];
    const look = themePreset(proposal.preset)?.name ?? proposal.preset;
    const summary: Bi = {
      en: `Set up as "${pack.name}": ${proposal.categories.names.length} product groups, the ${look} look${ops.some((o) => o.kind === "home.set_layout") ? " and a home page in your words" : ""}.`,
      ta: `"${pack.nameTa}" கடையாக அமைப்பு: ${proposal.categories.names.length} பொருள் வகைகள், ${look} தோற்றம்${ops.some((o) => o.kind === "home.set_layout") ? ", உங்கள் சொற்களில் முகப்புப் பக்கம்" : ""}.`,
    };

    // An earlier plan that was never applied is replaced by this one.
    const prev = await this.d.progress.get(tenantId);
    if (prev?.status === "planned" && prev.changeId) await this.d.studio.cancel(tenantId, prev.changeId, actor).catch(() => undefined);

    const change = await this.d.studio.planFromOps(tenantId, actor, {
      request: `Shop setup (five questions): ${answers.sell || answers.groups}`.slice(0, 300),
      language: lang,
      summary: ops.length ? summary[lang] : lang === "ta" ? "உங்கள் கடை ஏற்கெனவே இப்படித்தான் அமைக்கப்பட்டுள்ளது; மாற்ற எதுவும் இல்லை." : "Your shop is already set up this way; there is nothing to change.",
      notes: notes.map((n) => n[lang]).join(" "),
      ops,
      runId: reading.runId,
      credits: reading.credits,
    });
    const masked = Object.fromEntries(ANSWER_KEYS.map((k) => [k, maskText(answers[k], { phones: true, emails: true })])) as Answers;
    await this.save(tenantId, { status: change.status === "planned" ? "planned" : "new", changeId: change.id, answers: masked, language: lang });
    return {
      change,
      summary: {
        readBy: proposal.readBy,
        skipped: proposal.skipped,
        trade: {
          id: proposal.trade.id,
          name: { en: pack.name, ta: pack.nameTa },
          source: proposal.trade.source,
          confidence: proposal.trade.confidence,
          otherApp: proposal.trade.otherApp ? { id: proposal.trade.otherApp.id, name: { en: PACKS[proposal.trade.otherApp.id].name, ta: PACKS[proposal.trade.otherApp.id].nameTa }, appId: proposal.trade.otherApp.appId } : null,
          outOfScope: proposal.trade.outOfScope,
        },
        categories: { names: proposal.storeLanguages === "ta" ? proposal.categories.namesTa : proposal.categories.names, namesTa: proposal.categories.namesTa, source: proposal.categories.source },
        look: { preset: proposal.preset, name: look, colour: proposal.colour },
        storeLanguages: proposal.storeLanguages,
        fulfilment: proposal.fulfilment,
        hero: proposal.hero,
        notes,
        removed: proposal.removed,
        suspicious: proposal.suspicious,
      },
    };
  }

  private async own(tenantId: string, id: string) {
    const p = await this.d.progress.get(tenantId);
    if (!p || p.changeId !== id) throw new AppError(404, "not_found", "This setup plan was not found");
  }

  async apply(tenantId: string, actor: StudioActor, id: string, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<ChangeView> {
    await this.own(tenantId, id);
    const v = await this.d.studio.apply(tenantId, id, actor, meta);
    await this.save(tenantId, { status: "applied" });
    return v;
  }

  async undo(tenantId: string, actor: StudioActor, id: string, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<ChangeView> {
    await this.own(tenantId, id);
    const v = await this.d.studio.undo(tenantId, id, actor, meta);
    await this.save(tenantId, { status: "undone" });
    return v;
  }

  async dismiss(tenantId: string): Promise<SetupProgress> {
    return this.save(tenantId, { status: "dismissed" });
  }
}
