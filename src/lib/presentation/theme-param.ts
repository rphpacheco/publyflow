import { PROPOSAL_THEMES, type ProposalTheme } from "@/lib/proposal-themes";

/** Reads `?theme=` (case-insensitive). Unknown or empty -> null. */
export function parseThemeParam(value: string | string[] | undefined): ProposalTheme | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim().toUpperCase();
  if (!raw) return null;
  return (PROPOSAL_THEMES as string[]).includes(raw) ? (raw as ProposalTheme) : null;
}

export function themeParamValue(theme: ProposalTheme): string {
  return theme.toLowerCase();
}
