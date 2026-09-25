// next/font loaders for the Presentation Themes. Imported only by
// src/app/(preview)/layout.tsx (and later the public proposal page) --
// never by the renderer, so the renderer stays testable outside Next.
import { Bodoni_Moda, Cormorant_Garamond, DM_Serif_Display, Fraunces, IBM_Plex_Sans } from "next/font/google";

const cormorant = Cormorant_Garamond({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-pf-cormorant" });
const fraunces = Fraunces({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-pf-fraunces" });
const bodoni = Bodoni_Moda({ subsets: ["latin"], variable: "--font-pf-bodoni" });
const dmSerif = DM_Serif_Display({ subsets: ["latin"], weight: "400", variable: "--font-pf-dm-serif" });
const plex = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-pf-plex" });

export const presentationFontVariables = [
  cormorant.variable,
  fraunces.variable,
  bodoni.variable,
  dmSerif.variable,
  plex.variable,
].join(" ");
