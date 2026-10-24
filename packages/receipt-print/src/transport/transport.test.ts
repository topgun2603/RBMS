import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRINTER_CONFIG, type PrinterConfig } from "../config";
import { openDrawerDirect, pairPrinter, printReceiptDirect, printTestPage, resetPrinterSessions } from "../direct";
import type { ReceiptData } from "../receipt";
import { createBluetoothTransport } from "./bluetooth";
import { createBridgeTransport, isLoopbackUrl } from "./bridge";
import { detectSupport, selectTransport } from "./select";
import { createSerialTransport } from "./serial";
import { chunk, PrintError, type BtCharacteristicLike, type PrintEnv, type SerialPortLike, type UsbDeviceLike } from "./types";
import { createUsbTransport, findBulkOut } from "./usb";

const cfg = (over: Partial<PrinterConfig> = {}): PrinterConfig => ({ ...DEFAULT_PRINTER_CONFIG, ...over });

function mockUsbDevice(over: Partial<UsbDeviceLike> = {}) {
  const written: number[][] = [];
  const dev: UsbDeviceLike = {
    vendorId: 0x04b8,
    productId: 0x0e15,
    productName: "TM-T82",
    manufacturerName: "EPSON",
    opened: false,
    configuration: { configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: "out", type: "bulk" }] }] }] },
    open: vi.fn(async () => void (dev.opened = true)),
    close: vi.fn(async () => void (dev.opened = false)),
    selectConfiguration: vi.fn(async () => {}),
    claimInterface: vi.fn(async () => {}),
    releaseInterface: vi.fn(async () => {}),
    transferOut: vi.fn(async (_e: number, data: BufferSource) => {
      written.push(Array.from(data as Uint8Array));
      return { status: "ok", bytesWritten: (data as Uint8Array).length };
    }),
    ...over,
  };
  return { dev, written };
}

afterEach(async () => {
  await resetPrinterSessions();
});

describe("feature detection and selection", () => {
  it("reports what the browser has; insecure contexts lose usb / serial / bluetooth", () => {
    expect(detectSupport({ navigator: { usb: {} as never }, fetch })).toEqual({ usb: true, serial: false, bluetooth: false, bridge: true });
    expect(detectSupport({ navigator: { usb: {} as never, serial: {} as never }, isSecureContext: false })).toEqual({ usb: false, serial: false, bluetooth: false, bridge: false });
    expect(detectSupport({})).toEqual({ usb: false, serial: false, bluetooth: false, bridge: false });
  });
  it("returns null with a reason so the caller falls back to the browser print", () => {
    expect(selectTransport(cfg(), {})).toEqual({ transport: null, reason: "not_configured" });
    expect(selectTransport(cfg({ transport: "usb" }), { navigator: {} })).toEqual({ transport: null, reason: "unsupported" });
    expect(selectTransport(cfg({ transport: "serial" }), { navigator: {} })).toEqual({ transport: null, reason: "unsupported" });
    expect(selectTransport(cfg({ transport: "bluetooth" }), { navigator: {} })).toEqual({ transport: null, reason: "unsupported" });
    expect(selectTransport(cfg({ transport: "bridge" }), {})).toEqual({ transport: null, reason: "unsupported" });
    expect(selectTransport(cfg({ transport: "bridge", bridgeUrl: "http://192.168.1.5:9101" }), { fetch })).toEqual({ transport: null, reason: "bridge_url_not_loopback" });
  });
  it("picks the transport that matches the config", () => {
    const env: PrintEnv = { navigator: { usb: {} as never, serial: {} as never, bluetooth: {} as never }, fetch };
    for (const kind of ["usb", "serial", "bluetooth", "bridge"] as const) {
      expect(selectTransport(cfg({ transport: kind }), env).transport?.kind).toBe(kind);
    }
  });
  it("only loopback bridge URLs are valid", () => {
    expect(isLoopbackUrl("http://127.0.0.1:9101")).toBe(true);
    expect(isLoopbackUrl("http://localhost:9101")).toBe(true);
    expect(isLoopbackUrl("http://10.0.0.4:9101")).toBe(false);
    expect(isLoopbackUrl("ftp://127.0.0.1")).toBe(false);
    expect(isLoopbackUrl("nonsense")).toBe(false);
  });
  it("chunk splits without losing bytes", () => {
    const parts = chunk(Uint8Array.from([1, 2, 3, 4, 5]), 2);
    expect(parts.map((p) => Array.from(p))).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("WebUSB transport", () => {
  it("finds the printer-class bulk OUT endpoint", () => {
    expect(findBulkOut(mockUsbDevice().dev)).toEqual({ iface: 0, endpoint: 1 });
    expect(findBulkOut(mockUsbDevice({ configuration: null }).dev)).toBeNull();
  });
  it("without a user gesture and nothing granted, asks to pair", async () => {
    const usb = { getDevices: async () => [], requestDevice: vi.fn() };
    const t = createUsbTransport({ navigator: { usb } });
    await expect(t.connect(false)).rejects.toMatchObject({ code: "not_paired" });
    expect(usb.requestDevice).not.toHaveBeenCalled();
  });
  it("interactive connect shows the picker for printer-class devices, claims the interface and writes in chunks", async () => {
    const { dev, written } = mockUsbDevice();
    const usb = { getDevices: async () => [], requestDevice: vi.fn(async () => dev) };
    const t = createUsbTransport({ navigator: { usb } });
    const paired = await t.connect(true);
    expect(usb.requestDevice).toHaveBeenCalledWith({ filters: [{ classCode: 7 }] });
    expect(paired).toEqual({ id: "04b8:0e15", name: "EPSON TM-T82" });
    expect(dev.claimInterface).toHaveBeenCalledWith(0);
    await t.write(new Uint8Array(40000));
    expect(written.map((w) => w.length)).toEqual([16384, 16384, 7232]);
    await t.close();
    expect(dev.releaseInterface).toHaveBeenCalled();
  });
  it("reuses an already granted device without a prompt", async () => {
    const { dev } = mockUsbDevice();
    const usb = { getDevices: async () => [dev], requestDevice: vi.fn() };
    const t = createUsbTransport({ navigator: { usb } }, "04b8:0e15");
    await t.connect(false);
    expect(usb.requestDevice).not.toHaveBeenCalled();
  });
  it("a closed picker is 'cancelled'; a failing claim is 'io'", async () => {
    const abort = Object.assign(new Error("none"), { name: "NotFoundError" });
    const t = createUsbTransport({ navigator: { usb: { getDevices: async () => [], requestDevice: async () => Promise.reject(abort) } } });
    await expect(t.connect(true)).rejects.toMatchObject({ code: "cancelled" });
    const busy = mockUsbDevice({ claimInterface: vi.fn(async () => Promise.reject(new Error("access denied"))) }).dev;
    const t2 = createUsbTransport({ navigator: { usb: { getDevices: async () => [busy], requestDevice: vi.fn() } } });
    await expect(t2.connect(false)).rejects.toMatchObject({ code: "io" });
  });
  it("a failed transfer is an io error", async () => {
    const { dev } = mockUsbDevice({ transferOut: vi.fn(async () => ({ status: "stall", bytesWritten: 0 })) });
    const t = createUsbTransport({ navigator: { usb: { getDevices: async () => [dev], requestDevice: vi.fn() } } });
    await t.connect(false);
    await expect(t.write(Uint8Array.of(1))).rejects.toMatchObject({ code: "io" });
  });
});

describe("Web Serial transport", () => {
  const port = () => {
    const chunks: number[][] = [];
    const p: SerialPortLike = {
      open: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
      writable: { getWriter: () => ({ write: async (d: Uint8Array) => void chunks.push(Array.from(d)), releaseLock: () => {} }) },
    };
    return { p, chunks };
  };
  it("opens the requested port at the configured baud rate and writes", async () => {
    const { p, chunks } = port();
    const serial = { getPorts: async () => [], requestPort: vi.fn(async () => p) };
    const t = createSerialTransport({ navigator: { serial } }, 19200);
    await expect(t.connect(false)).rejects.toMatchObject({ code: "not_paired" });
    expect((await t.connect(true)).id).toBe("1a86:7523");
    expect(p.open).toHaveBeenCalledWith({ baudRate: 19200 });
    await t.write(new Uint8Array(5000));
    expect(chunks.map((c) => c.length)).toEqual([4096, 904]);
  });
  it("reuses a granted port without a prompt", async () => {
    const { p } = port();
    const serial = { getPorts: async () => [p], requestPort: vi.fn() };
    await createSerialTransport({ navigator: { serial } }).connect(false);
    expect(serial.requestPort).not.toHaveBeenCalled();
  });
  it("cancelled picker", async () => {
    const serial = { getPorts: async () => [], requestPort: async () => Promise.reject(Object.assign(new Error("x"), { name: "NotFoundError" })) };
    await expect(createSerialTransport({ navigator: { serial } }).connect(true)).rejects.toMatchObject({ code: "cancelled" });
  });
  it("unsupported browser", async () => {
    await expect(createSerialTransport({ navigator: {} }).connect(true)).rejects.toMatchObject({ code: "unsupported" });
  });
});

describe("Web Bluetooth transport", () => {
  const char = (over: Partial<BtCharacteristicLike> = {}) => {
    const writes: number[][] = [];
    const c: BtCharacteristicLike = {
      uuid: "2af1",
      properties: { write: true, writeWithoutResponse: true },
      writeValueWithoutResponse: async (v: BufferSource) => void writes.push(Array.from(v as Uint8Array)),
      ...over,
    };
    return { c, writes };
  };
  const device = (c: BtCharacteristicLike) => ({
    id: "bt-1",
    name: "MTP-II",
    gatt: {
      connected: false,
      disconnect: () => {},
      connect: async () => ({ connected: true, disconnect: () => {}, getPrimaryServices: async () => [{ uuid: "000018f0-0000-1000-8000-00805f9b34fb", getCharacteristics: async () => [c] }] }),
    },
  });
  it("pairs with acceptAllDevices and the known printer services, then writes in small chunks", async () => {
    const { c, writes } = char();
    const bluetooth = { requestDevice: vi.fn(async (_o: { acceptAllDevices?: boolean; optionalServices: string[] }) => device(c)) };
    const t = createBluetoothTransport({ navigator: { bluetooth }, delay: async () => {} });
    await expect(t.connect(false)).rejects.toMatchObject({ code: "not_paired" });
    expect(await t.connect(true)).toEqual({ id: "bt-1", name: "MTP-II" });
    const arg = bluetooth.requestDevice.mock.calls[0]![0];
    expect(arg.acceptAllDevices).toBe(true);
    expect(arg.optionalServices).toContain("000018f0-0000-1000-8000-00805f9b34fb");
    await t.write(new Uint8Array(250));
    expect(writes.map((w) => w.length)).toEqual([100, 100, 50]);
  });
  it("no writable characteristic is no_endpoint", async () => {
    const { c } = char({ properties: { write: false, writeWithoutResponse: false } });
    const t = createBluetoothTransport({ navigator: { bluetooth: { requestDevice: async () => device(c) } } });
    await expect(t.connect(true)).rejects.toMatchObject({ code: "no_endpoint" });
  });
  it("unsupported without navigator.bluetooth", async () => {
    await expect(createBluetoothTransport({ navigator: {} }).connect(true)).rejects.toMatchObject({ code: "unsupported" });
  });
});

describe("bridge transport", () => {
  const res = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response;
  it("checks /health with the bearer token and posts raw bytes to /print", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => (calls.push({ url, init }), res(200)));
    const t = createBridgeTransport({ fetch: fetchMock as never }, { url: "http://127.0.0.1:9101/", token: "tok", printer: "counter 1" });
    await t.connect(false);
    await t.write(Uint8Array.of(1, 2, 3));
    expect(calls[0]!.url).toBe("http://127.0.0.1:9101/health");
    expect(calls[1]!.url).toBe("http://127.0.0.1:9101/print?printer=counter%201");
    expect(calls[1]!.init?.method).toBe("POST");
    expect((calls[1]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(Array.from(calls[1]!.init?.body as Uint8Array)).toEqual([1, 2, 3]);
  });
  it("maps failures: unreachable, wrong token, missing token, non-loopback", async () => {
    const down = createBridgeTransport({ fetch: (async () => Promise.reject(new TypeError("Failed to fetch"))) as never }, { url: "http://127.0.0.1:9101", token: "t", printer: "p" });
    await expect(down.connect(false)).rejects.toMatchObject({ code: "bridge_unreachable" });
    const bad = createBridgeTransport({ fetch: (async () => res(401)) as never }, { url: "http://127.0.0.1:9101", token: "t", printer: "p" });
    await expect(bad.connect(false)).rejects.toMatchObject({ code: "bridge_rejected" });
    const none = createBridgeTransport({ fetch: (async () => res(200)) as never }, { url: "http://127.0.0.1:9101", token: "", printer: "p" });
    await expect(none.connect(false)).rejects.toMatchObject({ code: "not_paired" });
    const remote = createBridgeTransport({ fetch: (async () => res(200)) as never }, { url: "http://evil.example", token: "t", printer: "p" });
    await expect(remote.connect(false)).rejects.toBeInstanceOf(PrintError);
  });
  it("writing before connect is refused", async () => {
    const t = createBridgeTransport({ fetch: (async () => res(200)) as never }, { url: "http://127.0.0.1:9101", token: "t", printer: "p" });
    await expect(t.write(Uint8Array.of(1))).rejects.toMatchObject({ code: "not_paired" });
  });
});

describe("direct printing (end to end with a mock USB printer)", () => {
  const data: ReceiptData = {
    shop: { name: "Shop" },
    number: "INV/1",
    date: "2026-10-24",
    lines: [{ description: "Rice", qty: 1, unitPrice: 10000, total: 10000 }],
    totals: { taxable: 10000, cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: 10000 },
    payments: [{ label: "Cash", amount: 10000 }],
  };
  const usbEnv = () => {
    const { dev, written } = mockUsbDevice();
    return { env: { navigator: { usb: { getDevices: async () => [dev], requestDevice: vi.fn() } } } as PrintEnv, written };
  };

  it("not configured and unsupported fall back (ok: false) without throwing", async () => {
    expect(await printReceiptDirect(cfg(), data)).toEqual({ ok: false, code: "not_configured" });
    expect(await printReceiptDirect(cfg({ transport: "usb" }), data, { env: { navigator: {} } })).toEqual({ ok: false, code: "unsupported" });
  });
  it("prints the receipt with a drawer kick for cash and a cut", async () => {
    const { env, written } = usbEnv();
    const r = await printReceiptDirect(cfg({ transport: "usb", cut: "partial" }), data, { env, drawer: true, rasterize: undefined });
    expect(r.ok).toBe(true);
    const all = written.flat();
    expect(all.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(all.slice(-5)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]); // kick last
    expect(all.join(",")).toContain("29,86,66,3"); // cut
  });
  it("opens the drawer alone", async () => {
    const { env, written } = usbEnv();
    expect((await openDrawerDirect(cfg({ transport: "usb", drawerPin: 1 }), { env })).ok).toBe(true);
    expect(written.flat()).toEqual([0x1b, 0x40, 0x1b, 0x70, 0x01, 0x19, 0xfa]);
  });
  it("auto-print with nothing granted reports not_paired instead of prompting", async () => {
    const requestDevice = vi.fn();
    const env: PrintEnv = { navigator: { usb: { getDevices: async () => [], requestDevice } } };
    expect(await printReceiptDirect(cfg({ transport: "usb" }), data, { env, interactive: false })).toMatchObject({ ok: false, code: "not_paired" });
    expect(requestDevice).not.toHaveBeenCalled();
  });
  it("pairing and the test page work from a click and report the device", async () => {
    const { dev, written } = mockUsbDevice();
    const env: PrintEnv = { navigator: { usb: { getDevices: async () => [], requestDevice: async () => dev } } };
    const paired = await pairPrinter(cfg({ transport: "usb" }), { env });
    expect(paired).toMatchObject({ ok: true, paired: { id: "04b8:0e15" } });
    const test = await printTestPage(cfg({ transport: "usb" }), "My Shop", { env });
    expect(test.ok).toBe(true);
    expect(written.length).toBeGreaterThan(0);
  });
  it("a write error resets the session and reports io; the next print reconnects", async () => {
    let fail = true;
    const { dev } = mockUsbDevice({
      transferOut: vi.fn(async () => {
        if (fail) throw new Error("unplugged");
        return { status: "ok", bytesWritten: 1 };
      }),
    });
    const env: PrintEnv = { navigator: { usb: { getDevices: async () => [dev], requestDevice: vi.fn() } } };
    expect(await openDrawerDirect(cfg({ transport: "usb" }), { env })).toMatchObject({ ok: false, code: "io" });
    fail = false;
    expect((await openDrawerDirect(cfg({ transport: "usb" }), { env })).ok).toBe(true);
  });
  it("Tamil receipts use the image path through the supplied rasterizer", async () => {
    const { env, written } = usbEnv();
    const rasterize = vi.fn(() => ({ width: 8, height: 1, data: Uint8Array.of(0xff) }));
    const r = await printReceiptDirect(cfg({ transport: "usb" }), { ...data, locale: "ta" }, { env, rasterize });
    expect(r).toMatchObject({ ok: true, raster: true, lossy: false });
    expect(rasterize).toHaveBeenCalled();
    expect(written.flat().join(",")).toContain("29,118,48");
  });
  it("config header and footer lines are added around the receipt", async () => {
    const { env, written } = usbEnv();
    await printReceiptDirect(cfg({ transport: "usb", headerLines: ["HDR-LINE"], footerLines: ["FTR-LINE"] }), data, { env });
    const text = new TextDecoder().decode(Uint8Array.from(written.flat()));
    expect(text).toContain("HDR-LINE");
    expect(text.indexOf("FTR-LINE")).toBeGreaterThan(text.indexOf("TOTAL"));
  });
});
