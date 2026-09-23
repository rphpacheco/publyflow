// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { QueryProvider } from "./query-provider";

function Probe() {
  const { data } = useQuery({
    queryKey: ["probe"],
    queryFn: async () => "query-client-is-wired",
  });
  return <span>{data ?? "loading"}</span>;
}

describe("QueryProvider", () => {
  it("provides a working QueryClient to its children", async () => {
    render(
      <QueryProvider>
        <Probe />
      </QueryProvider>,
    );

    expect(await screen.findByText("query-client-is-wired")).toBeInTheDocument();
  });
});
