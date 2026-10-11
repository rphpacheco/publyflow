// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { teamQueryKey, useInviteManager, useRemindManager, useRemoveManager, useTeam } from "./use-team";

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("team hooks", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists the team", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{ id: "u1" }]), { status: 200 }));
    const { result } = renderHook(() => useTeam(), { wrapper: wrapper(new QueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: "u1" }]));
  });

  it("invites a manager and invalidates the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ member: { id: "u1" }, loginUrl: "l", message: "m" }), { status: 201 }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useInviteManager(), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ fullName: "Ana", email: "a@x.com" });
    expect(fetchMock).toHaveBeenCalledWith("/api/team/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: "Ana", email: "a@x.com" }),
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: teamQueryKey }));
  });

  it("reminds a manager", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ loginUrl: "l", message: "m" }), { status: 200 }));
    const { result } = renderHook(() => useRemindManager(), { wrapper: wrapper(new QueryClient()) });
    await expect(result.current.mutateAsync({ memberId: "u1" })).resolves.toEqual({ loginUrl: "l", message: "m" });
    expect(fetchMock).toHaveBeenCalledWith("/api/team/members/u1/remind", { method: "POST" });
  });

  it("removes a manager (204) and invalidates the list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRemoveManager(), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ memberId: "u1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/team/members/u1", { method: "DELETE" });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: teamQueryKey }));
  });
});
