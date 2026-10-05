// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PeriodPicker } from "./period-picker";
import { resolvePreset } from "@/lib/dashboard/period";

const now = new Date("2026-10-05T15:00:00Z");

describe("PeriodPicker", () => {
  it("applies a preset", () => {
    const onChange = vi.fn();
    render(<PeriodPicker period={resolvePreset("this_month", now)} onChange={onChange} now={now} />);
    fireEvent.click(screen.getByRole("button", { name: "Mês passado" }));
    expect(onChange).toHaveBeenCalledWith(resolvePreset("last_month", now));
  });
  it("marks the active preset", () => {
    render(<PeriodPicker period={resolvePreset("this_month", now)} onChange={vi.fn()} now={now} />);
    expect(screen.getByRole("button", { name: "Este mês" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Mês passado" }).getAttribute("aria-pressed")).toBe("false");
  });
  it("rejects an inverted custom range", () => {
    const onChange = vi.fn();
    render(<PeriodPicker period={resolvePreset("this_month", now)} onChange={onChange} now={now} />);
    fireEvent.click(screen.getByRole("button", { name: /De\/até/ }));
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(screen.getByText("A data final deve ser igual ou posterior à inicial.")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("applies a valid custom range", () => {
    const onChange = vi.fn();
    render(<PeriodPicker period={resolvePreset("this_month", now)} onChange={onChange} now={now} />);
    fireEvent.click(screen.getByRole("button", { name: /De\/até/ }));
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-20" });
  });
});
