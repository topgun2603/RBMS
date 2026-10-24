/**
 * Weighing scales on a USB / RS-232 port (Web Serial, Chrome / Edge). Most counter scales stream one line per
 * reading: "  1.234kg", "ST,GS,+  1.234kg" (ST stable / US unstable, GS gross / NT net), "+001.234 kg", "1234 g",
 * "W:  0.500 KG". The parser is pure and unit tested; `connectSerialScale` is the thin browser part.
 */

export interface ScaleReading {
  /** Kilograms, 3 decimals (negative when the scale shows a negative tare). */
  kg: number;
  /** true = stable, false = moving, null = the scale doesn't say. */
  stable: boolean | null;
  /** The line as received (trimmed). */
  raw: string;
}

const LB_KG = 0.45359237;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** One line from the scale → a reading, or null for lines that carry no weight (headers, "OL" overload, blanks). */
export function parseScaleLine(line: string): ScaleReading | null {
  // eslint-disable-next-line no-control-regex -- scales send STX / ETX and other control bytes
  const raw = line.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  let stable: boolean | null = null;
  if (/(^|[^A-Z])(ST|S S)([^A-Z]|$)/.test(upper)) stable = true;
  if (/(^|[^A-Z])(US|S D|MO|M)([^A-Z]|$)/.test(upper)) stable = false;
  if (/(^|[^A-Z])(OL|ERR|ERROR)([^A-Z]|$)/.test(upper)) return null;
  // The last signed number in the line, with an optional unit right after it.
  const matches = [...upper.matchAll(/([+-]?)\s*(\d+(?:[.,]\d+)?)\s*(KG|G|LB|LBS)?(?![A-Z])/g)];
  const m = matches.at(-1);
  if (!m) return null;
  const value = Number(m[2]!.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const unit = m[3] ?? (m[2]!.includes(".") || m[2]!.includes(",") ? "KG" : null);
  if (!unit) return null;
  const kg = unit === "G" ? value / 1000 : unit === "LB" || unit === "LBS" ? value * LB_KG : value;
  return { kg: round3(sign * kg), stable, raw };
}

/** Splits a byte stream's text into lines (CR, LF or CRLF); keeps the unfinished tail for the next chunk. */
export function createLineSplitter(onLine: (line: string) => void) {
  let buf = "";
  return {
    push(chunk: string) {
      buf += chunk;
      const parts = buf.split(/\r\n|\r|\n/);
      buf = parts.pop() ?? "";
      for (const p of parts) if (p.trim()) onLine(p);
      // A scale that never ends lines: don't grow forever.
      if (buf.length > 256) buf = buf.slice(-64);
    },
    get pending() {
      return buf;
    },
  };
}

/** Net weight after tare, 3 decimals; null when not positive or over the contract's 999.999 kg. */
export function netWeight(grossKg: number, tareKg: number): number | null {
  const n = round3(grossKg - (tareKg || 0));
  return n > 0 && n <= 999.999 ? n : null;
}

/** "1.234" / "1,234" / "1234g" typed by hand → kg (null when not a weight). */
export function parseManualWeight(text: string): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  const m = /^(\d+(?:\.\d+)?)\s*(kg|g)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  const kg = m[2] === "g" ? v / 1000 : v;
  return Number.isFinite(kg) ? round3(kg) : null;
}

export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;
export const DEFAULT_BAUD = 9600;

// ---------------------------------------------------------------- Web Serial (browser)

interface SerialPortLike {
  open(opts: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(opts?: unknown): Promise<SerialPortLike>;
}

export const serialSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

export interface SerialScale {
  close(): Promise<void>;
}

/**
 * Asks for a port (the browser's picker), opens it at `baud` and calls `onReading` for every weight line. `onEnd` runs
 * when the port goes away (unplugged) or reading fails.
 */
export async function connectSerialScale(
  baud: number,
  onReading: (r: ScaleReading) => void,
  onEnd: (err?: unknown) => void,
): Promise<SerialScale> {
  const serial = (navigator as unknown as { serial: SerialLike }).serial;
  const port = await serial.requestPort();
  await port.open({ baudRate: baud });
  let stopped = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const decoder = new TextDecoder();
  const splitter = createLineSplitter((line) => {
    const r = parseScaleLine(line);
    if (r) onReading(r);
  });
  void (async () => {
    try {
      while (!stopped && port.readable) {
        reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) splitter.push(decoder.decode(value, { stream: true }));
          }
        } finally {
          reader.releaseLock();
        }
      }
      onEnd();
    } catch (err) {
      if (!stopped) onEnd(err);
    }
  })();
  return {
    async close() {
      stopped = true;
      try {
        await reader?.cancel();
      } catch {
        // already released
      }
      try {
        await port.close();
      } catch {
        // already closed
      }
    },
  };
}
