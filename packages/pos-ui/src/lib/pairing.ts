import type { DeviceInfo, PinSession, PosShop, Terminal } from "./terminal-types";

/**
 * Pure pieces of terminal mode (docs/pos-terminals.md): pairing codes and QR payloads, the pairing form's state
 * machine and the terminal's phases (unpaired → locked → unlocked). No React, no fetch: unit tested.
 */

/** Characters a pairing code is made of (no 0/1/I/L/O). */
export const PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

/** Upper-cases and drops spaces / dashes. Returns the 8 code characters, or null when it can't be a code. */
export function normalizePairingCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]+/g, "");
  if (raw.length !== CODE_LENGTH) return null;
  for (const ch of raw) if (!PAIRING_ALPHABET.includes(ch)) return null;
  return raw;
}

/** As the person types: upper case, only code characters, a dash after 4 ("abcd23" → "ABCD-23"). */
export function formatPairingInput(input: string): string {
  const raw = [...input.toUpperCase()].filter((ch) => PAIRING_ALPHABET.includes(ch)).join("").slice(0, CODE_LENGTH);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

export interface PairingQr {
  /** API origin the code belongs to ("https://api.rbms.in"). */
  origin: string;
  code: string;
}

/** "srikit-pair:1:<apiOrigin>:<code>" → { origin, code }; a bare code is accepted too (origin ""). Null otherwise. */
export function parsePairingQr(text: string): PairingQr | null {
  const t = text.trim();
  const prefix = "srikit-pair:1:";
  if (t.toLowerCase().startsWith(prefix)) {
    const rest = t.slice(prefix.length);
    const at = rest.lastIndexOf(":");
    if (at <= 0) return null;
    const code = normalizePairingCode(rest.slice(at + 1));
    return code ? { origin: rest.slice(0, at), code } : null;
  }
  const code = normalizePairingCode(t);
  return code ? { origin: "", code } : null;
}

/** "ABCD2345" → "ABCD-2345" (what the API and the admin screen show). */
export const displayPairingCode = (code: string) => {
  const raw = code.replace(/-/g, "").toUpperCase();
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
};

// ---------------------------------------------------------------- errors

export type PairError = "format" | "invalid" | "tooMany" | "network" | "wrongShop" | "featureOff" | "other";

interface ErrLike {
  status?: number;
  code?: string;
}

const errOf = (err: unknown): ErrLike => (err && typeof err === "object" ? (err as ErrLike) : {});
const isNetwork = (e: ErrLike) => e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504;

/** What went wrong with `POST /pos/pair`. */
export function pairErrorOf(err: unknown): PairError {
  const e = errOf(err);
  if (isNetwork(e)) return "network";
  if (e.code === "pairing_code_invalid") return "invalid";
  if (e.code === "too_many_attempts" || e.status === 429) return "tooMany";
  if (e.code === "device_shop_mismatch") return "wrongShop";
  if (e.code === "feature_disabled" || e.code === "plan_limit") return "featureOff";
  return "other";
}

// ---------------------------------------------------------------- pairing form

export type PairingState =
  | { step: "enter"; code: string; error: PairError | null }
  | { step: "pairing"; code: string }
  | { step: "paired"; terminal: Terminal; shop: PosShop };

export type PairingEvent =
  | { type: "input"; value: string }
  | { type: "submit" }
  | { type: "scanned"; text: string }
  | { type: "failed"; error: PairError }
  | { type: "paired"; terminal: Terminal; shop: PosShop };

export const initialPairing: PairingState = { step: "enter", code: "", error: null };

/**
 * enter --submit (valid)--> pairing --paired--> paired; --failed--> enter (with the error, the code kept so it can be
 * corrected). A scanned QR fills the code and submits at once. Submitting a malformed code stays in enter ("format").
 */
export function pairingReducer(state: PairingState, ev: PairingEvent): PairingState {
  switch (ev.type) {
    case "input":
      return state.step === "enter" ? { step: "enter", code: formatPairingInput(ev.value), error: null } : state;
    case "submit": {
      if (state.step !== "enter") return state;
      const code = normalizePairingCode(state.code);
      return code ? { step: "pairing", code } : { ...state, error: "format" };
    }
    case "scanned": {
      if (state.step === "pairing" || state.step === "paired") return state;
      const qr = parsePairingQr(ev.text);
      return qr ? { step: "pairing", code: qr.code } : { step: "enter", code: state.code, error: "format" };
    }
    case "failed":
      return state.step === "pairing" ? { step: "enter", code: displayPairingCode(state.code), error: ev.error } : state;
    case "paired":
      return state.step === "pairing" ? { step: "paired", terminal: ev.terminal, shop: ev.shop } : state;
  }
}

// ---------------------------------------------------------------- terminal phases

export type TerminalPhase =
  | { phase: "loading" }
  | { phase: "unpaired"; notice?: "revoked" }
  | { phase: "offline"; device: DeviceInfo | null }
  | { phase: "locked"; device: DeviceInfo; notice?: "idle" | "expired" | "locked" }
  | { phase: "unlocked"; device: DeviceInfo; session: PinSession };

export type TerminalEvent =
  | { type: "noToken" }
  | { type: "device"; device: DeviceInfo }
  | { type: "deviceFailed"; error: unknown; cached?: DeviceInfo | null }
  | { type: "paired" }
  | { type: "unlock"; session: PinSession }
  | { type: "lock"; reason?: "idle" | "expired" | "locked" }
  /** A 401 from any call: `device_not_paired` → unpaired; anything else ends the PIN session. */
  | { type: "unauthorized"; code: string }
  | { type: "unpaired" };

export const initialTerminal: TerminalPhase = { phase: "loading" };

export function terminalReducer(state: TerminalPhase, ev: TerminalEvent): TerminalPhase {
  switch (ev.type) {
    case "noToken":
      return { phase: "unpaired" };
    case "paired":
      return { phase: "loading" };
    case "device":
      // A refresh while unlocked keeps the session (terminal renamed, settings changed).
      if (state.phase === "unlocked") return { ...state, device: ev.device };
      return { phase: "locked", device: ev.device };
    case "deviceFailed": {
      const e = errOf(ev.error);
      if (e.status === 401 || e.code === "device_not_paired") return { phase: "unpaired", notice: "revoked" };
      return { phase: "offline", device: ev.cached ?? null };
    }
    case "unlock":
      return state.phase === "locked" ? { phase: "unlocked", device: state.device, session: ev.session } : state;
    case "lock":
      return state.phase === "unlocked" || state.phase === "locked" ? { phase: "locked", device: state.device, notice: ev.reason } : state;
    case "unauthorized":
      if (ev.code === "device_not_paired") return { phase: "unpaired", notice: "revoked" };
      return state.phase === "unlocked" ? { phase: "locked", device: state.device, notice: "expired" } : state;
    case "unpaired":
      return { phase: "unpaired" };
  }
}

/** The view a phase needs, with feature / role checks (`features` from GET /pos/device). */
export function terminalView(
  p: TerminalPhase,
  keys: { terminals: string; weighing: string },
): "loading" | "pair" | "offline" | "off" | "lock" | "pos" | "weighing" {
  if (p.phase === "loading") return "loading";
  if (p.phase === "unpaired") return "pair";
  if (p.phase === "offline") return "offline";
  const { terminal, features } = p.device;
  if (!features.includes(keys.terminals)) return "off";
  if (terminal.role === "weighing" && !features.includes(keys.weighing)) return "off";
  if (p.phase === "locked") return "lock";
  return terminal.role === "weighing" ? "weighing" : "pos";
}

/** True when a PIN session is past its expiry (12 h, no sliding). */
export const sessionExpired = (s: Pick<PinSession, "expiresAt">, now = Date.now()) => {
  const t = Date.parse(s.expiresAt);
  return Number.isFinite(t) && t <= now;
};
