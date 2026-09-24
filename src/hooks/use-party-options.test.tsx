// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCompanyOptions, useContactOptions } from "./use-party-options";

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useCompanyOptions", () => {
  it("maps companies into {id, label} options and requests the right URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "c1", organizationId: "org1", name: "Bella Cosméticos", createdAt: "2026-01-01" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCompanyOptions(), {
      wrapper: wrapper(new QueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "c1", label: "Bella Cosméticos" }]);

    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toBe("/api/companies");
    expect(requestedUrl).not.toContain("organizationId");
  });
});

describe("useContactOptions", () => {
  it("maps contacts into {id, label} options using fullName and requests the right URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: "ct1", organizationId: "org1", fullName: "Maria", email: null, phone: null, companyId: null, createdAt: "2026-01-01" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useContactOptions(), {
      wrapper: wrapper(new QueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "ct1", label: "Maria" }]);

    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toBe("/api/contacts");
    expect(requestedUrl).not.toContain("organizationId");
  });
});
