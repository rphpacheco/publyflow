// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import {
  proposalSendStateQueryKey,
  proposalPublicationsQueryKey,
  usePublishProposal,
  useProposalSendState,
  useRequestApproval,
  useApproveProposal,
  useRequestProposalChanges,
} from "./use-proposal-sending";
import { useUpdateProposal } from "./use-proposal";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrapperWith(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("proposal sending hooks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads send-state from the API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "DRAFT", publicPath: null, latestPublication: null, latestVersionNumber: 1, hasUnsentChanges: true, canSend: true })),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useProposalSendState("p1"), { wrapper: wrapperWith(client) });
    await waitFor(() => expect(result.current.data?.canSend).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/proposals/p1/send-state", undefined);
  });

  it("publishes with POST and withoutApproval:false by default, then invalidates send-state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ publication: { id: "pub1" }, publicPath: "/p/x", created: true }), { status: 201 }),
    );
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => usePublishProposal("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/proposals/p1/publications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ withoutApproval: false }),
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalSendStateQueryKey("p1") });
  });

  it("publishes with withoutApproval:true when requested", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ publication: { id: "pub1" }, publicPath: "/p/x", created: true }), { status: 201 }),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => usePublishProposal("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate({ withoutApproval: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/proposals/p1/publications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ withoutApproval: true }),
    });
  });

  it("shows the server message on a 409 publish error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Aguardando aprovação do creator.", code: "APPROVAL_REQUIRED" }), { status: 409 }),
    );
    const toastMod = await import("sonner");
    const client = new QueryClient();
    const { result } = renderHook(() => usePublishProposal("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastMod.toast.error).toHaveBeenCalledWith("Aguardando aprovação do creator.");
  });

  it("invalidates send-state and publications even when publish fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "PROPOSAL_ARCHIVED" }), { status: 409 }),
    );
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => usePublishProposal("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalSendStateQueryKey("p1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalPublicationsQueryKey("p1") });
  });

  it("content mutations invalidate send-state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "p1", title: "T" })));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateProposal("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate({ title: "T" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalSendStateQueryKey("p1") });
  });

  it("useRequestApproval posts to /approval and toasts on success", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ approval: { id: "a1" } }), { status: 201 }));
    const toastMod = await import("sonner");
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRequestApproval("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/proposals/p1/approval", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(toastMod.toast.success).toHaveBeenCalledWith("Pedido de aprovação enviado.");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalSendStateQueryKey("p1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proposalPublicationsQueryKey("p1") });
  });

  it("useApproveProposal posts to /approval/approve with an optional message and toasts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ approval: { id: "a1" } })));
    const toastMod = await import("sonner");
    const client = new QueryClient();
    const { result } = renderHook(() => useApproveProposal("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate({ approvalId: "a1", message: "Ótimo" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/proposals/p1/approval/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId: "a1", message: "Ótimo" }),
    });
    expect(toastMod.toast.success).toHaveBeenCalledWith("Proposta aprovada.");
  });

  it("useRequestProposalChanges posts to /approval/request-changes and toasts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ approval: { id: "a1" } })));
    const toastMod = await import("sonner");
    const client = new QueryClient();
    const { result } = renderHook(() => useRequestProposalChanges("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate({ approvalId: "a1", message: "Trocar a capa" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/proposals/p1/approval/request-changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId: "a1", message: "Trocar a capa" }),
    });
    expect(toastMod.toast.success).toHaveBeenCalledWith("Pedido de ajustes enviado.");
  });

  it("shows the server 400 message when request-changes validation fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: { message: ["Descreva os ajustes."] } }), { status: 400 }),
    );
    const toastMod = await import("sonner");
    const client = new QueryClient();
    const { result } = renderHook(() => useRequestProposalChanges("p1"), { wrapper: wrapperWith(client) });

    result.current.mutate({ approvalId: "a1", message: "" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastMod.toast.error).toHaveBeenCalledWith("Descreva os ajustes.");
  });
});
