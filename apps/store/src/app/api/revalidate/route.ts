import { revalidateHandler } from "@srirealtime/storefront-ui";

/**
 * On-demand revalidation: the API posts here (shared secret STORE_REVALIDATE_SECRET) right after staff change a
 * shop's content, and the cached data of that shop is refreshed on the next request (storefront-ui server/revalidate).
 */
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return revalidateHandler(req);
}
