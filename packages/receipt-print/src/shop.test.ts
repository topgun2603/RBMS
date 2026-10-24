import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDeviceKeys, loadDeviceConfig, saveDeviceConfig, type KeyValueStore } from "./config";
import { resetPrinterSessions } from "./direct";
import type { ReceiptData } from "./receipt";
import { invalidateShopDefaults, loadShopDefaults, printDirectIfConfigured, resolvePrinterConfig } from "./shop";
import type { UsbDeviceLike } from "./transport/types";

const memory = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

const data: ReceiptData = {
  shop: { name: "S" },
  number: "1",
  date: "d",
  lines: [],
  totals: { taxable: 0, cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: 0 },
  payments: [],
};

beforeEach(async () => {
  invalidateShopDefaults();
  await resetPrinterSessions();
});

describe("shop defaults", () => {
  it("are cached per shop for a minute and a failing loader means no defaults", async () => {
    const load = vi.fn(async () => ({ paperWidth: 58 }));
    await loadShopDefaults("a", load, 1000);
    await loadShopDefaults("a", load, 2000);
    expect(load).toHaveBeenCalledTimes(1);
    await loadShopDefaults("a", load, 1000 + 61_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(await loadShopDefaults("b", async () => Promise.reject(new Error("403")))).toEqual({});
  });

  it("resolve under the device overrides", async () => {
    const store = memory();
    saveDeviceConfig("a", { transport: "usb", autoPrint: true }, store);
    const c = await resolvePrinterConfig("a", async () => ({ paperWidth: 58, autoPrint: false, footerLines: ["Thanks"] }), store);
    expect(c).toMatchObject({ transport: "usb", paperWidth: 58, charsPerLine: 32, autoPrint: true, footerLines: ["Thanks"] });
  });

  it("clearDeviceKeys lets the shop default show through again", () => {
    const store = memory();
    saveDeviceConfig("a", { transport: "usb", paperWidth: 58, autoPrint: true }, store);
    clearDeviceKeys("a", ["paperWidth", "autoPrint"], store);
    expect(loadDeviceConfig("a", store)).toEqual({ transport: "usb" });
  });
});

describe("printDirectIfConfigured", () => {
  it("is not handled (silent fallback) when this device has no direct printer", async () => {
    const out = await printDirectIfConfigured({ tenant: "a", loadShop: async () => ({}), receipt: data, store: memory() });
    expect(out).toEqual({ handled: false, reason: "not_configured" });
  });

  it("a shop default cannot turn a direct printer on for a device that never set one up", async () => {
    const out = await printDirectIfConfigured({ tenant: "a", loadShop: async () => ({ transport: "usb", autoPrint: true }), receipt: data, store: memory() });
    expect(out).toMatchObject({ handled: false, reason: "not_configured" });
  });

  it("reports the reason when the browser cannot do the configured transport (so the caller falls back)", async () => {
    const store = memory();
    saveDeviceConfig("a", { transport: "usb" }, store);
    // node has no navigator.usb
    const out = await printDirectIfConfigured({ tenant: "a", loadShop: async () => ({}), receipt: data, store });
    expect(out).toMatchObject({ handled: false, reason: "unsupported" });
  });

  it("prints with a mock USB device and only kicks the drawer when the shop setting allows it", async () => {
    const store = memory();
    saveDeviceConfig("a", { transport: "usb" }, store);
    const written: number[] = [];
    const dev = {
      vendorId: 1,
      productId: 2,
      opened: false,
      configuration: { configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: "out", type: "bulk" }] }] }] },
      open: async () => void (dev.opened = true),
      close: async () => {},
      selectConfiguration: async () => {},
      claimInterface: async () => {},
      releaseInterface: async () => {},
      transferOut: async (_e: number, d: BufferSource) => (written.push(...(d as Uint8Array)), { status: "ok", bytesWritten: 0 }),
    } as unknown as UsbDeviceLike;
    const env = { navigator: { usb: { getDevices: async () => [dev], requestDevice: async () => dev } } };
    const kick = [0x1b, 0x70, 0x00, 0x19, 0xfa].join(",");

    const withDrawer = await printDirectIfConfigured({ tenant: "a", loadShop: async () => ({}), receipt: data, drawer: true, direct: { env }, store });
    expect(withDrawer.handled).toBe(true);
    expect(written.join(",")).toContain(kick);

    written.length = 0;
    invalidateShopDefaults();
    const off = await printDirectIfConfigured({ tenant: "a", loadShop: async () => ({ openDrawerOnCash: false }), receipt: data, drawer: true, direct: { env }, store });
    expect(off.handled).toBe(true);
    expect(written.join(",")).not.toContain(kick);
  });
});
