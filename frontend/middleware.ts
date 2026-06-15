import { NextResponse, type NextRequest } from "next/server";
import { signOnceEnabled, fiatToFiatEnabled } from "@/lib/feature-flags";

/**
 * Gate the opt-in flows at the route level. When a flow is disabled (see lib/feature-flags), any
 * request to its path is redirected to "/" (the always-on OffRampV3 offramp). This blocks direct
 * URL access too, not just nav links. Scoped by `config.matcher` so nothing else is touched.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const disabled =
    (pathname.startsWith("/sign-once") && !signOnceEnabled()) ||
    (pathname.startsWith("/fiat-to-fiat") && !fiatToFiatEnabled());

  if (disabled) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/sign-once", "/sign-once/:path*", "/fiat-to-fiat", "/fiat-to-fiat/:path*"],
};
