// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { proposalSendStateQueryKey, proposalPublicationsQueryKey, usePublishProposal, useProposalSendState } from "./use-proposal-sending";
import { useUpdateProposal } from "./use-proposal";

function wrapperWith(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("proposal sending hooks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads send-state from the API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "DRAFT", publicPath: null, latestPublication: null, latestVersionNumber: 1, hasUnsentChanges: true, canSend: true })),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useProposalSendState("p1"), { wrapper: wrapperWith(client) });
    await waitFor(() => expect(result.current.data?.canSend).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/proposals/p1/send-state", undefined);
  });

  it("publishes with POST and no body, then invalidates send-state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ publication: { id: "pub1" }, publicPath: "/p/x", created: true }), { status: 201 }),
    );
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => usePublishProposal("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/proposals/p1/publications", { method: "POST" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalSendStateQueryKey("p1") });
  });

  it("invalidates send-state and publications even when publish fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "PROPOSAL_ARCHIVED" }), { status: 409 }),
    );
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => usePublishProposal("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalSendStateQueryKey("p1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalPublicationsQueryKey("p1") });
  });

  it("content mutations invalidate send-state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "p1", title: "T" })));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateProposal("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate({ title: "T" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalSendStateQueryKey("p1") });
  });
});
