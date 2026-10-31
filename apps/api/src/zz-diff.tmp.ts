import { THEME_PRESETS, THEME_OPTIONS } from "@rbms/branding";
const c: Record<string,string> = JSON.parse(process.argv[2]!);
const keys = Object.keys(THEME_OPTIONS);
const missing = keys.filter((k) => !(k in c)); if (missing.length) console.log("missing", missing);
const rows = THEME_PRESETS.map((p) => [p.id, keys.filter((k) => (p.theme as any)[k] !== c[k]).length] as const).sort((a, b) => a[1] - b[1]);
console.log(rows.slice(0, 8).map((r) => r.join(":")).join("  "));
