import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_COOKIE, previewRouting } from "@rbms/storefront-ui/preview";

/**
 * Live preview only (everything else passes through untouched):
 * - `?__preview=<token>` → the enter route, which verifies the token and sets the preview cookie;
 * - requests with the preview cookie → private, no-store, noindex, frameable only by the shop's editor origins.
 * The cookie is verified again by the server for every render (storefront-ui server/preview.ts); a bad one just
 * renders the public store.
 */
export function middleware(req: NextRequest) {
  const r = previewRouting(req.nextUrl, req.cookies.has(PREVIEW_COOKIE));
  if (r.action === "enter") return NextResponse.redirect(new URL(r.location, req.nextUrl), 303);
  if (r.action === "pass") return NextResponse.next();
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(r.headers)) res.headers.set(k, v);
  return res;
}

export const config = {
  // Pages and the preview routes; not static assets.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|robots\\.txt|sitemap\\.xml).*)"],
};
