import { proxyHandler } from "@rbms/storefront-ui";

/** Same-origin API proxy for the browser (the shop is resolved from this request's host). */
export const dynamic = "force-dynamic";
export { proxyHandler as GET, proxyHandler as POST, proxyHandler as PUT, proxyHandler as PATCH, proxyHandler as DELETE };
