// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { keepPreviousData } from "@tanstack/react-query";

// F3: the page test mocks useProposalQueue outright, so it can't observe TanStack's
// placeholderData behavior end-to-end. Instead we assert directly that the hook wires
// placeholderData: keepPreviousData into its useQuery options — this is what makes the
// "Mostrar arquivadas" toggle keep the previous groups on screen instead of blanking the
// page while the new query loads.
const useQueryMock = vi.fn((_options: unknown) => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQuery: (options: unknown) => useQueryMock(options) };
});

import { useProposalQueue } from "./use-proposal-queue";

describe("useProposalQueue", () => {
  it("passes placeholderData: keepPreviousData so toggling doesn't blank the page", () => {
    useProposalQueue(false);
    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({ placeholderData: keepPreviousData }));
  });
});
