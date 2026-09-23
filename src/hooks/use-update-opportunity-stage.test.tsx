// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUpdateOpportunityStage } from "./use-update-opportunity-stage";
import { opportunitiesQueryKey, type OpportunityListItem } from "./use-opportunities";

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const seedOpportunities: OpportunityListItem[] = [
  {
    id: "o1",
    organizationId: "org1",
    creatorId: "creator1",
    leadId: "lead1",
    companyId: null,
    brandId: null,
    stage: "NOVO_LEAD",
    status: "OPEN",
    estimatedValueCents: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    companyName: null,
    brandName: null,
    contactName: "Maria",
  },
];

describe("useUpdateOpportunityStage", () => {
  it("optimistically moves the opportunity, then keeps the state on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const key = opportunitiesQueryKey("org1", "creator1");
    queryClient.setQueryData(key, seedOpportunities);

    const { result } = renderHook(() => useUpdateOpportunityStage("org1", "creator1"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ opportunityId: "o1", stage: "QUALIFICACAO" });

    // Optimistic: the cache reflects the new stage before the PATCH resolves.
    await waitFor(() => {
      const cached = queryClient.getQueryData<OpportunityListItem[]>(key);
      expect(cached?.[0]?.stage).toBe("QUALIFICACAO");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/opportunities/o1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      stage: "QUALIFICACAO",
    });
  });

  it("rolls back the cache and shows an error toast when the PATCH fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "Opportunity not found" }),
      }),
    );

    const queryClient = new QueryClient();
    const key = opportunitiesQueryKey("org1", "creator1");
    queryClient.setQueryData(key, seedOpportunities);

    const { result } = renderHook(() => useUpdateOpportunityStage("org1", "creator1"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ opportunityId: "o1", stage: "QUALIFICACAO" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<OpportunityListItem[]>(key);
    expect(cached?.[0]?.stage).toBe("NOVO_LEAD");
  });
});
