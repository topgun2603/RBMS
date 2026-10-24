import { chunk, isDomAbort, PrintError, sleep, type BluetoothLike, type BtCharacteristicLike, type BtDeviceLike, type BtServerLike, type PairedDevice, type PrintEnv, type Transport } from "./types";

/** GATT services that cheap BLE thermal printers expose their write characteristic on. */
export const BLE_PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", // many 58 mm printers (char 2af1)
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC / Microchip transparent UART (Posiflex, Xprinter, ...)
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // Goojprt / PeriPage style
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
];

/** BLE writes are small; 100 bytes works on most printers that negotiate an MTU, 20 is the safe floor. */
const CHUNK = 100;
const GAP_MS = 12;

/**
 * Web Bluetooth (Chromium on Windows / Android / ChromeOS / macOS; not iOS, not Firefox). Only Bluetooth LE printers:
 * a classic (SPP) printer isn't reachable from the browser; pair it in the OS and use Web Serial or the bridge instead.
 */
export function createBluetoothTransport(env: PrintEnv): Transport {
  const bt = env.navigator?.bluetooth as BluetoothLike | undefined;
  const wait = env.delay ?? sleep;
  let device: BtDeviceLike | null = null;
  let server: BtServerLike | null = null;
  let char: BtCharacteristicLike | null = null;

  const pickCharacteristic = async (s: BtServerLike): Promise<BtCharacteristicLike | null> => {
    const services = await s.getPrimaryServices();
    let any: BtCharacteristicLike | null = null;
    for (const svc of services) {
      for (const c of await svc.getCharacteristics()) {
        if (!c.properties.write && !c.properties.writeWithoutResponse) continue;
        if (BLE_PRINTER_SERVICES.includes(svc.uuid)) return c;
        any ??= c;
      }
    }
    return any;
  };

  const attach = async (d: BtDeviceLike): Promise<PairedDevice> => {
    try {
      if (!d.gatt) throw new PrintError("no_endpoint", "no_gatt");
      server = await d.gatt.connect();
      char = await pickCharacteristic(server);
      if (!char) throw new PrintError("no_endpoint", "no_write_characteristic");
      device = d;
      return { id: d.id, name: d.name ?? "Bluetooth printer" };
    } catch (err) {
      if (err instanceof PrintError) throw err;
      throw new PrintError("io", (err as Error)?.message ?? "bluetooth_connect_failed", { cause: err });
    }
  };

  return {
    kind: "bluetooth",
    async connect(interactive) {
      if (!bt) throw new PrintError("unsupported", "no_webbluetooth");
      if (device?.gatt?.connected && char) return { id: device.id, name: device.name ?? "Bluetooth printer" };
      if (device) return attach(device); // reconnect the device paired earlier on this page
      const granted = (await bt.getDevices?.().catch(() => [])) ?? [];
      if (granted[0]) return attach(granted[0]);
      if (!interactive) throw new PrintError("not_paired");
      try {
        return await attach(await bt.requestDevice({ acceptAllDevices: true, optionalServices: BLE_PRINTER_SERVICES }));
      } catch (err) {
        if (err instanceof PrintError) throw err;
        throw isDomAbort(err) ? new PrintError("cancelled", undefined, { cause: err }) : new PrintError("io", (err as Error)?.message, { cause: err });
      }
    },
    async write(bytes) {
      if (!char) throw new PrintError("not_paired");
      try {
        const c = char;
        for (const part of chunk(bytes, CHUNK)) {
          if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) await c.writeValueWithoutResponse(part as BufferSource);
          else if (c.writeValueWithResponse) await c.writeValueWithResponse(part as BufferSource);
          else await c.writeValue?.(part as BufferSource);
          await wait(GAP_MS);
        }
      } catch (err) {
        char = null;
        throw new PrintError("io", (err as Error)?.message ?? "bluetooth_write_failed", { cause: err });
      }
    },
    async close() {
      char = null;
      try {
        server?.disconnect();
      } catch {
        // already disconnected
      }
      server = null;
    },
  };
}
