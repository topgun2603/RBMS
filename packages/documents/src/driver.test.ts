import { describe, expect, it } from "vitest";
import { chromeCandidates, findChromeExecutable } from "./driver";

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
