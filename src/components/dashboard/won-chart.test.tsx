// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("recharts", () => {
  const Box = ({ children, data }: { children?: React.ReactNode; data?: unknown[] }) => (
    <div data-testid="chart" data-points={data?.length} data-labels={data?.map((d) => (d as { label: string }).label).join(",")}>{children}</div>
  );
  const Null = () => null;
  return { ResponsiveContainer: Box, AreaChart: Box, Area: Null, CartesianGrid: Null, Tooltip: Null, XAxis: Null, YAxis: Null };
});

import { WonChart, bucketLabel, formatAxisBRL } from "./won-chart";

const points = [
  { start: "2026-10-05", wonCents: 1000, wonCount: 1 },
  { start: "2026-10-12", wonCents: 0, wonCount: 0 },
];

describe("WonChart", () => {
  it("passes one point per bucket", () => {
    render(<WonChart points={points} bucket="week" />);
    const chart = screen.getAllByTestId("chart").find((e) => e.getAttribute("data-points"))!;
    expect(chart.getAttribute("data-points")).toBe("2");
    expect(chart.getAttribute("data-labels")).toBe("05/10,12/10");
  });
  it("formats labels by bucket", () => {
    expect(bucketLabel("2026-10-05", "day")).toBe("05/10");
    expect(bucketLabel("2026-10-05", "week")).toBe("05/10");
    expect(bucketLabel("2026-10-01", "month")).toBe("out/26");
  });
  it("formats compact axis ticks", () => {
    expect(formatAxisBRL(0)).toBe("R$ 0");
    expect(formatAxisBRL(500)).toBe("R$ 500");
    expect(formatAxisBRL(1000)).toBe("R$ 1 mil");
    expect(formatAxisBRL(1500)).toBe("R$ 1,5 mil");
    expect(formatAxisBRL(999_999)).toBe("R$ 1 mi");
    expect(formatAxisBRL(16000)).toBe("R$ 16 mil");
    expect(formatAxisBRL(1250000)).toBe("R$ 1,3 mi");
  });
});
