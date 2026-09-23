import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("design tokens", () => {
  it("defines the Electric Editorial palette and radii as CSS variables", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf-8");

    expect(css).toContain("--background: #F4F4F6");
    expect(css).toContain("--card: #FFFFFF");
    expect(css).toContain("--foreground: #08090A");
    expect(css).toContain("--muted-foreground: #71717A");
    expect(css).toContain("--muted: #EDEDF0");
    expect(css).toContain("--border: #E4E4E7");
    expect(css).toContain("--ring: #6E56CF");
    expect(css).toContain("--primary: #6E56CF");
    expect(css).toContain("--primary-foreground: #FFFFFF");
    expect(css).toContain("--accent: #E93D82");
    expect(css).toContain("--accent-foreground: #FFFFFF");
    expect(css).toContain("--success: #30A46C");
    expect(css).toContain("--warning: #F5A623");
    expect(css).toContain("--error: #E5484D");
    expect(css).toContain("--error-foreground: #FFFFFF");
    expect(css).toContain("--info: #0091FF");
    expect(css).toContain("--radius-sm-value: 6px");
    expect(css).toContain("--radius-md-value: 8px");
    expect(css).toContain("--radius-lg-value: 12px");
    expect(css).toContain("--font-inter");
    expect(css).not.toContain("--surface");
  });

  it("maps radius theme keys to their distinctly-named source variables (not self-referential)", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf-8");

    expect(css).toContain("--radius-sm: var(--radius-sm-value)");
    expect(css).toContain("--radius-md: var(--radius-md-value)");
    expect(css).toContain("--radius-lg: var(--radius-lg-value)");
  });

  it("defines an overlay token instead of hardcoded black/opacity", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf-8");

    expect(css).toContain("--overlay:");
    expect(css).toContain("--color-overlay: var(--overlay)");
  });

  it("defines a visible focus-visible outline using the ring token", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf-8");
    expect(css).toContain(":focus-visible");
  });
});
