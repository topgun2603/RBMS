import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { tagsToRevalidate } from "../lib/cache-tags";

/*
 * On-demand revalidation (app/api/revalidate/route.ts): the API calls `POST /api/revalidate` right after staff change
 * a shop's home page, branding, catalogue, menus, pages, posts or offers, and the next shopper request fetches fresh
 * data. Time-based `revalidate` stays as the fallback (a missed call only means the old delay).
 *
 * Auth: a shared secret in the `x-revalidate-secret` header — STORE_REVALIDATE_SECRET, the same value the API has.
 * Outside production a fixed dev secret is used when it isn't set; in production the route is off without it.
 */

export const REVALIDATE_HEADER = "x-revalidate-secret";
/** Development only (both apps fall back to it when STORE_REVALIDATE_SECRET is unset and NODE_ENV isn't production). */
export const DEV_REVALIDATE_SECRET = "dev-store-revalidate-secret";

export function revalidateSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.STORE_REVALIDATE_SECRET?.trim();
  if (s) return s;
  return env.NODE_ENV === "production" ? null : DEV_REVALIDATE_SECRET;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** `POST /api/revalidate` `{ keys: [slug, domain…], resources?: ["home", "catalog", …] }` → clears those cache tags. */
export async function revalidateHandler(req: Request, deps: { secret?: string | null; revalidate?: (tag: string) => void } = {}): Promise<Response> {
  const secret = deps.secret === undefined ? revalidateSecret() : deps.secret;
  if (!secret) return json(404, { error: { code: "not_found", message: "Not found" } });
  const given = req.headers.get(REVALIDATE_HEADER) ?? "";
  if (!given || !same(given, secret)) return json(401, { error: { code: "unauthorized", message: "Bad revalidate secret" } });
  const tags = tagsToRevalidate(await req.json().catch(() => null));
  if (!tags) return json(400, { error: { code: "bad_request", message: "Expected { keys: string[], resources?: string[] }" } });
  const run = deps.revalidate ?? revalidateTag;
  for (const tag of tags) run(tag);
  return json(200, { revalidated: tags });
}
