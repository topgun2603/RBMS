import { chunk, isDomAbort, PrintError, type PairedDevice, type PrintEnv, type Transport, type UsbDeviceLike, type UsbLike } from "./types";

/** USB class 7 = printer. */
const PRINTER_CLASS = 7;
const CHUNK = 16 * 1024;

const hint = (d: UsbDeviceLike) => `${d.vendorId.toString(16).padStart(4, "0")}:${d.productId.toString(16).padStart(4, "0")}`;
const nameOf = (d: UsbDeviceLike) => [d.manufacturerName, d.productName].filter(Boolean).join(" ") || `USB ${hint(d)}`;

/** The printer-class interface (or any interface) with a bulk OUT endpoint. */
export function findBulkOut(d: UsbDeviceLike): { iface: number; endpoint: number } | null {
  let fallback: { iface: number; endpoint: number } | null = null;
  for (const i of d.configuration?.interfaces ?? []) {
    for (const alt of i.alternates ?? (i.alternate ? [i.alternate] : [])) {
      const ep = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
      if (!ep) continue;
      if (alt.interfaceClass === PRINTER_CLASS) return { iface: i.interfaceNumber, endpoint: ep.endpointNumber };
      fallback ??= { iface: i.interfaceNumber, endpoint: ep.endpointNumber };
    }
  }
  return fallback;
}

/**
 * WebUSB (Chromium, secure context). Needs the OS to let the browser claim the printer: on Windows a printer with the
 * vendor driver installed is not claimable; install the WinUSB driver for it with Zadig, or use the bridge.
 */
export function createUsbTransport(env: PrintEnv, deviceHint = ""): Transport {
  const usb = env.navigator?.usb as UsbLike | undefined;
  let dev: UsbDeviceLike | null = null;
  let target: { iface: number; endpoint: number } | null = null;

  const open = async (d: UsbDeviceLike): Promise<PairedDevice> => {
    try {
      if (!d.opened) await d.open();
      if (d.configuration === null) await d.selectConfiguration(1);
      const ep = findBulkOut(d);
      if (!ep) throw new PrintError("no_endpoint", "no_bulk_out");
      await d.claimInterface(ep.iface);
      dev = d;
      target = ep;
      return { id: hint(d), name: nameOf(d) };
    } catch (err) {
      if (err instanceof PrintError) throw err;
      throw new PrintError("io", (err as Error)?.message ?? "usb_open_failed", { cause: err });
    }
  };

  return {
    kind: "usb",
    async connect(interactive) {
      if (!usb) throw new PrintError("unsupported", "no_webusb");
      if (dev?.opened && target) return { id: hint(dev), name: nameOf(dev) };
      const granted = await usb.getDevices();
      const known = granted.find((d) => hint(d) === deviceHint) ?? granted[0];
      if (known) return open(known);
      if (!interactive) throw new PrintError("not_paired");
      try {
        return await open(await usb.requestDevice({ filters: [{ classCode: PRINTER_CLASS }] }));
      } catch (err) {
        if (err instanceof PrintError) throw err;
        throw isDomAbort(err) ? new PrintError("cancelled", undefined, { cause: err }) : new PrintError("io", (err as Error)?.message, { cause: err });
      }
    },
    async write(bytes) {
      if (!dev || !target) throw new PrintError("not_paired");
      try {
        for (const part of chunk(bytes, CHUNK)) {
          const res = await dev.transferOut(target.endpoint, part as BufferSource);
          if (res.status !== "ok") throw new Error(`usb_${res.status}`);
        }
      } catch (err) {
        dev = null;
        target = null;
        throw new PrintError("io", (err as Error)?.message ?? "usb_write_failed", { cause: err });
      }
    },
    async close() {
      const d = dev;
      const t = target;
      dev = null;
      target = null;
      try {
        if (d && t) await d.releaseInterface(t.iface);
        if (d?.opened) await d.close();
      } catch {
        // already gone
      }
    },
  };
}
