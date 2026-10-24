import type { PrinterConfig, TransportKind } from "../config";

export type PrintErrorCode =
  | "unsupported" // the browser has no such API (or the page is not a secure context)
  | "not_paired" // nothing was granted yet and no user gesture to ask
  | "cancelled" // the person closed the picker
  | "no_endpoint" // paired, but no usable printer interface / characteristic
  | "io" // the write failed (unplugged, powered off, out of range)
  | "bridge_unreachable"
  | "bridge_rejected"; // wrong token / origin / unknown printer

export class PrintError extends Error {
  constructor(
    readonly code: PrintErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
    this.name = "PrintError";
  }
}

/** What a transport reports after pairing, so the device config can remember it. */
export interface PairedDevice {
  id: string;
  name: string;
}

export interface Transport {
  readonly kind: Exclude<TransportKind, "none">;
  /**
   * Opens the printer. `interactive` (a user gesture, e.g. the Pair button) may show the browser's picker; otherwise
   * only devices already granted are used and `not_paired` is thrown when there is none.
   */
  connect(interactive: boolean): Promise<PairedDevice>;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** Browser objects the transports touch, injectable for tests. */
export interface PrintEnv {
  navigator?: NavigatorLike;
  fetch?: typeof fetch;
  isSecureContext?: boolean;
  delay?: (ms: number) => Promise<void>;
}

// ---- minimal structural types of WebUSB / Web Serial / Web Bluetooth (not in lib.dom for every TS version)

export interface UsbEndpointLike {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous";
}
export interface UsbAlternateLike {
  interfaceClass: number;
  endpoints: UsbEndpointLike[];
}
export interface UsbInterfaceLike {
  interfaceNumber: number;
  alternate?: UsbAlternateLike;
  alternates: UsbAlternateLike[];
}
export interface UsbDeviceLike {
  vendorId: number;
  productId: number;
  productName?: string | null;
  manufacturerName?: string | null;
  opened: boolean;
  configuration: { configurationValue: number; interfaces: UsbInterfaceLike[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string; bytesWritten: number }>;
}
export interface UsbLike {
  getDevices(): Promise<UsbDeviceLike[]>;
  requestDevice(opts: { filters: { classCode?: number; vendorId?: number }[] }): Promise<UsbDeviceLike>;
}

export interface SerialPortLike {
  open(opts: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: { getWriter(): { write(data: Uint8Array): Promise<void>; releaseLock(): void } } | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}
export interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(opts?: { filters?: unknown[] }): Promise<SerialPortLike>;
}

export interface BtCharacteristicLike {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithResponse?(v: BufferSource): Promise<void>;
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
  writeValue?(v: BufferSource): Promise<void>;
}
export interface BtServiceLike {
  uuid: string;
  getCharacteristics(): Promise<BtCharacteristicLike[]>;
}
export interface BtServerLike {
  connected: boolean;
  getPrimaryServices(): Promise<BtServiceLike[]>;
  disconnect(): void;
}
export interface BtDeviceLike {
  id: string;
  name?: string;
  gatt?: { connect(): Promise<BtServerLike>; connected: boolean; disconnect(): void };
}
export interface BluetoothLike {
  requestDevice(opts: { acceptAllDevices?: boolean; filters?: unknown[]; optionalServices: string[] }): Promise<BtDeviceLike>;
  getDevices?(): Promise<BtDeviceLike[]>;
}

export interface NavigatorLike {
  usb?: UsbLike;
  serial?: SerialLike;
  bluetooth?: BluetoothLike;
}

export type TransportConfig = Pick<PrinterConfig, "transport" | "baudRate" | "bridgeUrl" | "bridgeToken" | "bridgePrinter" | "deviceHint">;

/** Splits bytes into chunks of at most `size` (the last may be shorter). */
export function chunk(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, Math.min(bytes.length, i + size)));
  return out;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isDomAbort(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "NotFoundError" || name === "AbortError";
}
