// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Creator } from "@/repositories/creators.repository";
import { CreatorProvider } from "@/components/shell/creator-context";
import InboxPage from "./page";

const creators: Creator[] = [
  {
    id: "creator1",
    organizationId: "org1",
    userId: "u1",
    displayName: "Thais Miranda",
    instagramHandle: null,
    createdAt: new Date("2026-01-01"),
  },
];

const newInquiry = {
  id: "i1",
  organizationId: "org1",
  creatorId: "creator1",
  messageId: "m1",
  status: "NEW",
  companyGuess: "Bella Cosméticos",
  brandGuess: null,
  contactNameGuess: "Maria",
  budgetGuess: null,
  intentGuess: "Pedido de mídia kit",
  convertedLeadId: null,
  linkedOpportunityId: null,
  createdAt: "2026-01-01T12:00:00.000Z",
  messageBody: "Olá, gostaríamos de saber os valores.",
  messageReceivedAt: "2026-01-01T12:00:00.000Z",
  externalContactLabel: "Maria — Bella Cosméticos",
  source: "INSTAGRAM",
  conversationId: "conv1",
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderInboxPage() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <CreatorProvider organizationId="org1" creators={creators}>
        <InboxPage />
      </CreatorProvider>
    </QueryClientProvider>,
  );
}

describe("InboxPage", () => {
  it("clears the selected inquiry and closes the side panel when switching tabs", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("status=NEW")) {
          return Promise.resolve({ ok: true, status: 200, json: async () => [newInquiry] });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }),
    );

    renderInboxPage();

    const inquiryRow = await screen.findByText("Maria — Bella Cosméticos");
    await user.click(inquiryRow);

    expect(await screen.findByRole("button", { name: "Converter em Opportunity" })).toBeInTheDocument();

    // The open Sheet marks background siblings aria-hidden (Radix modal
    // behavior), so the tab button must be queried with hidden: true here;
    // fireEvent bypasses userEvent's pointer-events visibility check that
    // would otherwise refuse the click on a currently-obscured element.
    const convertedTab = screen.getByRole("button", { name: "Convertidas", hidden: true });
    fireEvent.click(convertedTab);

    expect(screen.queryByRole("button", { name: "Converter em Opportunity" })).not.toBeInTheDocument();
  });
});
