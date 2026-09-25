import { FONT } from "../font-families";
import type { ThemeDefinition } from "../theme-types";

export const corporateTheme: ThemeDefinition = {
  id: "CORPORATE",
  cover: "bar",
  items: "table",
  fonts: { display: FONT.plex, text: FONT.plex, ui: FONT.plex },
  classes: {
    page: "min-h-full bg-white text-[#1B2433]",
    document: "mx-auto flex w-full max-w-[880px] flex-col gap-8 pb-12",
    coverBox:
      "flex items-center justify-between gap-4 bg-[#1F3A5F] px-6 py-4 text-xs font-medium uppercase tracking-wider text-white @xl:px-10",
    eyebrow: "",
    headline: "px-6 text-2xl font-semibold leading-snug break-words @xl:px-10 @xl:text-4xl",
    byline: "",
    meta: "px-6 text-xs text-[#5B6678] @xl:px-10",
    rule: "hidden",
    body: "space-y-3 px-6 text-sm leading-relaxed text-[#3B4557] @xl:px-10",
    sectionLabel: "mb-2 text-xs font-semibold uppercase tracking-wider text-[#5B6678]",
    itemsBox: "px-6 @xl:px-10",
    item: "border-b border-[#E5E9F0] text-sm",
    itemName: "break-words",
    itemDetail: "border-b border-[#C5CEDB] bg-[#EEF2F7] text-[11px] uppercase tracking-wide text-[#5B6678]",
    itemAmount: "font-medium",
    totalBox:
      "mx-6 flex items-baseline justify-between gap-4 bg-[#EEF2F7] px-4 py-3 @xl:mr-10 @xl:ml-auto @xl:w-[45%]",
    totalLabel: "text-sm font-semibold",
    totalAmount: "text-xl font-semibold",
    actions: "flex flex-wrap gap-3 px-6 @xl:px-10",
    ctaPrimary: "rounded-sm bg-[#1F3A5F] px-5 py-2.5 text-sm font-medium text-white aria-disabled:cursor-default",
    ctaSecondary: "rounded-sm border border-[#C5CEDB] px-5 py-2.5 text-sm aria-disabled:cursor-default",
  },
};
