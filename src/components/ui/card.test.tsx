// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";

describe("Card", () => {
  it("renders its composed sections", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Bella Cosméticos</CardTitle>
          <CardDescription>Opportunity em Negociação</CardDescription>
        </CardHeader>
        <CardContent>R$ 5.000</CardContent>
        <CardFooter>Ver detalhes</CardFooter>
      </Card>,
    );

    expect(screen.getByText("Bella Cosméticos")).toBeInTheDocument();
    expect(screen.getByText("Opportunity em Negociação")).toBeInTheDocument();
    expect(screen.getByText("R$ 5.000")).toBeInTheDocument();
    expect(screen.getByText("Ver detalhes")).toBeInTheDocument();
  });
});
