/** Pure onboarding logic: step registry, feature filtering, timed checks and status assembly (no database). */

export interface OnboardingStep {
  /** Unique key, e.g. "business-profile". */
  key: string;
  /** Module that registered it, e.g. "settings". */
  module: string;
  /** Hidden when this feature is off for the shop. */
  feature?: string;
  label: string;
  description: string;
  /** UI route hint, relative to the app, e.g. "settings/business". */
  href: string;
  /** Lower comes first. */
  order: number;
  /** True when the shop has done this step. Errors and timeouts count as not done. */
  check(tenantId: string): Promise<boolean>;
}

export interface StepView {
  key: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
  skipped: boolean;
}

export interface OnboardingStatus {
  steps: StepView[];
  /** Steps that are done or skipped. */
  completed: number;
  total: number;
  dismissed: boolean;
}

export interface StateLike {
  skipped: readonly string[];
  dismissedAt: Date | null;
}

const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Ordered list of steps; keys are unique. */
export class StepRegistry {
  private readonly steps = new Map<string, OnboardingStep>();

  register(step: OnboardingStep): void {
    if (!KEY_RE.test(step.key)) throw new Error(`Invalid onboarding step key: ${step.key}`);
    if (this.steps.has(step.key)) throw new Error(`Onboarding step already registered: ${step.key}`);
    this.steps.set(step.key, step);
  }

  has(key: string): boolean {
    return this.steps.has(key);
  }

  get(key: string): OnboardingStep | undefined {
    return this.steps.get(key);
  }

  /** Every step, by `order` then key. */
  list(): OnboardingStep[] {
    return sortSteps([...this.steps.values()]);
  }
}

export const sortSteps = <T extends { order: number; key: string }>(steps: readonly T[]): T[] =>
  [...steps].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

/** Steps without a feature, or whose feature is on. A failing feature check hides the step. */
export async function visibleSteps(
  steps: readonly OnboardingStep[],
  isEnabled: ((key: string) => Promise<boolean>) | null,
): Promise<OnboardingStep[]> {
  if (!isEnabled) return [...steps];
  const features = [...new Set(steps.map((s) => s.feature).filter((f): f is string => !!f))];
  const on = new Map<string, boolean>();
  await Promise.all(
    features.map(async (f) => {
      on.set(f, await isEnabled(f).catch(() => false));
    }),
  );
  return steps.filter((s) => !s.feature || on.get(s.feature) === true);
}

/** Resolves to `false` when the promise rejects or takes longer than `ms`. */
export function withTimeout(p: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v === true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/** Runs every check in parallel; each gets `timeoutMs`. Returns key → done. */
export async function runChecks(
  steps: readonly OnboardingStep[],
  tenantId: string,
  timeoutMs: number,
  onError?: (key: string, err: unknown) => void,
): Promise<Map<string, boolean>> {
  const results = await Promise.all(
    steps.map(async (s) => {
      let p: Promise<boolean>;
      try {
        p = Promise.resolve(s.check(tenantId));
      } catch (err) {
        p = Promise.reject(err);
      }
      if (onError) p = p.catch((err) => (onError(s.key, err), false));
      return [s.key, await withTimeout(p, timeoutMs)] as const;
    }),
  );
  return new Map(results);
}

/** Builds the `GET /` response from visible steps, check results and the stored state. */
export function assembleStatus(
  steps: readonly OnboardingStep[],
  done: ReadonlyMap<string, boolean>,
  state: StateLike | null,
): OnboardingStatus {
  const skipped = new Set(state?.skipped ?? []);
  const views = sortSteps(steps).map((s) => {
    const isDone = done.get(s.key) === true;
    return {
      key: s.key,
      label: s.label,
      description: s.description,
      href: s.href,
      done: isDone,
      // A step that got done is no longer "skipped".
      skipped: !isDone && skipped.has(s.key),
    };
  });
  return {
    steps: views,
    completed: views.filter((v) => v.done || v.skipped).length,
    total: views.length,
    dismissed: !!state?.dismissedAt,
  };
}

/** `skipped` with `key` added (once). */
export const addSkip = (skipped: readonly string[], key: string): string[] =>
  skipped.includes(key) ? [...skipped] : [...skipped, key];

/** `skipped` without `key`. */
export const removeSkip = (skipped: readonly string[], key: string): string[] => skipped.filter((k) => k !== key);
