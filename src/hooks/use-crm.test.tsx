// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { crmQueryKey, useCompanies, useCompany, useContact, useUpdateBrand, useUpdateCompany, useUpdateContact } from "./use-crm";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("crm hooks", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists companies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok([{ id: "c1", name: "Bella" }]));
    const { result } = renderHook(() => useCompanies(), { wrapper: wrapper(new QueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual([{ id: "c1", name: "Bella" }]));
  });

  it("loads details by id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ company: { id: "c1" } }));
    const client = new QueryClient();
    renderHook(() => useCompany("c1"), { wrapper: wrapper(client) });
    renderHook(() => useContact("p1"), { wrapper: wrapper(client) });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/companies/c1", undefined);
      expect(fetchMock).toHaveBeenCalledWith("/api/contacts/p1", undefined);
    });
  });

  it("updates a company and invalidates crm + inbox option keys", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: "c1", name: "Nova" }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateCompany("c1"), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ name: "Nova" });
    expect(fetchMock).toHaveBeenCalledWith("/api/companies/c1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nova" }),
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: crmQueryKey });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["company-options"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["brand-options"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["contact-options"] });
    });
  });

  it("PATCHes contacts and brands by id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(ok({ id: "x" })));
    const client = new QueryClient();
    const contact = renderHook(() => useUpdateContact("p1"), { wrapper: wrapper(client) });
    await contact.result.current.mutateAsync({ fullName: "Maria", email: "", phone: "", instagramHandle: "", companyId: null });
    const brand = renderHook(() => useUpdateBrand("b1"), { wrapper: wrapper(client) });
    await brand.result.current.mutateAsync({ name: "Linha", companyId: "c1" });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/contacts/p1", "/api/brands/b1"]);
  });
});
