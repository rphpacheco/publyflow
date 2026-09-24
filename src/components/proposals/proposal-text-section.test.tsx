// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProposalTextSection } from "./proposal-text-section";
import type { ProposalBlock } from "@/hooks/use-proposal-blocks";

afterEach(() => {
  vi.unstubAllGlobals();
});

const block: ProposalBlock = {
  id: "b2",
  organizationId: "org1",
  proposalId: "p1",
  blockType: "TEXT",
  content: { body: "Texto original" },
  sortOrder: 1,
  createdAt: new Date().toISOString(),
};

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ProposalTextSection", () => {
  it("shows the current body and saves on blur when changed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...block, content: { body: "Texto novo" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(<ProposalTextSection proposalId="p1" block={block} readOnly={false} />);

    const textarea = screen.getByLabelText("Texto");
    expect(textarea).toHaveValue("Texto original");

    await user.clear(textarea);
    await user.type(textarea, "Texto novo");
    await user.tab();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposal-blocks/b2");
    expect(url).not.toContain("organizationId");
    const parsedBody = JSON.parse((init as RequestInit).body as string);
    expect(parsedBody).toEqual({
      proposalId: "p1",
      content: { body: "Texto novo" },
    });
    expect(parsedBody).not.toHaveProperty("organizationId");
    expect(parsedBody).not.toHaveProperty("userId");
  });

  it("disables the textarea when readOnly", () => {
    renderWithClient(<ProposalTextSection proposalId="p1" block={block} readOnly />);
    expect(screen.getByLabelText("Texto")).toBeDisabled();
  });
});
