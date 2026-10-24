import type { PrinterConfig, TransportKind } from "../config";
import { createBluetoothTransport } from "./bluetooth";
import { createBridgeTransport, isLoopbackUrl } from "./bridge";
import { createSerialTransport } from "./serial";
import type { PrintEnv, Transport } from "./types";
import { createUsbTransport } from "./usb";

export interface TransportSupport {
  usb: boolean;
  serial: boolean;
  bluetooth: boolean;
  /** The bridge needs only fetch (and the bridge running on this PC). */
  bridge: boolean;
}

/** The real browser objects. Empty in SSR / tests that pass their own env. */
export function browserEnv(): PrintEnv {
  if (typeof navigator === "undefined") return {};
  return {
    navigator: navigator as unknown as PrintEnv["navigator"],
    fetch: typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined,
    isSecureContext: typeof window !== "undefined" ? window.isSecureContext : undefined,
  };
}

/** Which transports this browser can use. WebUSB / Serial / Bluetooth also need a secure context (https or localhost). */
export function detectSupport(env: PrintEnv = browserEnv()): TransportSupport {
  const secure = env.isSecureContext !== false;
  const nav = env.navigator;
  return {
    usb: secure && !!nav?.usb,
    serial: secure && !!nav?.serial,
    bluetooth: secure && !!nav?.bluetooth,
    bridge: !!env.fetch,
  };
}

export type SelectResult = { transport: Transport; reason?: undefined } | { transport: null; reason: "not_configured" | "unsupported" | "bridge_url_not_loopback" };

/**
 * The transport for this config, or null (with the reason) so the caller falls back to the browser's own print.
 * Never throws and never opens anything: pairing happens later, from a click.
 */
export function selectTransport(config: Pick<PrinterConfig, "transport" | "baudRate" | "bridgeUrl" | "bridgeToken" | "bridgePrinter" | "deviceHint">, env: PrintEnv = browserEnv()): SelectResult {
  const support = detectSupport(env);
  const kind: TransportKind = config.transport;
  switch (kind) {
    case "none":
      return { transport: null, reason: "not_configured" };
    case "usb":
      return support.usb ? { transport: createUsbTransport(env, config.deviceHint) } : { transport: null, reason: "unsupported" };
    case "serial":
      return support.serial ? { transport: createSerialTransport(env, config.baudRate) } : { transport: null, reason: "unsupported" };
    case "bluetooth":
      return support.bluetooth ? { transport: createBluetoothTransport(env) } : { transport: null, reason: "unsupported" };
    case "bridge":
      if (!support.bridge) return { transport: null, reason: "unsupported" };
      if (!isLoopbackUrl(config.bridgeUrl)) return { transport: null, reason: "bridge_url_not_loopback" };
      return { transport: createBridgeTransport(env, { url: config.bridgeUrl, token: config.bridgeToken, printer: config.bridgePrinter }) };
  }
}
