import { requireAppSession } from "@/lib/auth/require-app-session";
import { presentationFontVariables } from "@/components/presentation/fonts";

// Reads the session cookie on every request.
export const dynamic = "force-dynamic";

// Full-screen surfaces without the app shell (sidebar/header), protected
// exactly like (app): src/proxy.ts sends visitors without a Supabase user to
// /login; requireAppSession() handles authenticated users without access.
export default async function PreviewLayout({ children }: { children: React.ReactNode }) {
  await requireAppSession();
  return <div className={presentationFontVariables}>{children}</div>;
}
