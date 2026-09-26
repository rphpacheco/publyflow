// Query key builders for proposal sending state, split into their own
// module so both `use-proposal.ts` and `use-proposal-sending.ts` can import
// them without creating a circular import between those two hook files.
export function proposalSendStateQueryKey(proposalId: string) {
  return ["proposal-send-state", proposalId] as const;
}

export function proposalPublicationsQueryKey(proposalId: string) {
  return ["proposal-publications", proposalId] as const;
}
