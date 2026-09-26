import type { ProposalTheme } from "@/lib/proposal-themes";

/**
 * The part of a proposal snapshot the presentation needs. `ProposalSnapshot`
 * (src/services/proposal-version.service.ts) is assignable to it, and so are
 * snapshots stored before the template -> theme rename (they carry
 * `template` instead of `theme`).
 */
export interface PresentationSnapshotInput {
  proposal: { title: string; status: string; theme?: string; template?: string };
  items: Array<{ description: string; quantity: number; unitPrice: number; sortOrder: number }>;
  blocks: Array<{ blockType: string; content: unknown }>;
}

export interface PresentationContext {
  creator: { displayName: string; instagramHandle: string | null };
  client: { name: string | null };
  /** Supplied by the caller: "now" for the preview, publication date later. */
  issuedAt: Date;
}

export interface PresentationItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  unitPriceLabel: string;
  subtotalLabel: string;
}

export interface PresentationModel {
  theme: ProposalTheme;
  title: string;
  headline: string;
  body: string | null;
  creator: { name: string; handle: string | null };
  clientName: string | null;
  items: PresentationItem[];
  totalCents: number;
  totalLabel: string;
  issuedAtLabel: string;
}

export type PresentationAction = "accept" | "request_changes" | "reject";

export type PresentationResponseAction = "ACCEPT" | "REQUEST_CHANGES" | "REJECT";

export interface PresentationResponse {
  action: PresentationResponseAction;
  respondentName: string;
  respondedAtLabel: string;
  message: string | null;
}
