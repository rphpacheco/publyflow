import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { isPublicPath } from "@/lib/auth/public-paths";
import { db } from "@/db";
import { checkRateLimit, PUBLIC_PAGE_LIMIT } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/p/")) {
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

  const { data } = await supabase.auth.getUser();

  if (!data.user && !isPublicPath(request.nextUrl.pathname)) {
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
