import { presentationFontVariables } from "@/components/presentation/fonts";

// Public surfaces (no session, no app shell). Only the theme fonts.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className={presentationFontVariables}>{children}</div>;
}
