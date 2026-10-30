// Serial numbers / IMEIs typed or scanned on a bill line (packages/serials checks them again on the server).

/** One serial per line, or separated by commas / semicolons / tabs. Upper-case, no spaces, no repeats. */
export function parseSerialText(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\n,;\t]+/)) {
    const s = raw.replace(/\s+/g, "").toUpperCase();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Message key when the line has more serial numbers than units (the API refuses it); null when fine. */
export function serialsError(serials: readonly string[] | undefined, qty: number | null): string | null {
  if (!serials?.length || qty === null) return null;
  return serials.length > Math.ceil(qty) ? "billing.form.serials.tooMany" : null;
}
