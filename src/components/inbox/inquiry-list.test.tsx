// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import { InquiryList } from "./inquiry-list";

const inquiries: CommercialInquiryListItem[] = [
  {
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
    messageBody: "Olá, gostaríamos de saber os valores para uma campanha de verão.",
    messageReceivedAt: "2026-01-01T12:00:00.000Z",
    externalContactLabel: "Maria — Bella Cosméticos",
    source: "INSTAGRAM",
    conversationId: "conv1",
  },
];

describe("InquiryList", () => {
  it("renders one row per inquiry and calls onSelect when a row is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<InquiryList inquiries={inquiries} selectedId={null} onSelect={onSelect} />);

    expect(screen.getByText("Maria — Bella Cosméticos")).toBeInTheDocument();
    expect(screen.getByText("Bella Cosméticos")).toBeInTheDocument();

    await user.click(screen.getByText("Maria — Bella Cosméticos"));
    expect(onSelect).toHaveBeenCalledWith(inquiries[0]);
  });
});
