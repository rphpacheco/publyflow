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
  it("maps companies into {id, label} options", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ id: "c1", organizationId: "org1", name: "Bella Cosméticos", createdAt: "2026-01-01" }],
      }),
    );

    const { result } = renderHook(() => useCompanyOptions("org1"), {
      wrapper: wrapper(new QueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "c1", label: "Bella Cosméticos" }]);
  });
});

describe("useContactOptions", () => {
  it("maps contacts into {id, label} options using fullName", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { id: "ct1", organizationId: "org1", fullName: "Maria", email: null, phone: null, companyId: null, createdAt: "2026-01-01" },
        ],
      }),
    );

    const { result } = renderHook(() => useContactOptions("org1"), {
      wrapper: wrapper(new QueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "ct1", label: "Maria" }]);
  });
});
