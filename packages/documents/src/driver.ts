import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { AppError } from "@rbms/core";
import type { Browser, Page } from "puppeteer-core";
import { noopLogger, type LoggerPort, type Paper } from "./types";

/**
 * Loads puppeteer-core through its CommonJS build, never `import()`.
 *
 * The ESM build pulls in `@puppeteer/browsers` CLI.js, which does `import { stdin } from "node:process"`. Node builds
 * the ESM facade of `node:process` by reading every property, so the first such import initialises `process.stdin`.
 * On Windows, when stdin is an inherited pipe that a parent is already reading (turbo → pnpm → `tsx watch`, which
 * listens on stdin for "Return to restart"), opening it blocks the main thread forever: the whole API stops answering
 * at the first PDF after every restart. The CJS build only touches `stdin` inside its interactive prompt.
 */
export function loadPuppeteer(): typeof import("puppeteer-core") {
  const mod = createRequire(import.meta.url)("puppeteer-core") as typeof import("puppeteer-core") & { default?: typeof import("puppeteer-core") };
  return mod.default ?? mod;
}

/** Turns a complete HTML document into a PDF. Swap it for a Lambda/container driver in production if needed. */
export interface PdfDriver {
  render(html: string, opts: { paper: Paper; timeoutMs?: number }): Promise<Buffer>;
  /** Releases the browser (module.stop). */
  close(): Promise<void>;
}

// ------------------------------------------------------------------ executable detection

export interface DetectOptions {
  /** Explicit path from config; wins when it exists. */
  chromePath?: string | null;
  platform?: NodeJS.Platform;
  /** Environment to read CHROME_PATH / PUPPETEER_EXECUTABLE_PATH / Windows program folders from (pass process.env). */
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
}

/** Ordered candidate paths for a Chromium-family browser on the platform. */
export function chromeCandidates(platform: NodeJS.Platform, env: Record<string, string | undefined> = {}): string[] {
  if (platform === "win32") {
    const pf = env.PROGRAMFILES || env.ProgramFiles || "C:\\Program Files";
    const pf86 = env["PROGRAMFILES(X86)"] || env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = env.LOCALAPPDATA;
    const list = [
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
      local ? `${local}\\Google\\Chrome\\Application\\chrome.exe` : null,
      `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Chromium\\Application\\chrome.exe`,
      local ? `${local}\\Chromium\\Application\\chrome.exe` : null,
    ];
    return list.filter((p): p is string => !!p);
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  return [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/lib/chromium/chromium",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/opt/google/chrome/chrome",
  ];
}

/**
 * Finds the browser executable: config `chromePath` → `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH` → well-known
 * install locations. Returns null when nothing is found.
 */
export function findChromeExecutable(opts: DetectOptions = {}): string | null {
  const exists = opts.exists ?? existsSync;
  const env = opts.env ?? {};
  const platform = opts.platform ?? process.platform;
  const explicit = [opts.chromePath, env.CHROME_PATH, env.PUPPETEER_EXECUTABLE_PATH].map((p) => p?.trim()).filter((p): p is string => !!p);
  for (const p of explicit) if (exists(p)) return p;
  for (const p of chromeCandidates(platform, env)) if (exists(p)) return p;
  return null;
}

// ------------------------------------------------------------------ puppeteer-core driver

export interface PuppeteerDriverOptions extends DetectOptions {
  /** Pages rendering at the same time (default 2). */
  maxPages?: number;
  /** Per-render timeout in ms (default 30 000). */
  timeoutMs?: number;
  /** Adds --no-sandbox (default: true on Linux, where containers usually need it). */
  noSandbox?: boolean;
  /** Load remote http(s) images (logos). Everything else is always blocked. Default true. */
  allowRemoteImages?: boolean;
  extraArgs?: string[];
  log?: LoggerPort;
}

const MM_PER_PX = 25.4 / 96;

/** Tiny counting semaphore. */
class Gate {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(private readonly max: number) {}
  /** Waits for a slot; with `timeoutMs`, gives up (and leaves the queue) after that long. */
  async acquire(timeoutMs?: number): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.push(waiter);
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(pdfTimeout("waiting for a free PDF renderer", timeoutMs));
        }, timeoutMs);
      }
    });
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
}

/** 504 in the API's error shape: the PDF could not be produced in time. */
export function pdfTimeout(what: string, ms: number): AppError {
  return new AppError(504, "pdf_timeout", `PDF ${what} timed out after ${ms} ms`);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(pdfTimeout(what, ms)), Math.max(1, ms));
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * One shared headless browser, launched on first use and relaunched if it crashes or disconnects.
 * At most `maxPages` pages render concurrently; idle pages are reused.
 */
export class PuppeteerPdfDriver implements PdfDriver {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private idle: Page[] = [];
  private readonly gate: Gate;
  private readonly log: LoggerPort;
  private closed = false;

  constructor(private readonly opts: PuppeteerDriverOptions = {}) {
    this.gate = new Gate(Math.max(1, opts.maxPages ?? 2));
    this.log = opts.log ?? noopLogger;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (this.launching) return this.launching;
    this.launching = this.launch().finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  private async launch(): Promise<Browser> {
    const executablePath = findChromeExecutable(this.opts);
    if (!executablePath) {
      throw new Error("No Chrome/Chromium/Edge found for PDF rendering; set documents config chromePath (or CHROME_PATH)");
    }
    const puppeteer = loadPuppeteer();
    const platform = this.opts.platform ?? process.platform;
    const args = [
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--font-render-hinting=none",
      ...((this.opts.noSandbox ?? platform === "linux") ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
      ...(this.opts.extraArgs ?? []),
    ];
    const browser = await puppeteer.launch({ executablePath, headless: true, args, timeout: this.opts.timeoutMs ?? 30_000 });
    this.log.info({ executablePath }, "documents: browser launched");
    browser.on("disconnected", () => {
      if (this.browser === browser) {
        this.browser = null;
        this.idle = [];
        if (!this.closed) this.log.warn({}, "documents: browser disconnected; it will be relaunched on the next render");
      }
    });
    this.browser = browser;
    this.idle = [];
    return browser;
  }

  private async newPage(browser: Browser): Promise<Page> {
    const p = await browser.newPage();
    await p.setRequestInterception(true);
    const allowImages = this.opts.allowRemoteImages ?? true;
    p.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url === "about:blank") return void req.continue();
      if (allowImages && req.resourceType() === "image" && /^https?:/i.test(url)) return void req.continue();
      return void req.abort();
    });
    return p;
  }

  async render(html: string, opts: { paper: Paper; timeoutMs?: number }): Promise<Buffer> {
    if (this.closed) throw new Error("PDF driver is closed");
    const timeoutMs = opts.timeoutMs ?? this.opts.timeoutMs ?? 30_000;
    // One deadline for the whole job (queue + browser + page + render), so a request can never wait forever.
    const deadline = Date.now() + timeoutMs;
    const left = () => Math.max(1, deadline - Date.now());
    await this.gate.acquire(timeoutMs);
    let page: Page | null = null;
    let reusable = false;
    try {
      const acquiring = this.getBrowser().then((browser) => this.idle.pop() ?? this.newPage(browser));
      // A page that shows up after the deadline is closed instead of leaking.
      acquiring.catch(() => undefined);
      page = await withTimeout(acquiring, left(), "browser start").catch((err) => {
        void acquiring.then((p) => p.close()).catch(() => undefined);
        throw err;
      });
      const pg = page;
      const pdf = await withTimeout(
        (async () => {
          pg.setDefaultTimeout(timeoutMs);
          await pg.setContent(html, { waitUntil: "load", timeout: timeoutMs });
          await pg.evaluate("document.fonts.ready.then(() => true)");
          if (opts.paper === "80mm" || opts.paper === "58mm") {
            const widthMm = opts.paper === "58mm" ? 58 : 80;
            await pg.setViewport({ width: Math.round(widthMm / MM_PER_PX), height: 600 });
            const px = Number(await pg.evaluate("Math.ceil(document.documentElement.scrollHeight)"));
            const heightMm = Math.max(60, Math.ceil(px * MM_PER_PX) + 6);
            return pg.pdf({ width: `${widthMm}mm`, height: `${heightMm}mm`, printBackground: true, timeout: timeoutMs });
          }
          return pg.pdf({ format: opts.paper, printBackground: true, preferCSSPageSize: true, timeout: timeoutMs });
        })(),
        left(),
        "rendering",
      );
      reusable = true;
      return Buffer.from(pdf);
    } finally {
      if (page) {
        if (reusable && this.browser?.connected && this.idle.length < (this.opts.maxPages ?? 2)) {
          // Clear the document so the next render starts clean.
          await page.goto("about:blank").then(
            () => this.idle.push(page!),
            () => page!.close().catch(() => undefined),
          );
        } else {
          await page.close().catch(() => undefined);
        }
      }
      this.gate.release();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const b = this.browser ?? (this.launching ? await this.launching.catch(() => null) : null);
    this.browser = null;
    this.idle = [];
    if (b) await b.close().catch(() => undefined);
  }
}
