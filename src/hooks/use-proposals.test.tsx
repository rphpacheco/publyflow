// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProposals, useCreateProposal } from "./use-proposals";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ListProbe({ organizationId, opportunityId }: { organizationId: string; opportunityId: string }) {
  const { data, isLoading } = useProposals(organizationId, opportunityId);
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} proposals</span>;
}

describe("useProposals", () => {
  it("fetches proposals for an opportunity", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "p1", title: "Campanha Verão", status: "DRAFT" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ListProbe organizationId="org1" opportunityId="opp1" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 proposals")).toBeInTheDocument();

    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toContain("organizationId=org1");
    expect(requestedUrl).toContain("opportunityId=opp1");
  });
});

function CreateProbe() {
  const create = useCreateProposal("org1", "user1");
  return (
    <button
      onClick={() =>
        create.mutate({ opportunityId: "opp1", title: "Campanha Verão", template: "PREMIUM" })
      }
    >
      Criar
    </button>
  );
}

describe("useCreateProposal", () => {
  it("POSTs the new proposal with organizationId/userId injected", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: "p1",
        organizationId: "org1",
        opportunityId: "opp1",
        title: "Campanha Verão",
        template: "PREMIUM",
        status: "DRAFT",
        createdAt: new Date().toISOString(),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <CreateProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposals");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      opportunityId: "opp1",
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: "user1",
    });
  });
});
