// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect:${url}`);
  }
}

async function loadPage(getAuthState: () => Promise<unknown>) {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  }));
  vi.doMock("@/lib/auth/session", () => ({ getAuthState }));
  vi.doMock("./login-form", () => ({ LoginForm: () => <div data-testid="login-form" /> }));
  const { default: LoginPage } = await import("./page");
  const { AuthUnavailableError } = await import("@/lib/auth/errors");
  return { LoginPage, AuthUnavailableError };
}

describe("/login page", () => {
  it("redirects members to /pipeline", async () => {
    const { LoginPage } = await loadPage(async () => ({
      status: "member",
      session: { userId: "u", organizationId: "o", role: "OWNER", creatorId: null },
    }));
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ url: "/pipeline" });
  });

  it("shows a no-access notice with sign-out and the form", async () => {
    const { LoginPage } = await loadPage(async () => ({ status: "no-access", email: "ana@publyflow.test" }));
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByText(
        "Você está conectado como ana@publyflow.test, mas essa conta não tem acesso ao PublyFlow.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair e entrar com outra conta" })).toBeInTheDocument();
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
  });

  it("renders only the form for anonymous visitors", async () => {
    const { LoginPage } = await loadPage(async () => ({ status: "anonymous" }));
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders the unavailable state when the provider is down", async () => {
    const { LoginPage, AuthUnavailableError } = await loadPage(async () => {
      throw new AuthUnavailableError();
    });
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível verificar sua sessão agora.");
    expect(screen.queryByTestId("login-form")).toBeNull();
  });
});
