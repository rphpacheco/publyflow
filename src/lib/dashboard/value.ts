import { parsePresentationSnapshot } from "@/lib/presentation/snapshot-schema";

/**
 * Σ quantity × unitPrice of a stored version snapshot; null when the JSON is not a valid snapshot
 * or has no items (an empty proposal falls back to the estimate).
 */
export function snapshotTotalCents(snapshotJson: unknown): number | null {
  try {
    const snapshot = parsePresentationSnapshot(snapshotJson);
    if (snapshot.items.length === 0) return null;
    return snapshot.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  } catch {
    return null;
  }
}

/** Spec D6: proposal value (accepted snapshot for won, current proposal for open) → estimate → 0. */
export function resolveValueCents(input: { preferredCents: number | null; estimatedValueCents: number | null }): number {
  return input.preferredCents ?? input.estimatedValueCents ?? 0;
}
