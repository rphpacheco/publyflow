import { PROPOSAL_THEMES, type ProposalTheme } from "@/lib/proposal-themes";
import { formatBRL, formatIssuedAt } from "./format";
import type {
  PresentationContext,
  PresentationItem,
  PresentationModel,
  PresentationSnapshotInput,
} from "./types";

const FALLBACK_THEME: ProposalTheme = "MINIMAL";

function resolveTheme(proposal: PresentationSnapshotInput["proposal"]): ProposalTheme {
  const raw = proposal.theme ?? proposal.template;
  return (PROPOSAL_THEMES as string[]).includes(raw ?? "") ? (raw as ProposalTheme) : FALLBACK_THEME;
}

function blockText(blocks: PresentationSnapshotInput["blocks"], blockType: string, key: string): string {
  const content = blocks.find((block) => block.blockType === blockType)?.content;
  if (content && typeof content === "object" && key in content) {
    const value = (content as Record<string, unknown>)[key];
    if (typeof value === "string") return value.trim();
  }
  return "";
}

function normalizeHandle(handle: string | null): string | null {
  const bare = (handle ?? "").trim().replace(/^@+/, "").trim();
  return bare ? `@${bare}` : null;
}

export function buildPresentation(
  snapshot: PresentationSnapshotInput,
  context: PresentationContext,
): PresentationModel {
  const items: PresentationItem[] = [...snapshot.items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => {
      const subtotalCents = item.unitPrice * item.quantity;
      return {
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPrice,
        subtotalCents,
        unitPriceLabel: formatBRL(item.unitPrice),
        subtotalLabel: formatBRL(subtotalCents),
      };
    });
  const totalCents = items.reduce((sum, item) => sum + item.subtotalCents, 0);
  const headline = blockText(snapshot.blocks, "COVER", "headline");
  const body = blockText(snapshot.blocks, "TEXT", "body");

  return {
    theme: resolveTheme(snapshot.proposal),
    title: snapshot.proposal.title,
    headline: headline || snapshot.proposal.title,
    body: body || null,
    creator: { name: context.creator.displayName, handle: normalizeHandle(context.creator.instagramHandle) },
    clientName: context.client.name?.trim() || null,
    items,
    totalCents,
    totalLabel: formatBRL(totalCents),
    issuedAtLabel: formatIssuedAt(context.issuedAt),
  };
}
