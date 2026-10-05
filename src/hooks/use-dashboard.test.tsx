// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDashboardActions, useDashboardMetrics } from "./use-dashboard";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("dashboard hooks", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetches metrics for the period", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: 1 }), { status: 200 })));
    const { result } = renderHook(() => useDashboardMetrics({ from: "2026-10-01", to: "2026-10-31" }), { wrapper: wrapper(new QueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual({ ok: 1 }));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/metrics?from=2026-10-01&to=2026-10-31", undefined);
  });

  it("fetches actions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ readyToSend: 2 }), { status: 200 })));
    const { result } = renderHook(() => useDashboardActions(), { wrapper: wrapper(new QueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual({ readyToSend: 2 }));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/actions", undefined);
  });
});
