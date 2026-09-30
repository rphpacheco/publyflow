// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  creatorsQueryKey,
  useCreateCreator,
  useCreators,
  useInviteCreator,
  useRemindCreatorAccess,
  useRevokeCreatorAccess,
  useUpdateCreator,
} from "./use-creators";

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("creator hooks", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists creators", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{ id: "c1", displayName: "Thais" }]), { status: 200 }));
    const client = new QueryClient();
    const { result } = renderHook(() => useCreators(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: "c1", displayName: "Thais" }]));
  });

  it("creates and invalidates the list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "c1" }), { status: 201 }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateCreator(), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ fullName: "Thais", displayName: "Thais", instagramHandle: "", email: "t@x.com" });
    expect(fetchMock).toHaveBeenCalledWith("/api/creators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: "Thais", displayName: "Thais", instagramHandle: "", email: "t@x.com" }),
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: creatorsQueryKey }));
  });

  it("updates by id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "c1" }), { status: 200 }));
    const client = new QueryClient();
    const { result } = renderHook(() => useUpdateCreator("c1"), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ displayName: "T", instagramHandle: "" });
    expect(fetchMock).toHaveBeenCalledWith("/api/creators/c1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "T", instagramHandle: "" }),
    });
  });

  it("updates by id including an optional email", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "c1" }), { status: 200 }));
    const client = new QueryClient();
    const { result } = renderHook(() => useUpdateCreator("c1"), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ displayName: "T", instagramHandle: "", email: "t@x.com" });
    expect(fetchMock).toHaveBeenCalledWith("/api/creators/c1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "T", instagramHandle: "", email: "t@x.com" }),
    });
  });

  it("invites creator access and invalidates the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ loginUrl: "http://x/login", message: "msg" }), { status: 200 }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useInviteCreator(), { wrapper: wrapper(client) });
    const data = await result.current.mutateAsync({ creatorId: "c1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/creators/c1/access", { method: "POST" });
    expect(data).toEqual({ loginUrl: "http://x/login", message: "msg" });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: creatorsQueryKey }));
  });

  it("revokes creator access and invalidates the list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRevokeCreatorAccess(), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ creatorId: "c1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/creators/c1/access", { method: "DELETE" });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: creatorsQueryKey }));
  });

  it("reminds creator access and invalidates the list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ loginUrl: "http://x/login", message: "msg" }), { status: 200 }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRemindCreatorAccess(), { wrapper: wrapper(client) });
    const data = await result.current.mutateAsync({ creatorId: "c1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/creators/c1/access/remind", { method: "POST" });
    expect(data).toEqual({ loginUrl: "http://x/login", message: "msg" });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: creatorsQueryKey }));
  });
});
