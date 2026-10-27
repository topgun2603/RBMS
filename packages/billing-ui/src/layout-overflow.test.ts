import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A CSS grid with no explicit base column track gets one `auto` column, which grows to the widest unbreakable child
 * (a long Tamil word, a wide table, a min-w-max calendar) and pushes the whole page sideways on phones. Page-level
 * two-column layouts must therefore name their mobile track: `grid-cols-[minmax(0,1fr)]`.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("billing-ui layout grids", () => {
  const files = walk(join(__dirname)).filter((f) => !/accounting|acctb|part-b/.test(f));
  it("names the mobile column track on responsive page grids", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/className="([^"]*\bgrid\b[^"]*\b(?:sm|md|lg|xl):grid-cols-\[minmax\(0,1fr\)_[^"]*)"/g)) {
        if (!/(^|\s)grid-cols-/.test(m[1]!)) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
