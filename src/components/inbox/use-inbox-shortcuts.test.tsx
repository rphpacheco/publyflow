// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import { useInboxShortcuts } from "./use-inbox-shortcuts";

const inquiries: CommercialInquiryListItem[] = [];

function Harness(props: {
  onSelect: () => void;
  onConvert: () => void;
  onDiscard: () => void;
  onMarkFalsePositive: () => void;
  onClose: () => void;
}) {
  useInboxShortcuts({
    inquiries,
    selectedId: "i1",
    onSelect: props.onSelect,
    onConvert: props.onConvert,
    onDiscard: props.onDiscard,
    onMarkFalsePositive: props.onMarkFalsePositive,
    onClose: props.onClose,
  });
  return <input aria-label="Empresa" />;
}

describe("useInboxShortcuts", () => {
  it("ignores single-letter shortcut keys typed into an input element", async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn();
    const onDiscard = vi.fn();
    const onMarkFalsePositive = vi.fn();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <Harness
        onSelect={onSelect}
        onConvert={onConvert}
        onDiscard={onDiscard}
        onMarkFalsePositive={onMarkFalsePositive}
        onClose={onClose}
      />,
    );

    const input = screen.getByLabelText("Empresa");
    await user.click(input);
    await user.type(input, "cdfjk");

    expect(onConvert).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onMarkFalsePositive).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still fires shortcuts when the target is not an editable element", () => {
    const onConvert = vi.fn();
    renderHook(() =>
      useInboxShortcuts({
        inquiries,
        selectedId: "i1",
        onSelect: vi.fn(),
        onConvert,
        onDiscard: vi.fn(),
        onMarkFalsePositive: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));

    expect(onConvert).toHaveBeenCalledTimes(1);
  });
});
