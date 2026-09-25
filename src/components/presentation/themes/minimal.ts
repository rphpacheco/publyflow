import { FONT } from "../font-families";
import type { ThemeDefinition } from "../theme-types";

export const minimalTheme: ThemeDefinition = {
  id: "MINIMAL",
  cover: "split-meta",
  items: "lines",
  fonts: { display: FONT.inter, text: FONT.inter, ui: FONT.inter },
  classes: {
    page: "min-h-full bg-white text-[#111111]",
    document: "mx-auto flex w-full max-w-[880px] flex-col gap-10 px-6 py-12 @xl:px-12 @xl:py-16",
    coverBox: "",
    eyebrow: "text-xs text-[#888888]",
    headline: "mt-10 text-3xl font-semibold leading-tight tracking-tight break-words @xl:text-5xl",
    byline: "text-sm text-[#555555]",
    meta: "text-xs text-[#888888]",
    rule: "h-px w-full bg-[#EEEEEE]",
    body: "max-w-[62ch] space-y-4 text-base leading-relaxed text-[#444444]",
    sectionLabel: "mb-2 text-xs font-medium uppercase tracking-wider text-[#888888]",
    itemsBox: "",
    item: "flex items-start justify-between gap-4 border-t border-[#EEEEEE] py-3",
    itemName: "text-sm font-medium break-words",
    itemDetail: "mt-0.5 text-xs text-[#999999]",
    itemAmount: "text-sm",
    totalBox: "flex items-baseline justify-between gap-4 border-t border-[#111111] pt-3",
    totalLabel: "text-sm font-semibold",
    totalAmount: "text-lg font-semibold",
    actions: "flex flex-wrap items-center gap-4 pt-2",
    ctaPrimary: "rounded-md bg-[#111111] px-5 py-2.5 text-sm font-medium text-white aria-disabled:cursor-default",
    ctaSecondary: "text-sm text-[#555555] underline underline-offset-4 aria-disabled:cursor-default",
  },
};
