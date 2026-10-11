import { requireAppSession } from "@/lib/auth/require-app-session";
import { presentationFontVariables } from "@/components/presentation/fonts";
import { SessionUnavailable } from "@/components/auth/session-unavailable";

// Reads the session cookie on every request.
export const dynamic = "force-dynamic";

// Full-screen surfaces without the app shell (sidebar/header), protected
// exactly like (app): src/proxy.ts sends visitors without a Supabase user to
// /login; requireAppSession() handles authenticated users without access and
// auth provider outages (rendered as <SessionUnavailable />).
export default async function PreviewLayout({ children }: { children: React.ReactNode }) {
  const result = await requireAppSession();
  if (result.status === "unavailable") return <SessionUnavailable />;
  return <div className={presentationFontVariables}>{children}</div>;
}
