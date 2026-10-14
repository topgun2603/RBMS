import { z } from "zod";

/** Parses `source` against `schema` and throws one readable error listing every bad variable. */
export function loadEnv<S extends z.ZodTypeAny>(schema: S, source: Record<string, string | undefined> = process.env): z.infer<S> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

/** Treats empty strings as unset, so `FOO=` in .env behaves like a missing variable. */
export const optionalString = () =>
  z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
