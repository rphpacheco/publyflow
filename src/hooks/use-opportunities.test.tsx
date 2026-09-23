// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOpportunities } from "./use-opportunities";

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe({ organizationId, creatorId }: { organizationId: string; creatorId: string }) {
  const { data, isLoading } = useOpportunities(organizationId, creatorId);
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} opportunities</span>;
}

describe("useOpportunities", () => {
  it("fetches all opportunities for a creator (no stage filter) and requests the right URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "o1", stage: "NOVO_LEAD" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Probe organizationId="org1" creatorId="creator1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 opportunities")).toBeInTheDocument();

    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toContain("organizationId=org1");
    expect(requestedUrl).toContain("creatorId=creator1");
    expect(requestedUrl).not.toContain("stage=");
  });

  it("does not fetch when enabled is false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

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

function DisabledProbe() {
  useOpportunities("org1", "", { enabled: false });
  return <span>disabled</span>;
}
