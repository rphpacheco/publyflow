// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSendInboxMessage } from "./use-send-inbox-message";

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useSendInboxMessage", () => {
  it("POSTs the message payload to /api/inbox/messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ conversation: {}, message: {}, inquiry: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSendInboxMessage(), {
      wrapper: wrapper(new QueryClient()),
    });

    result.current.mutate({
      organizationId: "org1",
      creatorId: "creator1",
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores.",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/inbox/messages");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      creatorId: "creator1",
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores.",
    });
  });
});
