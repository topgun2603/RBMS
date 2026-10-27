import { AppError } from "@srirealtime/core";
import { describe, expect, it } from "vitest";
import { PuppeteerPdfDriver, chromeCandidates, findChromeExecutable, loadPuppeteer } from "./driver";

describe("loadPuppeteer", () => {
  // Regression: the ESM build's `import { stdin } from "node:process"` opened process.stdin, which blocks the whole
  // API forever on Windows when stdin is a pipe that `tsx watch` is reading (turbo/pnpm dev). Loading must not touch it.
  it("loads puppeteer-core without opening process.stdin", () => {
    const desc = Object.getOwnPropertyDescriptor(process, "stdin")!;
    let touched = 0;
    Object.defineProperty(process, "stdin", {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        touched++;
        return desc.get ? desc.get.call(process) : desc.value;
      },
    });
    try {
      const puppeteer = loadPuppeteer();
      expect(typeof puppeteer.launch).toBe("function");
      expect(touched).toBe(0);
    } finally {
      Object.defineProperty(process, "stdin", desc);
    }
  });
});

describe("PuppeteerPdfDriver deadline", () => {
  /** A driver whose browser never starts (stands in for any stuck step before rendering). */
  function stuckDriver(maxPages = 1) {
    const d = new PuppeteerPdfDriver({ maxPages });
    (d as unknown as { getBrowser: () => Promise<never> }).getBrowser = () => new Promise<never>(() => undefined);
    return d;
  }

  it("fails a stuck job with a 504 instead of hanging", async () => {
    const d = stuckDriver();
    const t0 = Date.now();
    const err = await d.render("<html></html>", { paper: "A4", timeoutMs: 80 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 504, code: "pdf_timeout" });
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("frees the slot after a timeout and times out queued jobs too", async () => {
    const d = stuckDriver(1);
    const first = d.render("<html></html>", { paper: "A4", timeoutMs: 150 }).catch((e: unknown) => e);
    const queued = d.render("<html></html>", { paper: "A4", timeoutMs: 50 }).catch((e: unknown) => e);
    expect(await queued).toMatchObject({ status: 504, message: expect.stringMatching(/free PDF renderer/) });
    expect(await first).toMatchObject({ status: 504 });
    // The slot was released: a later job gets past the queue and times out on the browser instead.
    expect(await d.render("<html></html>", { paper: "A4", timeoutMs: 50 }).catch((e: unknown) => e)).toMatchObject({
      status: 504,
      message: expect.stringMatching(/browser start/),
    });
  }, 10_000);
});

const has = (...paths: string[]) => (p: string) => paths.includes(p);

describe("findChromeExecutable", () => {
  it("prefers the configured path when it exists", () => {
    expect(findChromeExecutable({ chromePath: "/opt/chrome", platform: "linux", exists: has("/opt/chrome", "/usr/bin/chromium") })).toBe("/opt/chrome");
  });

  it("ignores a configured path that does not exist", () => {
    expect(findChromeExecutable({ chromePath: "/nope", platform: "linux", exists: has("/usr/bin/chromium") })).toBe("/usr/bin/chromium");
  });

  it("uses CHROME_PATH / PUPPETEER_EXECUTABLE_PATH before well-known paths", () => {
    expect(findChromeExecutable({ platform: "linux", env: { CHROME_PATH: "/x/chrome" }, exists: has("/x/chrome", "/usr/bin/chromium") })).toBe("/x/chrome");
    expect(findChromeExecutable({ platform: "linux", env: { PUPPETEER_EXECUTABLE_PATH: "/y" }, exists: has("/y") })).toBe("/y");
  });

  it("finds Chrome, then Edge on Windows", () => {
    const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    expect(findChromeExecutable({ platform: "win32", exists: has(chrome, edge) })).toBe(chrome);
    expect(findChromeExecutable({ platform: "win32", exists: has(edge) })).toBe(edge);
    expect(chromeCandidates("win32", { PROGRAMFILES: "D:\\Apps" })[0]).toBe("D:\\Apps\\Google\\Chrome\\Application\\chrome.exe");
    expect(chromeCandidates("win32", { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" })).toContain("C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe");
  });

  it("knows macOS and Linux locations, and returns null when nothing exists", () => {
    expect(findChromeExecutable({ platform: "darwin", exists: has("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge") })).toContain("Edge");
    expect(chromeCandidates("linux")[0]).toBe("/usr/bin/chromium");
    expect(findChromeExecutable({ platform: "linux", exists: () => false })).toBeNull();
  });
});
