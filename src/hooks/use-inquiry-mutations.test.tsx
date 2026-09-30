// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useConvertInquiry,
  useDiscardInquiry,
  useMarkFalsePositiveInquiry,
  useUpdateInquiryGuesses,
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
  it("POSTs to the discard endpoint with no body and invalidates the inquiries list on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDiscardInquiry("creator1", "NEW"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate("inquiry1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/commercial-inquiries/inquiry1/discard");
    expect(url).not.toContain("organizationId");
    expect((init as RequestInit).body).toBeUndefined();
    expect((init as RequestInit).headers).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: commercialInquiriesQueryKey("creator1", "NEW"),
    });
  });
});

describe("useMarkFalsePositiveInquiry", () => {
  it("POSTs to the mark-false-positive endpoint with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useMarkFalsePositiveInquiry("creator1", "NEW"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate("inquiry1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/commercial-inquiries/inquiry1/mark-false-positive");
    expect(url).not.toContain("organizationId");
    expect((init as RequestInit).body).toBeUndefined();
  });
});

describe("useConvertInquiry", () => {
  it("POSTs contact/company/brand (no organizationId) to the convert endpoint and surfaces an ApiError on 422", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: async () => ({ error: "Multiple companies match" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useConvertInquiry("creator1", "NEW"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ inquiryId: "inquiry1", contact: { fullName: "Maria" } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 422 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/commercial-inquiries/inquiry1/convert");
    expect(url).not.toContain("organizationId");
    const parsedBody = JSON.parse((init as RequestInit).body as string);
    expect(parsedBody).toEqual({
      contact: { fullName: "Maria" },
    });
    expect(parsedBody).not.toHaveProperty("organizationId");
    expect(parsedBody).not.toHaveProperty("userId");
  });
});

describe("useUpdateInquiryGuesses", () => {
  it("PATCHes the fields (no inquiryId in the body) and invalidates the inquiries list on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "inquiry1", companyGuess: "Barbosa Moda" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateInquiryGuesses("creator1", "NEW"), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({
      inquiryId: "inquiry1",
      contactName: "Maria",
      companyName: "Barbosa Moda",
      brandName: null,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/commercial-inquiries/inquiry1");
    expect((init as RequestInit).method).toBe("PATCH");
    const parsedBody = JSON.parse((init as RequestInit).body as string);
    expect(parsedBody).toEqual({
      contactName: "Maria",
      companyName: "Barbosa Moda",
      brandName: null,
    });
    expect(parsedBody).not.toHaveProperty("inquiryId");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: commercialInquiriesQueryKey("creator1", "NEW"),
    });
  });
});
