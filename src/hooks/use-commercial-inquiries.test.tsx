// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCommercialInquiries } from "./use-commercial-inquiries";

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe({ organizationId, creatorId, status }: { organizationId: string; creatorId: string; status: "NEW" }) {
  const { data, isLoading } = useCommercialInquiries(organizationId, creatorId, status);
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} inquiries</span>;
}

describe("useCommercialInquiries", () => {
  it("fetches the list for the given organization/creator/status and requests the right URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "i1", messageBody: "Olá" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Probe organizationId="org1" creatorId="creator1" status="NEW" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 inquiries")).toBeInTheDocument();

    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toContain("organizationId=org1");
    expect(requestedUrl).toContain("creatorId=creator1");
    expect(requestedUrl).toContain("status=NEW");
  });

  it("does not fetch when enabled is false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    function DisabledProbe() {
      const { isLoading } = useCommercialInquiries("org1", "", "NEW", { enabled: false });
      return <span>{isLoading ? "loading" : "idle"}</span>;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <DisabledProbe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("idle")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
