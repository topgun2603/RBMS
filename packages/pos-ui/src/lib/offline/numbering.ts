import { financialYear, formatInvoiceNumber } from "@rbms/gst";
import type { LocalBlock, NumberingState } from "./types";

/**
 * Offline bill numbers. The safe way is to hold a block of the shop's real invoice numbers reserved ahead of time
 * (POST /pos/offline/blocks): the slip then carries the final legal number and the sync posts the bill with exactly it.
 * When the block is used up (or none was ever reserved) the bill gets a clearly different slip number, "OFF-A1B2-0007",
 * and the server assigns the legal number at sync. Pure functions here; the store runs them inside one transaction.
 */

/** How many numbers a block holds, and when the counter asks for another one. */
export const BLOCK_SIZE = 50;
export const REFILL_BELOW = 15;
/** A device never holds more than this many open blocks (the server refuses more). */
export const MAX_LOCAL_BLOCKS = 2;

export const fyOf = (date: string) => financialYear(date);

/** "OFF-C3D4-0007": can't be mistaken for an invoice number (the server builds the same text). */
export function provisionalNumber(deviceId: string, n: number): string {
  const tag = deviceId
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(-4)
    .toUpperCase()
    .padStart(4, "0");
  return `OFF-${tag}-${String(n).padStart(4, "0")}`;
}

export const remainingIn = (b: LocalBlock) => Math.max(b.toSeq - b.nextSeq + 1, 0);

/** Numbers still unused in the blocks of a financial year. */
export const remainingFor = (blocks: readonly LocalBlock[], fy: string) => blocks.filter((b) => b.fy === fy).reduce((s, b) => s + remainingIn(b), 0);

export type Allocation =
  | { kind: "reserved"; number: string; ref: { blockId: string; seq: number }; state: NumberingState }
  | { kind: "provisional"; number: string; provisional: string; state: NumberingState };

/**
 * Takes the next number for a bill dated `date`: from the oldest block of that bill's FY with numbers left, else a
 * provisional one. Never mutates `state`.
 */
export function allocate(state: NumberingState, date: string, deviceId: string): Allocation {
  const fy = fyOf(date);
  const block = [...state.blocks].filter((b) => b.fy === fy && remainingIn(b) > 0).sort((a, b) => a.fromSeq - b.fromSeq)[0];
  if (block) {
    const seq = block.nextSeq;
    return {
      kind: "reserved",
      number: formatInvoiceNumber(block.prefix, block.fy, seq),
      ref: { blockId: block.id, seq },
      state: { ...state, blocks: state.blocks.map((b) => (b.id === block.id ? { ...b, nextSeq: seq + 1 } : b)) },
    };
  }
  const counter = state.counter + 1;
  const provisional = provisionalNumber(deviceId, counter);
  return { kind: "provisional", number: provisional, provisional, state: { ...state, counter } };
}

/** Whether to ask the server for another block (online only): the FY's numbers are running low. */
export function needsBlock(blocks: readonly LocalBlock[], date: string): boolean {
  const fy = fyOf(date);
  const open = blocks.filter((b) => b.fy === fy && remainingIn(b) > 0);
  if (open.length >= MAX_LOCAL_BLOCKS) return false;
  return remainingFor(blocks, fy) < REFILL_BELOW;
}

/** Blocks with nothing left in them can go once their last bill has synced. */
export const isSpent = (b: LocalBlock) => remainingIn(b) === 0;

/** Blocks of a financial year that has ended and still hold numbers: to be released (voided with a reason). */
export const staleBlocks = (blocks: readonly LocalBlock[], today: string) => blocks.filter((b) => b.fy !== fyOf(today) && remainingIn(b) > 0);
