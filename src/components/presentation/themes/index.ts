import type { ProposalTheme } from "@/lib/proposal-themes";
import type { ThemeDefinition } from "../theme-types";
import { premiumTheme } from "./premium";
import { minimalTheme } from "./minimal";
import { editorialTheme } from "./editorial";
import { fashionTheme } from "./fashion";
import { beautyTheme } from "./beauty";
import { corporateTheme } from "./corporate";

// A Record keyed by ProposalTheme: a missing theme is a compile error.
export const THEMES: Record<ProposalTheme, ThemeDefinition> = {
  PREMIUM: premiumTheme,
  MINIMAL: minimalTheme,
  EDITORIAL: editorialTheme,
  FASHION: fashionTheme,
  BEAUTY: beautyTheme,
  CORPORATE: corporateTheme,
};
