// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toaster } from "sonner";
import { toast } from "sonner";

describe("Toaster", () => {
  it("renders a toast message when toast() is called", async () => {
    render(<Toaster />);
    toast("Convertida em Opportunity");

    expect(await screen.findByText("Convertida em Opportunity")).toBeInTheDocument();
  });
});
