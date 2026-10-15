/**
 * USB / Bluetooth barcode scanners in "keyboard wedge" mode type the code very fast (a few ms per key) and press
 * Enter. People type far slower (≥ 80 ms between keys). The detector buffers printable keys while they arrive within
 * `maxGapMs` of each other and reports a scan when Enter follows quickly after at least `minLength` such keys.
 * Pure and clock-free (the caller passes the event time), so the timing rules are unit tested.
 */

export interface WedgeOptions {
  /** Longest pause between two keys of one scan (default 50 ms). */
  maxGapMs?: number;
  /** Shortest code that counts as a scan (default 4 characters). */
  minLength?: number;
  /** Longest code (default 64): anything longer is ignored as noise. */
  maxLength?: number;
}

export interface WedgeKey {
  /** KeyboardEvent.key */
  key: string;
  /** Event time in ms (KeyboardEvent.timeStamp or performance.now()). */
  time: number;
}

/** Keys scanners send around characters that must not break a scan. */
const IGNORED = new Set(["Shift", "CapsLock", "Alt", "Control", "Meta", "Unidentified"]);

export interface WedgeDetector {
  /** Feed every keydown. Returns the scanned code on the Enter that ends a scan, else null. */
  push(e: WedgeKey): string | null;
  /** Characters buffered so far (for tests / debugging). */
  readonly buffer: string;
  /** True while the buffer looks like a scan in progress (≥ 2 fast keys): callers may swallow the keys. */
  readonly scanning: boolean;
  reset(): void;
}

export function createWedgeDetector(opts: WedgeOptions = {}): WedgeDetector {
  const maxGap = opts.maxGapMs ?? 50;
  const minLength = opts.minLength ?? 4;
  const maxLength = opts.maxLength ?? 64;
  let chars: string[] = [];
  let last = -Infinity;

  const reset = () => {
    chars = [];
    last = -Infinity;
  };

  return {
    push({ key, time }) {
      if (IGNORED.has(key)) return null;
      const gap = time - last;
      if (key === "Enter" || key === "Tab") {
        const code = chars.join("");
        const fast = gap <= maxGap;
        reset();
        return fast && code.length >= minLength && code.length <= maxLength ? code : null;
      }
      if (key.length !== 1) {
        // Arrows, F-keys, Backspace: a person is typing.
        reset();
        return null;
      }
      if (chars.length > 0 && gap > maxGap) chars = [];
      chars.push(key);
      last = time;
      return null;
    },
    get buffer() {
      return chars.join("");
    },
    get scanning() {
      return chars.length >= 2;
    },
    reset,
  };
}

/** Trim and drop control characters some scanners prefix/suffix (AIM ids are kept). */
export function cleanCode(raw: string): string {
  // eslint-disable-next-line no-control-regex -- scanners may send control chars
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
