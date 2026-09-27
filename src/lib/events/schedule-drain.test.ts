import { describe, it, expect, vi } from "vitest";

describe("scheduleEventDrain", () => {
  it("does not throw outside a request scope", async () => {
    vi.resetModules();
    vi.doMock("next/server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("next/server")>()),
      after: () => {
        throw new Error("`after` was called outside a request scope");
      },
    }));
    vi.doMock("@/db", () => ({ db: {} }));
    const { scheduleEventDrain } = await import("./schedule-drain");
    expect(() => scheduleEventDrain()).not.toThrow();
  });

  it("schedules a bounded drain after the response", async () => {
    vi.resetModules();
    const afterMock = vi.fn();
    const drain = vi.fn(async () => ({ processed: 0, failed: 0 }));
    vi.doMock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: afterMock }));
    vi.doMock("@/db", () => ({ db: { marker: true } }));
    vi.doMock("@/services/event-drain.service", () => ({ EventDrainService: { drain } }));
    const { scheduleEventDrain } = await import("./schedule-drain");

    scheduleEventDrain();
    expect(afterMock).toHaveBeenCalledTimes(1);
    await afterMock.mock.calls[0][0]();
    expect(drain).toHaveBeenCalledWith({ marker: true }, { limit: 20 });
  });
});
