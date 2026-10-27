/**
 * What stops the cashier from closing the day (or handing the drawer over) yet, in the order the form shows it. Pure so
 * the rules are tested: a count that differs from the expected cash needs a reason, and bills made offline that have
 * not reached the server are not in the Z report yet, so closing waits for them unless the cashier chooses to close anyway.
 */
export type CloseBlocker = "no_count" | "reason" | "offline_pending";

export function closeBlockers(p: {
  /** Paise counted in the drawer. */
  counted: number;
  /** Paise the till expects; null while the X report loads. */
  expected: number | null;
  reason: string;
  /** Bills made offline that have not synced. */
  pendingBills: number;
  /** The cashier ticked "close anyway". */
  closeAnyway: boolean;
}): CloseBlocker[] {
  const out: CloseBlocker[] = [];
  if (p.expected === null) return ["no_count"];
  if (p.counted - p.expected !== 0 && !p.reason.trim()) out.push("reason");
  if (p.pendingBills > 0 && !p.closeAnyway) out.push("offline_pending");
  return out;
}

/** "short" / "over" / "match" for a counted − expected difference (paise). */
export const differenceKind = (diff: number): "short" | "over" | "match" => (diff < 0 ? "short" : diff > 0 ? "over" : "match");
