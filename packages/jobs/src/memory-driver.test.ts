import { describe, expect, it, vi } from "vitest";
import { MemoryJobsDriver } from "./memory-driver";
import { JobsService } from "./service";
import type { LoggerPort } from "./types";

const makeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) satisfies LoggerPort;

function setup() {
  const log = makeLog();
  const driver = new MemoryJobsDriver(log);
  const service = new JobsService(driver);
  return { log, driver, service };
}

describe("memory jobs driver", () => {
  it("runs an enqueued job with its data", async () => {
    const { driver, service } = setup();
    const seen: Array<{ data: unknown; attempt: number; jobId: string }> = [];
    service.define<{ n: number }>("hello", async (data, meta) => {
      seen.push({ data, ...meta });
    });
    await service.enqueue("hello", { n: 1 }, { jobId: "j1" });
    await driver.whenIdle();
    expect(seen).toEqual([{ data: { n: 1 }, attempt: 1, jobId: "j1" }]);
  });

  it("retries until success with increasing attempt numbers", async () => {
    const { driver, service, log } = setup();
    const attempts: number[] = [];
    service.define(
      "flaky",
      async (_d, { attempt }) => {
        attempts.push(attempt);
        if (attempt < 3) throw new Error("boom");
      },
      { attempts: 3, backoffMs: 1 },
    );
    await service.enqueue("flaky", {});
    await driver.whenIdle();
    expect(attempts).toEqual([1, 2, 3]);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("gives up after the configured attempts and logs an error", async () => {
    const { driver, service, log } = setup();
    const handler = vi.fn(async () => {
      throw new Error("always");
    });
    service.define("broken", handler, { attempts: 2, backoffMs: 1 });
    await service.enqueue("broken", {});
    await driver.whenIdle();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("throws for an unknown job name", async () => {
    const { service } = setup();
    await expect(service.enqueue("nope", {})).rejects.toThrow(/Unknown job "nope"/);
  });

  it("rejects defining the same job twice", () => {
    const { service } = setup();
    service.define("a", async () => {});
    expect(() => service.define("a", async () => {})).toThrow(/already defined/);
  });

  it("dedupes by jobId while the first job is pending", async () => {
    const { driver, service } = setup();
    const handler = vi.fn(async () => {});
    service.define("once", handler);
    await service.enqueue("once", { v: 1 }, { jobId: "same" });
    await service.enqueue("once", { v: 2 }, { jobId: "same" });
    await driver.whenIdle();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ v: 1 }, { attempt: 1, jobId: "same" });

    // Once finished, the same id may be enqueued again.
    await service.enqueue("once", { v: 3 }, { jobId: "same" });
    await driver.whenIdle();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("respects delayMs", async () => {
    vi.useFakeTimers();
    try {
      const { service } = setup();
      const handler = vi.fn(async () => {});
      service.define("later", handler);
      await service.enqueue("later", {}, { delayMs: 1000 });
      await vi.advanceTimersByTimeAsync(999);
      expect(handler).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("schedule only warns in memory mode", async () => {
    const { service, log } = setup();
    service.define("nightly", async () => {});
    await service.schedule("nightly", "0 2 * * *");
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ job: "nightly" }), expect.stringContaining("disabled"));
  });

  it("stop() cancels pending jobs", async () => {
    const { driver, service } = setup();
    const handler = vi.fn(async () => {});
    service.define("x", handler);
    await service.enqueue("x", {}, { delayMs: 50 });
    await driver.stop();
    await new Promise((r) => setTimeout(r, 80));
    expect(handler).not.toHaveBeenCalled();
  });
});
