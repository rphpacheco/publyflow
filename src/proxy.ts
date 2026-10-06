import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { isPublicPath } from "@/lib/auth/public-paths";
import { isAuthServiceFailure } from "@/lib/auth/errors";
import { checkRateLimit, PUBLIC_PAGE_LIMIT } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/p/")) {
    const { db } = await import("@/db");
    const limit = await checkRateLimit(db, { ...PUBLIC_PAGE_LIMIT, ip: clientIp(request.headers) });
    if (!limit.allowed) {
      return new NextResponse("Muitas requisições. Aguarde um minuto e recarregue a página.", {
        status: 429,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": String(limit.retryAfterSeconds),
        },
      });
    }
  }

  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims() verifies the JWT locally when the project uses asymmetric
  // signing keys (falls back to a network call otherwise). It only decides
  // this redirect and refreshes cookies -- authorization still comes from
  // getSession() (getUser + membership).
  let hasUser: boolean;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error && isAuthServiceFailure(error)) return response; // provider down: let the page render its unavailable state
    hasUser = Boolean(data?.claims);
  } catch (error) {
    if (isAuthServiceFailure(error)) return response;
    throw error;
  }

  if (!hasUser && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
