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
  const { data, isLoading } = useProposal("p1");
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
        theme: "PREMIUM",
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
    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toBe("/api/proposals/p1");
    expect(requestedUrl).not.toContain("organizationId");
  });
});

function UpdateProbe() {
  const update = useUpdateProposal("p1");
  return <button onClick={() => update.mutate({ status: "ARCHIVED" })}>Arquivar</button>;
}

describe("useUpdateProposal", () => {
  it("PATCHes without organizationId/userId", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "p1",
        organizationId: "org1",
        opportunityId: "opp1",
        title: "Campanha Verão",
        theme: "PREMIUM",
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
    expect(url).not.toContain("organizationId");
    expect((init as RequestInit).method).toBe("PATCH");
    const parsedBody = JSON.parse((init as RequestInit).body as string);
    expect(parsedBody).toEqual({ status: "ARCHIVED" });
    expect(parsedBody).not.toHaveProperty("organizationId");
    expect(parsedBody).not.toHaveProperty("userId");
  });
});
