const PUBLIC_PREFIXES = ["/login", "/sem-acesso", "/auth", "/p"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
