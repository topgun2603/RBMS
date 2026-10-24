/**
 * Shared bits of the Phase 3 trade packs: cleaning text read from a photo, flags the screens translate, small maths.
 * Text read from a photo or typed into a name is DATA: it is cleaned, length-limited and dropped when it reads like an
 * instruction to an AI. Numbers are always computed in code.
 */
import { neutralise } from "../assist/safety";

export type FlagSeverity = "error" | "warn" | "info";
export interface Flag {
  /** Stable code the UI translates (`pharmacy.ai.flag.<code>`, `restaurant.ai.flag.<code>`). */
  code: string;
  severity: FlagSeverity;
  /** 0-based line the flag is about. */
  line?: number;
  field?: string;
  params?: Record<string, string | number>;
}

export class Flags {
  readonly list: Flag[] = [];
  add(code: string, severity: FlagSeverity, extra: Omit<Flag, "code" | "severity"> = {}) {
    this.list.push({ code, severity, ...extra });
  }
}

const INJECTION = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|preceding)/i,
  /disregard\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|instructions|rules)/i,
  /forget\s+(everything|all|your)\s+(previous|prior|instructions|rules)?/i,
  /\b(system|developer)\s+(prompt|message|instruction)s?\b/i,
  /you\s+are\s+now\b/i,
  /\bnew\s+instructions?\b/i,
  /\b(act|behave)\s+as\s+(an?\s+)?(ai|assistant|model|admin)/i,
  /\b(reveal|print|show|output|repeat)\b.{0,30}\b(prompt|instructions|api\s*key|secret)/i,
  /<\s*\/?\s*(system|assistant|instructions?)\s*>/i,
  /\bassistant\s*:/i,
  /\bjailbreak\b/i,
  /\b(reply|respond|answer|say|write)\b[^.\n]{0,25}\b(only|just)\b[^.\n]{0,15}\b(with|the word)\b/i,
  /\b(say|state|declare|mark|write)\b[^.\n]{0,30}\b(is|are|as)\s+(safe|harmless|fine|approved|free)\b/i,
  /\bno\s+interactions?\b[^.\n]{0,30}\b(say|write|reply|output)/i,
];
export const looksLikeInjection = (s: string) => INJECTION.some((re) => re.test(s)) || neutralise(s).suspicious;

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g;

/** Plain, single-line, length-limited text: control and bidi characters and markup removed. null when nothing is left. */
export function cleanText(v: string | null | undefined, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(CONTROL, " ")
    .replace(/<[^>]{0,200}>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return s || null;
}

/** Clean a text field; drop it (and flag `injection`) when it reads like an instruction to an AI. */
export function safeText(v: string | null | undefined, max: number, flags: Flags, field: string, line?: number): string | null {
  const s = cleanText(v, max);
  if ((s && looksLikeInjection(s)) || (typeof v === "string" && looksLikeInjection(v.slice(0, 2000)))) {
    flags.add("injection", "warn", { field, ...(line !== undefined ? { line } : {}) });
    return null;
  }
  return s;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** "YYYY-MM-DD" plus days (UTC calendar maths on IST calendar dates). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
/** 0 = Sunday ... 6 = Saturday, for an IST calendar date. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
