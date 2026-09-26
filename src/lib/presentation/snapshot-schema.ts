import { z } from "zod";
import type { PresentationSnapshotInput } from "./types";

// Stored JSON (proposal_versions.snapshot_json, proposal_publications.context)
// is untyped jsonb: validate it at the boundary instead of casting.

const snapshotSchema = z.object({
  proposal: z.object({
    title: z.string(),
    status: z.string(),
    theme: z.string().optional(),
    template: z.string().optional(), // snapshots stored before the template -> theme rename
  }),
  items: z.array(
    z.object({ description: z.string(), quantity: z.number().int(), unitPrice: z.number().int(), sortOrder: z.number().int() }),
  ),
  blocks: z.array(z.object({ blockType: z.string(), content: z.unknown() })),
});

export function parsePresentationSnapshot(value: unknown): PresentationSnapshotInput {
  const parsed = snapshotSchema.parse(value);
  return {
    proposal: parsed.proposal,
    items: parsed.items,
    blocks: parsed.blocks.map((block) => ({ blockType: block.blockType, content: block.content })),
  };
}

const contextSchema = z.object({
  creator: z.object({ displayName: z.string(), instagramHandle: z.string().nullable() }),
  clientName: z.string().nullable(),
  issuedAt: z.iso.datetime(),
});

export interface PublicationContext {
  creator: { displayName: string; instagramHandle: string | null };
  clientName: string | null;
  issuedAt: Date;
}

export interface PublicationContextJson {
  creator: { displayName: string; instagramHandle: string | null };
  clientName: string | null;
  issuedAt: string;
}

export function parsePublicationContext(value: unknown): PublicationContext {
  const parsed = contextSchema.parse(value);
  return { creator: parsed.creator, clientName: parsed.clientName, issuedAt: new Date(parsed.issuedAt) };
}

export function toPublicationContextJson(
  parties: { creator: PublicationContext["creator"]; clientName: string | null },
  issuedAt: Date,
): PublicationContextJson {
  return {
    creator: { displayName: parties.creator.displayName, instagramHandle: parties.creator.instagramHandle },
    clientName: parties.clientName,
    issuedAt: issuedAt.toISOString(),
  };
}
