// src/hooks/use-proposal.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProposal, useUpdateProposal } from "./use-proposal";

afterEach(() => {
  vi.unstubAllGlobals();
});

function GetProbe() {
  const { data, isLoading } = useProposal("org1", "p1");
  if (isLoading) return <span>loading</span>;
  return <span>{data?.title}</span>;
}

describe("useProposal", () => {
  it("fetches a single proposal by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
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
        <GetProbe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Campanha Verão")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proposals/p1?organizationId=org1");
  });
});

function UpdateProbe() {
  const update = useUpdateProposal("org1", "p1", "user1");
  return <button onClick={() => update.mutate({ status: "ARCHIVED" })}>Arquivar</button>;
}

describe("useUpdateProposal", () => {
  it("PATCHes with organizationId/userId injected", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "p1",
        organizationId: "org1",
        opportunityId: "opp1",
        title: "Campanha Verão",
        template: "PREMIUM",
        status: "ARCHIVED",
        createdAt: new Date().toISOString(),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <UpdateProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposals/p1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      userId: "user1",
      status: "ARCHIVED",
    });
  });
});
