// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { crmQueryKey } from "./use-crm";
import {
  useCompanyMergePreview,
  useContactMergePreview,
  useMergeCompany,
  useMergeContact,
  useRemoveCompanyAlias,
} from "./use-crm-merge";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("crm merge hooks", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("does not fetch the company preview until a target is chosen", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({}));
    const client = new QueryClient();
    const { result, rerender } = renderHook(({ into }: { into: string | null }) => useCompanyMergePreview("d1", into), {
      wrapper: wrapper(client),
      initialProps: { into: null as string | null },
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ into: "s1" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/companies/d1/merge-preview?into=s1", undefined));
    expect(client.getQueryData(["crm", "merge-preview", "company", "d1", "s1"])).toEqual({});
  });

  it("loads the contact preview with its own key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ impact: { leads: 1 } }));
    const client = new QueryClient();
    renderHook(() => useContactMergePreview("d1", "s1"), { wrapper: wrapper(client) });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/contacts/d1/merge-preview?into=s1", undefined));
    expect(client.getQueryData(["crm", "merge-preview", "contact", "d1", "s1"])).toEqual({ impact: { leads: 1 } });
  });

  it("merges companies by POST and invalidates crm + option keys", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: "s1", name: "Bella" }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMergeCompany("d1"), { wrapper: wrapper(client) });
    await expect(result.current.mutateAsync({ into: "s1" })).resolves.toEqual({ id: "s1", name: "Bella" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/companies/d1/merge");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ into: "s1" });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: crmQueryKey });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["company-options"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["brand-options"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["contact-options"] });
    });
  });

  it("removes the deleted record's detail query after a merge (company and contact)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok({ id: "s1" }));
    const client = new QueryClient();
    client.setQueryData([...crmQueryKey, "company", "d1"], { id: "d1" });
    client.setQueryData([...crmQueryKey, "contact", "d1"], { id: "d1" });
    client.setQueryData([...crmQueryKey, "company", "s1"], { id: "s1" });
    const company = renderHook(() => useMergeCompany("d1"), { wrapper: wrapper(client) });
    await company.result.current.mutateAsync({ into: "s1" });
    const contact = renderHook(() => useMergeContact("d1"), { wrapper: wrapper(client) });
    await contact.result.current.mutateAsync({ into: "s1" });
    expect(client.getQueryData([...crmQueryKey, "company", "d1"])).toBeUndefined();
    expect(client.getQueryData([...crmQueryKey, "contact", "d1"])).toBeUndefined();
    expect(client.getQueryData([...crmQueryKey, "company", "s1"])).toEqual({ id: "s1" });
  });

  it("merges contacts by POST", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: "s1" }));
    const { result } = renderHook(() => useMergeContact("d1"), { wrapper: wrapper(new QueryClient()) });
    await result.current.mutateAsync({ into: "s1" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/contacts/d1/merge");
  });

  it("removes an alias by DELETE (204) and invalidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRemoveCompanyAlias("c1"), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ aliasId: "a1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/companies/c1/aliases/a1");
    expect(init?.method).toBe("DELETE");
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: crmQueryKey }));
  });
});
