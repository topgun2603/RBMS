import { homeSectionSchema } from "@srirealtime/cms";

/* A compact description of a zod schema, for the planner ("what fields does a section of this type take?"). */

type Def = { typeName?: string; innerType?: unknown; schema?: unknown; type?: unknown; shape?: () => Record<string, unknown>; values?: unknown; value?: unknown; options?: unknown[]; checks?: { kind: string; value?: number }[]; valueType?: unknown };
const defOf = (z: unknown): Def => ((z as { _def?: Def })._def ?? {}) as Def;

export function describeZod(z: unknown, depth = 0): string {
  const d = defOf(z);
  switch (d.typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
    case "ZodBranded":
      return describeZod(d.innerType, depth);
    case "ZodEffects":
      return describeZod(d.schema, depth);
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodLiteral":
      return JSON.stringify(d.value);
    case "ZodEnum":
      return (d.values as string[]).join("|");
    case "ZodArray":
      return `[${describeZod(d.type, depth + 1)}]`;
    case "ZodRecord":
      return "object";
    case "ZodUnion":
      return (d.options ?? []).map((o) => describeZod(o, depth + 1)).join(" or ");
    case "ZodObject": {
      if (depth >= 2) return "object";
      const shape = (d.shape as () => Record<string, unknown>)();
      return `{ ${Object.entries(shape)
        .map(([k, v]) => `${k}${isOptional(v) ? "?" : ""}: ${describeZod(v, depth + 1)}`)
        .join(", ")} }`;
    }
    case "ZodLazy":
      return "object";
    default:
      return "any";
  }
}

function isOptional(z: unknown): boolean {
  const d = defOf(z);
  if (d.typeName === "ZodOptional" || d.typeName === "ZodDefault" || d.typeName === "ZodCatch") return true;
  if (d.typeName === "ZodNullable") return isOptional(d.innerType);
  if (d.typeName === "ZodEffects") return isOptional(d.schema);
  return false;
}

/** The fields of one home section type: `{ name: "type", name?: "type" }`. Optional fields have a `?`. */
export function sectionFields(type: string): string | null {
  const opts = (homeSectionSchema as unknown as { options: unknown[] }).options;
  const found = opts.find((o) => {
    const shape = (defOf(o).shape as () => Record<string, unknown>)();
    return defOf(shape.type).value === type;
  });
  if (!found) return null;
  const shape = (defOf(found).shape as () => Record<string, unknown>)();
  return Object.entries(shape)
    .filter(([k]) => k !== "type" && k !== "id")
    .map(([k, v]) => `${k}${isOptional(v) ? "?" : ""}: ${describeZod(v, 1)}`)
    .join("; ");
}
