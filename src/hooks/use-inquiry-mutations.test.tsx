// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useConvertInquiry,
  useDiscardInquiry,
  useMarkFalsePositiveInquiry,
} from "./use-inquiry-mutations";
import { commercialInquiriesQueryKey } from "./use-commercial-inquiries";

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useDiscardInquiry", () => {
  it("POSTs to the discard endpoint and invalidates the inquiries list on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDiscardInquiry("org1", "creator1", "NEW"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate("inquiry1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/commercial-inquiries/inquiry1/discard");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ organizationId: "org1" });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: commercialInquiriesQueryKey("org1", "creator1", "NEW"),
    });
  });
});

describe("useMarkFalsePositiveInquiry", () => {
  it("POSTs to the mark-false-positive endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useMarkFalsePositiveInquiry("org1", "creator1", "NEW"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate("inquiry1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/commercial-inquiries/inquiry1/mark-false-positive");
  });
});

describe("useConvertInquiry", () => {
  it("POSTs contact/company/brand to the convert endpoint and surfaces an ApiError on 422", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: async () => ({ error: "Multiple companies match" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useConvertInquiry("org1", "creator1", "NEW"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ inquiryId: "inquiry1", contact: { fullName: "Maria" } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 422 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/commercial-inquiries/inquiry1/convert");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      contact: { fullName: "Maria" },
    });
  });
});
