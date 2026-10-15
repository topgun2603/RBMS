/** Before/after diff of two JSON values, flattened to dotted paths (pure; used by the audit detail drawer). */

export type DiffKind = "added" | "removed" | "changed";

export interface DiffRow {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Leaf values by path: { a: { b: 1 }, c: [1, 2] } → { "a.b": 1, "c": [1, 2] }. Arrays of scalars stay whole. */
export function flatten(value: unknown, prefix = "", out: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (isPlainObject(value) && depth < 6) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) out[prefix] = {};
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out, depth + 1);
    return out;
  }
  if (Array.isArray(value) && depth < 6 && value.some((v) => isPlainObject(v) || Array.isArray(v))) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out, depth + 1));
    if (value.length === 0 && prefix) out[prefix] = [];
    return out;
  }
  out[prefix || "value"] = value;
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Changed, added and removed paths between `before` and `after`, in path order. Unchanged paths are left out. */
export function diffJson(before: unknown, after: unknown): DiffRow[] {
  const a = before === null || before === undefined ? {} : flatten(before);
  const b = after === null || after === undefined ? {} : flatten(after);
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) => x.localeCompare(y));
  const rows: DiffRow[] = [];
  for (const path of paths) {
    const inA = path in a;
    const inB = path in b;
    if (inA && inB) {
      if (!same(a[path], b[path])) rows.push({ path, kind: "changed", before: a[path], after: b[path] });
    } else if (inB) rows.push({ path, kind: "added", after: b[path] });
    else rows.push({ path, kind: "removed", before: a[path] });
  }
  return rows;
}

/** Short display text for a JSON leaf. */
export function showValue(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
