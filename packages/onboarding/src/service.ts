import { notFound, type FeatureGatePort } from "@rbms/core";
import type { Db } from "@rbms/db";
import { eq } from "drizzle-orm";
import {
  addSkip,
  assembleStatus,
  removeSkip,
  runChecks,
  StepRegistry,
  visibleSteps,
  type OnboardingStatus,
  type OnboardingStep,
} from "./logic";
import { onboardingState, type OnboardingStateRow } from "./schema";

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export interface OnboardingDeps {
  db: Db;
  /** Hides steps whose `feature` is off for the shop. Without it every step shows. */
  featureGate?: FeatureGatePort;
  /** Per-check timeout, default 3000 ms (a slow check counts as not done). */
  checkTimeoutMs?: number;
  /** How long check results are cached per tenant, default 30 000 ms. */
  cacheTtlMs?: number;
  log?: LoggerPort;
  now?: () => Date;
}

interface CacheEntry {
  steps: OnboardingStep[];
  done: Map<string, boolean>;
  expires: number;
}

const MAX_CACHE_ENTRIES = 10_000;

export class OnboardingService {
  readonly registry = new StepRegistry();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly timeoutMs: number;
  private readonly ttl: number;
  private readonly now: () => Date;

  constructor(private readonly deps: OnboardingDeps) {
    this.timeoutMs = deps.checkTimeoutMs ?? 3000;
    this.ttl = deps.cacheTtlMs ?? 30_000;
    this.now = deps.now ?? (() => new Date());
  }

  /** Adds a step (kit calls this for each module). Throws on a duplicate key. */
  registerStep(step: OnboardingStep): void {
    this.registry.register(step);
    this.invalidate();
  }

  /** Drops cached check results for one tenant, or all. Call after something that completes a step, if you like. */
  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  private async checked(tenantId: string): Promise<CacheEntry> {
    const now = this.now().getTime();
    const hit = this.cache.get(tenantId);
    if (hit && hit.expires > now) return hit;
    const gate = this.deps.featureGate;
    const steps = await visibleSteps(this.registry.list(), gate ? (key) => gate.isEnabled(tenantId, key) : null);
    const done = await runChecks(steps, tenantId, this.timeoutMs, (key, err) =>
      this.deps.log?.warn({ err, tenantId, step: key }, "onboarding check failed"),
    );
    const entry = { steps, done, expires: now + this.ttl };
    if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
    this.cache.set(tenantId, entry);
    return entry;
  }

  private async state(tenantId: string): Promise<OnboardingStateRow | null> {
    const [row] = await this.deps.db
      .select()
      .from(onboardingState)
      .where(eq(onboardingState.tenantId, tenantId))
      .limit(1);
    return row ?? null;
  }

  private async save(tenantId: string, patch: Partial<Pick<OnboardingStateRow, "skipped" | "dismissedAt" | "completedAt">>) {
    await this.deps.db
      .insert(onboardingState)
      .values({ tenantId, skipped: [], ...patch })
      .onConflictDoUpdate({ target: onboardingState.tenantId, set: { ...patch, updatedAt: this.now() } });
  }

  /** The checklist for a shop (only steps whose feature is on). */
  async status(tenantId: string): Promise<OnboardingStatus> {
    const [{ steps, done }, state] = await Promise.all([this.checked(tenantId), this.state(tenantId)]);
    const status = assembleStatus(steps, done, state);
    if (status.total > 0 && status.completed === status.total && !state?.completedAt) {
      await this.save(tenantId, { completedAt: this.now() });
    }
    return status;
  }

  private assertStep(key: string) {
    if (!this.registry.has(key)) throw notFound("Onboarding step");
  }

  async skip(tenantId: string, key: string): Promise<OnboardingStatus> {
    this.assertStep(key);
    const state = await this.state(tenantId);
    await this.save(tenantId, { skipped: addSkip(state?.skipped ?? [], key) });
    return this.status(tenantId);
  }

  async unskip(tenantId: string, key: string): Promise<OnboardingStatus> {
    this.assertStep(key);
    const state = await this.state(tenantId);
    await this.save(tenantId, { skipped: removeSkip(state?.skipped ?? [], key) });
    return this.status(tenantId);
  }

  /** Hides the checklist for the shop. */
  async dismiss(tenantId: string): Promise<OnboardingStatus> {
    await this.save(tenantId, { dismissedAt: this.now() });
    return this.status(tenantId);
  }
}
