// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import { useInboxShortcuts } from "./use-inbox-shortcuts";

function makeInquiry(id: string): CommercialInquiryListItem {
  return {
    id,
    organizationId: "org1",
    creatorId: "creator1",
    messageId: `m-${id}`,
    status: "NEW",
    companyGuess: null,
    brandGuess: null,
    contactNameGuess: null,
    budgetGuess: null,
    intentGuess: null,
    convertedLeadId: null,
    linkedOpportunityId: null,
    createdAt: "2026-01-01T12:00:00.000Z",
    messageBody: "msg",
    messageReceivedAt: "2026-01-01T12:00:00.000Z",
    externalContactLabel: `Contact ${id}`,
    source: "INSTAGRAM",
    conversationId: `conv-${id}`,
  };
}

const inquiries = [makeInquiry("i1"), makeInquiry("i2"), makeInquiry("i3")];

describe("useInboxShortcuts", () => {
  it("moves selection down/up with j/k and fires actions with C/D/F", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onConvert = vi.fn();
    const onDiscard = vi.fn();
    const onMarkFalsePositive = vi.fn();
    const onClose = vi.fn();

    renderHook(() =>
      useInboxShortcuts({
        inquiries,
        selectedId: "i1",
        onSelect,
        onConvert,
        onDiscard,
        onMarkFalsePositive,
        onClose,
      }),
    );

    await user.keyboard("j");
    expect(onSelect).toHaveBeenCalledWith(inquiries[1]);

    await user.keyboard("c");
    expect(onConvert).toHaveBeenCalledTimes(1);

    await user.keyboard("d");
    expect(onDiscard).toHaveBeenCalledTimes(1);

    await user.keyboard("f");
    expect(onMarkFalsePositive).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not fire C/D/F/j/k/Escape while focus is inside an input (F8: lets the input handle Escape itself)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onConvert = vi.fn();
    const onClose = vi.fn();

    document.body.innerHTML = '<input id="probe" />';
    const input = document.getElementById("probe")!;
    input.focus();

    renderHook(() =>
      useInboxShortcuts({
        inquiries,
        selectedId: "i1",
        onSelect,
        onConvert,
        onDiscard: vi.fn(),
        onMarkFalsePositive: vi.fn(),
        onClose,
      }),
    );

    await user.keyboard("c");
    expect(onConvert).not.toHaveBeenCalled();

    await user.keyboard("j");
    expect(onSelect).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    input.blur();
    document.body.focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
