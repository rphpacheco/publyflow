import type { ProposalTheme } from "@/lib/proposal-themes";

/** How the cover is composed. */
export type CoverLayout = "centered" | "split-meta" | "masthead" | "block" | "card" | "bar";
/** How the items are laid out. */
export type ItemsLayout = "lines" | "numbered" | "grid" | "cards" | "table";

export interface ThemeFonts {
  /** Headline, item names/amounts, total amount. */
  display: string;
  /** Running text. */
  text: string;
  /** Small labels, metadata, buttons. */
  ui: string;
}

/** Tailwind class strings per slot. Responsive rules use container queries (@xl:). */
export interface ThemeClasses {
  page: string;
  document: string;
  coverBox: string;
  eyebrow: string;
  headline: string;
  byline: string;
  meta: string;
  rule: string;
  body: string;
  sectionLabel: string;
  itemsBox: string;
  item: string;
  itemName: string;
  itemDetail: string;
  itemAmount: string;
  totalBox: string;
  totalLabel: string;
  totalAmount: string;
  actions: string;
  ctaPrimary: string;
  ctaSecondary: string;
}

export interface ThemeDefinition {
  id: ProposalTheme;
  cover: CoverLayout;
  items: ItemsLayout;
  fonts: ThemeFonts;
  classes: ThemeClasses;
}
