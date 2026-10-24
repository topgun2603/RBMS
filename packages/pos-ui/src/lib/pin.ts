/**
 * Staff PIN rules and the lock screen's PIN pad (docs/pos-terminals.md → PIN rules). Pure and unit tested; the
 * server is the last word (`pin_weak`, `pin_taken`, `pin_invalid`, `pin_locked`, `pin_not_allowed`).
 */

export const PIN_MIN = 4;
export const PIN_MAX = 6;

export const isPinFormat = (pin: string) => /^\d{4,6}$/.test(pin);

/** All the same digit (0000, 777777) or a run up or down (1234, 123456, 6543, 0123). */
export function isWeakPin(pin: string): boolean {
  if (!isPinFormat(pin)) return false;
  if (/^(\d)\1+$/.test(pin)) return true;
  const d = [...pin].map(Number);
  const step = d[1]! - d[0]!;
  if (step !== 1 && step !== -1) return false;
  return d.every((x, i) => i === 0 || x - d[i - 1]! === step);
}

/** Client-side check before PUT /pos/pins/…: null = fine to send. */
export function pinProblem(pin: string, confirm?: string): "format" | "weak" | "mismatch" | null {
  if (!isPinFormat(pin)) return "format";
  if (isWeakPin(pin)) return "weak";
  if (confirm !== undefined && confirm !== pin) return "mismatch";
  return null;
}

// ---------------------------------------------------------------- PIN pad

export interface PinPadState {
  digits: string;
}

export type PinPadAction = { type: "digit"; digit: string } | { type: "back" } | { type: "clear" };

export function pinPadReducer(s: PinPadState, a: PinPadAction): PinPadState {
  switch (a.type) {
    case "digit":
      return /^\d$/.test(a.digit) && s.digits.length < PIN_MAX ? { digits: s.digits + a.digit } : s;
    case "back":
      return { digits: s.digits.slice(0, -1) };
    case "clear":
      return { digits: "" };
  }
}

/** Keyboard → pad action (digits, numpad digits, Backspace, Escape / Delete). Enter is the caller's submit. */
export function keyToPinAction(key: string): PinPadAction | null {
  if (/^\d$/.test(key)) return { type: "digit", digit: key };
  if (key === "Backspace") return { type: "back" };
  if (key === "Escape" || key === "Delete") return { type: "clear" };
  return null;
}

// ---------------------------------------------------------------- unlock errors and lockout

export type UnlockProblem =
  | { kind: "invalid"; remaining: number | null }
  | { kind: "locked"; until: number }
  | { kind: "notAllowed" }
  | { kind: "unpaired" }
  | { kind: "network" }
  | { kind: "other"; message: string };

interface ErrLike {
  status?: number;
  code?: string;
  message?: string;
  details?: unknown;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** POST /pos/session failure → what the lock screen shows. `now` = ms. */
export function unlockProblemOf(err: unknown, now = Date.now()): UnlockProblem {
  const e: ErrLike = err && typeof err === "object" ? (err as ErrLike) : {};
  const details = (e.details && typeof e.details === "object" ? e.details : {}) as Record<string, unknown>;
  if (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504) return { kind: "network" };
  switch (e.code) {
    case "pin_invalid":
      return { kind: "invalid", remaining: num(details.remaining) };
    case "pin_locked":
      return { kind: "locked", until: now + (num(details.retryAfterSeconds) ?? 300) * 1000 };
    case "pin_not_allowed":
      return { kind: "notAllowed" };
    case "device_not_paired":
      return { kind: "unpaired" };
  }
  if (e.status === 429) return { kind: "locked", until: now + (num(details.retryAfterSeconds) ?? 300) * 1000 };
  return { kind: "other", message: e.message ?? "" };
}

/** Whole seconds left on a lockout (0 when over). */
export const lockSecondsLeft = (until: number, now = Date.now()) => Math.max(Math.ceil((until - now) / 1000), 0);

/** 299 → "4:59". */
export const formatCountdown = (seconds: number) => {
  const s = Math.max(Math.floor(seconds), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The pad is usable: not while a lockout runs or a request is in flight. */
export const padDisabled = (problem: UnlockProblem | null, busy: boolean, now = Date.now()) =>
  busy || (problem?.kind === "locked" && lockSecondsLeft(problem.until, now) > 0);

/** Idle auto-lock: true once `lockAfterMinutes` passed since the last activity. */
export const idleExpired = (lastActivity: number, lockAfterMinutes: number, now = Date.now()) =>
  now - lastActivity >= Math.min(Math.max(lockAfterMinutes, 1), 60) * 60_000;
