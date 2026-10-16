import { NextResponse, type NextRequest } from "next/server";

const LOCALE_COOKIE = "sr_locale";
const LOCALE_HEADER = "x-sr-locale";

/** `?lang=ta|en` picks the language for this request and remembers it in the cookie. */
export function middleware(req: NextRequest) {
  const lang = req.nextUrl.searchParams.get("lang");
  if (lang !== "ta" && lang !== "en") return NextResponse.next();
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set(LOCALE_HEADER, lang);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.cookies.set(LOCALE_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}

export const config = { matcher: ["/((?!api|_next|favicon|icon|.*\\.(?:svg|png|ico|txt|xml)$).*)"] };
