/**
 * Text helpers for the ESC/POS path. The printer's built-in code page is plain ASCII here: a few common symbols are
 * mapped to ASCII look-alikes; anything else (Tamil, other scripts) means the receipt is rendered as an image instead.
 */

const ASCII_MAP: Record<string, string> = {
  "₹": "Rs.", // rupee sign: not in any default thermal code page
  "×": "x",
  "·": "-",
  "•": "*",
  "–": "-",
  "—": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  " ": " ",
  "−": "-",
  "→": "->",
};

/** Maps the symbols above to ASCII; every other character is kept as is. */
export function softAscii(text: string): string {
  let out = "";
  for (const ch of text) out += ASCII_MAP[ch] ?? ch;
  return out;
}

/** True when the text has a character that is not printable ASCII after `softAscii` (so it needs the image path). */
export function needsRaster(text: string): boolean {
  for (const ch of softAscii(text)) {
    const c = ch.codePointAt(0)!;
    if (c > 0x7e || (c < 0x20 && c !== 0x0a && c !== 0x09)) return true;
  }
  return false;
}

/** ASCII bytes of `text`; characters that can't be sent become "?". */
export function asciiBytes(text: string): number[] {
  const out: number[] = [];
  for (const ch of softAscii(text)) {
    const c = ch.codePointAt(0)!;
    if (c === 0x0a) out.push(0x0a);
    else if (c === 0x09) out.push(0x20);
    else out.push(c >= 0x20 && c <= 0x7e ? c : 0x3f);
  }
  return out;
}

/** Word-wraps to `width` characters (hard-breaks words longer than a line). Counts code points. */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width));
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let rest = Array.from(word);
      if (line && Array.from(line).length + 1 + rest.length <= w) {
        line += " " + word;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      while (rest.length > w) {
        lines.push(rest.slice(0, w).join(""));
        rest = rest.slice(w);
      }
      line = rest.join("");
    }
    lines.push(line);
  }
  return lines;
}

const len = (s: string) => Array.from(s).length;

export function padRight(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - len(s)));
}

export function padLeft(s: string, width: number): string {
  return " ".repeat(Math.max(0, width - len(s))) + s;
}

export function center(s: string, width: number): string {
  const gap = Math.max(0, width - len(s));
  return " ".repeat(Math.floor(gap / 2)) + s;
}

/**
 * "left ........ right" on one or more lines of `width` characters: the left text wraps, the right text sits on the
 * last line (or alone on the next line when the two can't share it).
 */
export function pairLines(left: string, right: string, width: number): string[] {
  const r = len(right);
  if (r === 0) return wrapText(left, width);
  if (r >= width) return [...wrapText(left, width), padLeft(right, width)];
  const wrapped = wrapText(left, Math.max(1, width - r - 1));
  const last = wrapped[wrapped.length - 1] ?? "";
  if (len(last) + 1 + r <= width) {
    wrapped[wrapped.length - 1] = padRight(last, width - r) + right;
    return wrapped;
  }
  return [...wrapped, padLeft(right, width)];
}
