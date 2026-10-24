import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRINTER_CONFIG,
  loadDeviceConfig,
  pickShopDefaults,
  printConfigKey,
  resolveConfig,
  sanitizeConfig,
  saveDeviceConfig,
  SHOP_DEFAULT_KEYS,
  type KeyValueStore,
} from "./config";
import { logDrawer, readDrawerLog } from "./log";

const memory = (): KeyValueStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

describe("sanitizeConfig", () => {
  it("drops unknown keys and bad values", () => {
    expect(sanitizeConfig({ transport: "laser", paperWidth: 70, charsPerLine: "abc", evil: 1, autoPrint: "yes" })).toEqual({});
    expect(sanitizeConfig(null)).toEqual({});
    expect(sanitizeConfig("x")).toEqual({});
  });
  it("keeps valid values, clamps numbers and trims lines", () => {
    const c = sanitizeConfig({ transport: "usb", paperWidth: 58, charsPerLine: "200", baudRate: 115200, headerLines: [" Hi ", "", 5, "x".repeat(100)], cut: "none", drawerPin: 1, autoPrint: true });
    expect(c).toMatchObject({ transport: "usb", paperWidth: 58, charsPerLine: 64, baudRate: 115200, cut: "none", drawerPin: 1, autoPrint: true });
    expect(c.headerLines).toEqual(["Hi", "x".repeat(64)]);
  });
  it("caps header / footer lines at six", () => {
    expect(sanitizeConfig({ footerLines: Array.from({ length: 10 }, (_, i) => `l${i}`) }).footerLines).toHaveLength(6);
  });
});

describe("resolveConfig layers", () => {
  it("built-in < shop < device", () => {
    const c = resolveConfig({ paperWidth: 58, autoPrint: true, footerLines: ["Thanks"] }, { autoPrint: false, transport: "serial" });
    expect(c.paperWidth).toBe(58);
    expect(c.autoPrint).toBe(false);
    expect(c.transport).toBe("serial");
    expect(c.footerLines).toEqual(["Thanks"]);
    expect(c.openDrawerOnCash).toBe(true);
  });
  it("re-derives characters per line and dots from the paper width unless set", () => {
    expect(resolveConfig({ paperWidth: 58 }).charsPerLine).toBe(32);
    expect(resolveConfig({ paperWidth: 58 }).widthDots).toBe(384);
    expect(resolveConfig({}, { paperWidth: 58, charsPerLine: 42 }).charsPerLine).toBe(42);
    expect(resolveConfig().charsPerLine).toBe(DEFAULT_PRINTER_CONFIG.charsPerLine);
  });
  it("shop defaults can't set device-only keys", () => {
    const c = resolveConfig({ transport: "bridge", bridgeToken: "leak", deviceHint: "x" }, {});
    expect(c.transport).toBe("none");
    expect(c.bridgeToken).toBe("");
  });
  it("pickShopDefaults returns only shop keys", () => {
    const keys = Object.keys(pickShopDefaults(resolveConfig({}, { bridgeToken: "secret", transport: "usb" }))).sort();
    expect(keys).toEqual([...SHOP_DEFAULT_KEYS].sort());
  });
});

describe("device storage", () => {
  it("round-trips per shop key and merges patches", () => {
    const s = memory();
    saveDeviceConfig("acme", { transport: "usb", paperWidth: 80 }, s);
    saveDeviceConfig("acme", { autoPrint: true }, s);
    saveDeviceConfig("other", { transport: "serial" }, s);
    expect(loadDeviceConfig("acme", s)).toEqual({ transport: "usb", paperWidth: 80, autoPrint: true });
    expect(loadDeviceConfig("other", s)).toEqual({ transport: "serial" });
    expect(s.map.has(printConfigKey("acme"))).toBe(true);
  });
  it("tolerates corrupt JSON and missing / throwing storage", () => {
    const s = memory();
    s.setItem(printConfigKey("a"), "{not json");
    expect(loadDeviceConfig("a", s)).toEqual({});
    expect(loadDeviceConfig("a", null)).toEqual({});
    const throwing: KeyValueStore = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => {} };
    expect(loadDeviceConfig("a", throwing)).toEqual({});
    expect(() => saveDeviceConfig("a", { autoPrint: true }, throwing)).not.toThrow();
  });
});

describe("drawer log", () => {
  it("keeps entries in order and caps the size", () => {
    const s = memory();
    vi.spyOn(console, "info").mockImplementation(() => {});
    for (let i = 0; i < 205; i++) logDrawer({ kind: "no_sale", ok: true, user: `u${i}` }, s);
    const log = readDrawerLog(s);
    expect(log).toHaveLength(200);
    expect(log.at(-1)!.user).toBe("u204");
    expect(log[0]!.user).toBe("u5");
  });
});
