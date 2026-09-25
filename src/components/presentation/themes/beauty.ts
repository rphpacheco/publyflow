import { FONT } from "../font-families";
import type { ThemeDefinition } from "../theme-types";

export const beautyTheme: ThemeDefinition = {
  id: "BEAUTY",
  cover: "card",
  items: "cards",
  fonts: { display: FONT.dmSerif, text: FONT.inter, ui: FONT.inter },
  classes: {
    page: "min-h-full bg-[#FBEFEC] text-[#4A2E33]",
    document: "mx-auto flex w-full max-w-[880px] flex-col gap-8 px-5 py-10 @xl:px-10 @xl:py-14",
    coverBox:
      "flex flex-col items-center rounded-[28px] bg-white px-6 py-12 text-center shadow-[0_10px_40px_-20px_rgba(109,52,64,0.35)]",
    eyebrow: "rounded-full bg-[#F3D6D9] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#A4505E]",
    headline: "mt-5 text-4xl leading-tight text-[#6D3440] break-words @xl:text-6xl",
    byline: "mt-3 text-sm text-[#A07A80]",
    meta: "text-xs text-[#A07A80]",
    rule: "hidden",
    body: "space-y-4 px-1 text-base leading-relaxed",
    sectionLabel: "mb-3 px-1 text-xs font-medium uppercase tracking-[0.12em] text-[#A4505E]",
    itemsBox: "",
    item: "flex items-start justify-between gap-4 rounded-2xl bg-white px-5 py-4",
    itemName: "text-lg text-[#6D3440] break-words",
    itemDetail: "mt-0.5 text-xs text-[#B08990]",
    itemAmount: "text-lg text-[#6D3440]",
    totalBox: "flex items-baseline justify-between gap-4 px-5",
    totalLabel: "text-sm font-medium text-[#A4505E]",
    totalAmount: "text-3xl text-[#6D3440]",
    actions: "flex flex-wrap justify-center gap-3",
    ctaPrimary: "rounded-full bg-[#D4838F] px-6 py-3 text-sm font-semibold text-white aria-disabled:cursor-default",
    ctaSecondary: "rounded-full bg-white px-6 py-3 text-sm text-[#A4505E] aria-disabled:cursor-default",
  },
};
