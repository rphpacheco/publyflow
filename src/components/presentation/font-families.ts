// CSS font-family stacks. The variables are set by Next's font loader in
// src/components/presentation/fonts.ts (preview layout) and the root layout
// (--font-inter); the fallbacks keep tests and unstyled contexts readable.
export const FONT = {
  inter: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  cormorant: "var(--font-pf-cormorant), 'Cormorant Garamond', Georgia, serif",
  fraunces: "var(--font-pf-fraunces), Georgia, serif",
  bodoni: "var(--font-pf-bodoni), Didot, Georgia, serif",
  dmSerif: "var(--font-pf-dm-serif), Georgia, serif",
  plex: "var(--font-pf-plex), ui-sans-serif, system-ui, sans-serif",
} as const;
