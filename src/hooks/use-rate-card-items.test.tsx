// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRateCardItems } from "./use-rate-card-items";

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe() {
  const { data, isLoading } = useRateCardItems("creator1");
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} items</span>;
}

describe("useRateCardItems", () => {
  it("fetches catalog items for a creator", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: "rci1",
          organizationId: "org1",
          rateCardId: "rc1",
          serviceId: "s1",
          price: 250000,
          unitDescription: "por post",
          sortOrder: 0,
          createdAt: new Date().toISOString(),
          serviceName: "Reel patrocinado",
          rateCardName: "Tabela Padrão",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 items")).toBeInTheDocument();
    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toBe("/api/rate-card-items?creatorId=creator1");
    expect(requestedUrl).not.toContain("organizationId");
  });
});
