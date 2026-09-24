// src/hooks/use-opportunity.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOpportunity } from "./use-opportunity";

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe() {
  const { data, isLoading } = useOpportunity("org1", "opp1");
  if (isLoading) return <span>loading</span>;
  return <span>{data?.creatorId}</span>;
}

describe("useOpportunity", () => {
  it("fetches a single opportunity by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "opp1",
        organizationId: "org1",
        creatorId: "creator1",
        leadId: "lead1",
        companyId: null,
        brandId: null,
        stage: "NOVO_LEAD",
        status: "OPEN",
        estimatedValueCents: null,
        createdAt: new Date().toISOString(),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("creator1")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/opportunities/opp1?organizationId=org1");
  });

  it("does not fetch when disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    function DisabledProbe() {
      useOpportunity("org1", "", { enabled: false });
      return <span>disabled</span>;
    }

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <DisabledProbe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("disabled")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
