const PUBLIC_PREFIXES = ["/login", "/sem-acesso", "/auth", "/p", "/forgot-password"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
