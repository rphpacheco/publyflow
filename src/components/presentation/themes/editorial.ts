import { FONT } from "../font-families";
import type { ThemeDefinition } from "../theme-types";

export const editorialTheme: ThemeDefinition = {
  id: "EDITORIAL",
  cover: "masthead",
  items: "numbered",
  fonts: { display: FONT.fraunces, text: FONT.fraunces, ui: FONT.inter },
  classes: {
    page: "min-h-full bg-[#F5F1EA] text-[#1D1A16]",
    document: "mx-auto flex w-full max-w-[880px] flex-col gap-10 px-6 py-10 @xl:px-12 @xl:py-14",
    coverBox: "",
    eyebrow: "text-[10px] uppercase tracking-[0.2em]",
    headline: "mt-6 text-4xl font-semibold leading-[0.98] tracking-tight hyphens-auto break-words @xl:text-7xl",
    byline: "mt-3 text-lg italic text-[#6B5F52]",
    meta: "text-xs text-[#6B5F52]",
    rule: "mt-2 h-0.5 w-full bg-[#1D1A16]",
    body:
      "space-y-4 text-base leading-relaxed @xl:columns-2 @xl:gap-8 " +
      "@xl:[&>p:first-child]:first-letter:float-left @xl:[&>p:first-child]:first-letter:pr-2 " +
      "@xl:[&>p:first-child]:first-letter:text-6xl @xl:[&>p:first-child]:first-letter:leading-[0.8] " +
      "@xl:[&>p:first-child]:first-letter:text-[#B3261E]",
    sectionLabel: "mb-2 text-[10px] uppercase tracking-[0.2em] text-[#B3261E]",
    itemsBox: "",
    item: "flex items-baseline justify-between gap-4 border-b border-dotted border-[#B9AD9D] py-3",
    itemName: "text-lg break-words",
    itemDetail: "mt-0.5 text-xs text-[#6B5F52]",
    itemAmount: "text-lg",
    totalBox: "flex flex-wrap items-baseline justify-between gap-4 pt-2",
    totalLabel: "text-[10px] uppercase tracking-[0.2em] text-[#B3261E]",
    totalAmount: "text-3xl font-semibold",
    actions: "flex flex-wrap items-center gap-4 pt-2",
    ctaPrimary: "bg-[#B3261E] px-5 py-2.5 text-sm font-medium text-white aria-disabled:cursor-default",
    ctaSecondary: "border-b border-[#1D1A16] py-1 text-sm aria-disabled:cursor-default",
  },
};
