// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({ requestPasswordReset: vi.fn() }));

import ForgotPasswordPage from "./page";

async function renderPage(searchParams: { expired?: string }) {
  render(await ForgotPasswordPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("ForgotPasswordPage", () => {
  it("shows the expired notice only with expired=1", async () => {
    await renderPage({ expired: "1" });
    expect(screen.getByRole("status")).toHaveTextContent("Este link expirou ou já foi usado. Peça um novo link.");
    expect(screen.getByRole("status")).toHaveTextContent("Se o link já foi aberto (por exemplo, por um verificador de e-mail), peça um novo.");
  });

  it("shows no notice otherwise", async () => {
    await renderPage({});
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
