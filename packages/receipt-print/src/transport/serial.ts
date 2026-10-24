import { chunk, isDomAbort, PrintError, type PairedDevice, type PrintEnv, type SerialLike, type SerialPortLike, type Transport } from "./types";

const CHUNK = 4096;

const describe = (p: SerialPortLike): PairedDevice => {
  const info = p.getInfo?.() ?? {};
  const id = info.usbVendorId !== undefined ? `${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}` : "serial";
  return { id, name: info.usbVendorId !== undefined ? `Serial ${id}` : "Serial printer" };
};

/** Web Serial (Chromium): RS-232, USB-to-serial adapters, USB printers that show up as a COM port, Bluetooth SPP. */
export function createSerialTransport(env: PrintEnv, baudRate = 9600): Transport {
  const serial = env.navigator?.serial as SerialLike | undefined;
  let port: SerialPortLike | null = null;
  let isOpen = false;

  const open = async (p: SerialPortLike): Promise<PairedDevice> => {
    try {
      await p.open({ baudRate });
    } catch (err) {
      // Already open from an earlier session on this page: reuse it.
      if ((err as { name?: string })?.name !== "InvalidStateError") throw new PrintError("io", (err as Error)?.message ?? "serial_open_failed", { cause: err });
    }
    port = p;
    isOpen = true;
    return describe(p);
  };

  return {
    kind: "serial",
    async connect(interactive) {
      if (!serial) throw new PrintError("unsupported", "no_webserial");
      if (port && isOpen) return describe(port);
      const granted = await serial.getPorts();
      if (granted[0]) return open(granted[0]);
      if (!interactive) throw new PrintError("not_paired");
      try {
        return await open(await serial.requestPort());
      } catch (err) {
        if (err instanceof PrintError) throw err;
        throw isDomAbort(err) ? new PrintError("cancelled", undefined, { cause: err }) : new PrintError("io", (err as Error)?.message, { cause: err });
      }
    },
    async write(bytes) {
      if (!port?.writable) throw new PrintError("not_paired");
      const writer = port.writable.getWriter();
      try {
        for (const part of chunk(bytes, CHUNK)) await writer.write(part);
      } catch (err) {
        isOpen = false;
        throw new PrintError("io", (err as Error)?.message ?? "serial_write_failed", { cause: err });
      } finally {
        try {
          writer.releaseLock();
        } catch {
          // lock already lost with the port
        }
      }
    },
    async close() {
      const p = port;
      port = null;
      isOpen = false;
      try {
        await p?.close();
      } catch {
        // already closed
      }
    },
  };
}
