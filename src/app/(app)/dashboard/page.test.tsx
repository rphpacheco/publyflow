// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const replace = vi.fn();
let search = "";
let isCreator = false;
const metricsRefetch = vi.fn();
const actionsRefetch = vi.fn();
const metricsHook = vi.fn();
let metricsState: Record<string, unknown> = {};
let actionsState: Record<string, unknown> = {};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/components/shell/session-role-context", () => ({ useIsCreator: () => isCreator }));
vi.mock("@/hooks/use-dashboard", () => ({
  useDashboardMetrics: (period: unknown) => {
    metricsHook(period);
    return metricsState;
  },
  useDashboardActions: () => actionsState,
}));
vi.mock("@/components/dashboard/won-chart", () => ({ WonChart: () => <div data-testid="won-chart" /> }));

import DashboardPage from "./page";
import { resolvePreset } from "@/lib/dashboard/period";
import { formatCurrencyBRL } from "@/lib/format";

// Testing Library normalizes NBSP in node text; normalize the expected string too.
const brl = (cents: number) => formatCurrencyBRL(cents).replace(/\s/g, " ");

const base = {
  inquiriesReceived: 10, inquiriesConverted: 4, conversionRate: 0.4,
  opportunitiesCreated: 6, wonCount: 3, wonCents: 1_500_000, lostCount: 2,
  winRate: 0.6, averageTicketCents: 500_000, averageDaysToClose: 18.4,
};
const metricsData = {
  period: { from: "2026-10-01", to: "2026-10-31" },
  previousPeriod: { from: "2026-09-01", to: "2026-09-30" },
  current: base,
  previous: { ...base, wonCents: 1_000_000, wonCount: 2 },
  series: { bucket: "day", points: [] },
  openNow: { count: 5, valueCents: 900_000 },
  funnel: [],
  creators: [],
};
const actionsData = {
  untriagedInquiries: 2, clientChangesRequested: 0, creatorChangesRequested: 0,
  awaitingCreatorApproval: 0, readyToSend: 1, awaitingClient: 0,
};

describe("DashboardPage", () => {
  beforeEach(() => {
    search = "";
    isCreator = false;
    replace.mockReset();
    metricsHook.mockReset();
    metricsRefetch.mockReset();
    actionsRefetch.mockReset();
    metricsState = { data: metricsData, isLoading: false, isError: false, refetch: metricsRefetch };
    actionsState = { data: actionsData, isLoading: false, isError: false, refetch: actionsRefetch };
  });

  it("defaults to this month without params", () => {
    render(<DashboardPage />);
    expect(metricsHook).toHaveBeenCalledWith(resolvePreset("this_month", new Date()));
  });

  it("uses correct Portuguese plurals in the win-rate context", () => {
    const { unmount } = render(<DashboardPage />);
    expect(screen.getByText("3 ganhas · 2 perdidas")).toBeTruthy();
    unmount();
    metricsState = { ...metricsState, data: { ...metricsData, current: { ...base, wonCount: 1, lostCount: 1 } } };
    render(<DashboardPage />);
    expect(screen.getByText("1 ganha · 1 perdida")).toBeTruthy();
  });

  it("uses the period from the query and falls back on an invalid one", () => {
    search = "from=2026-09-01&to=2026-09-30";
    const { unmount } = render(<DashboardPage />);
    expect(metricsHook).toHaveBeenLastCalledWith({ from: "2026-09-01", to: "2026-09-30" });
    unmount();
    search = "from=x";
    render(<DashboardPage />);
    expect(metricsHook).toHaveBeenLastCalledWith(resolvePreset("this_month", new Date()));
  });

  it("updates the URL when a preset is picked", () => {
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: "Mês passado" }));
    const { from, to } = resolvePreset("last_month", new Date());
    expect(replace).toHaveBeenCalledWith(`/dashboard?from=${from}&to=${to}`);
  });

  it("renders the 8 KPI cards with values", () => {
    render(<DashboardPage />);
    for (const label of ["Fechado", "Taxa de fechamento", "Ticket médio", "Tempo até fechar", "Mensagens recebidas", "Conversão Inbox para oportunidade", "Oportunidades criadas", "Perdidas"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(brl(1_500_000))).toBeTruthy();
    expect(screen.getByText("3 oportunidades")).toBeTruthy();
    expect(screen.getByText("18,4 dias")).toBeTruthy();
    expect(screen.getByTestId("won-chart")).toBeTruthy();
  });

  it("isolates an actions error to the right column", () => {
    actionsState = { data: undefined, isLoading: false, isError: true, refetch: actionsRefetch };
    render(<DashboardPage />);
    expect(screen.getByText("Não foi possível carregar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(actionsRefetch).toHaveBeenCalledTimes(1);
    expect(metricsRefetch).not.toHaveBeenCalled();
    expect(screen.getByText(brl(1_500_000))).toBeTruthy();
  });

  it("isolates a metrics error to the left column", () => {
    metricsState = { data: undefined, isLoading: false, isError: true, refetch: metricsRefetch };
    render(<DashboardPage />);
    expect(screen.getByText("Não foi possível carregar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(metricsRefetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Requer ação")).toBeTruthy();
  });

  it("redirects a creator to the pipeline and renders nothing", () => {
    isCreator = true;
    const { container } = render(<DashboardPage />);
    expect(replace).toHaveBeenCalledWith("/pipeline");
    expect(container.textContent).toBe("");
  });

  it("renders no emoji or symbol glyphs", () => {
    const { container } = render(<DashboardPage />);
    expect(container.textContent).not.toMatch(/[\p{Extended_Pictographic}←-⇿▲▼✓✔]/u);
  });
});
