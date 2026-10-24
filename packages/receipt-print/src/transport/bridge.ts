import { PrintError, type PairedDevice, type PrintEnv, type Transport } from "./types";

export interface BridgeOptions {
  url: string;
  token: string;
  printer: string;
}

/** Only loopback bridge URLs are accepted: the bridge listens on 127.0.0.1 and nothing else should receive receipts. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]");
  } catch {
    return false;
  }
}

/**
 * The local print bridge (tools/print-bridge): `POST /print?printer=<name>` with the raw ESC/POS bytes and
 * `Authorization: Bearer <token>`. The bridge forwards them to its TCP 9100 or Windows / CUPS printer.
 */
export function createBridgeTransport(env: PrintEnv, o: BridgeOptions): Transport {
  const doFetch = env.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
  const base = o.url.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${o.token}` };
  let ok = false;

  return {
    kind: "bridge",
    async connect() {
      if (!doFetch) throw new PrintError("unsupported", "no_fetch");
      if (!isLoopbackUrl(o.url)) throw new PrintError("unsupported", "bridge_url_not_loopback");
      if (!o.token) throw new PrintError("not_paired", "bridge_token_missing");
      let res: Response;
      try {
        res = await doFetch(`${base}/health`, { headers });
      } catch (err) {
        throw new PrintError("bridge_unreachable", (err as Error)?.message, { cause: err });
      }
      if (res.status === 401 || res.status === 403) throw new PrintError("bridge_rejected", `bridge_${res.status}`);
      if (!res.ok) throw new PrintError("bridge_unreachable", `bridge_${res.status}`);
      ok = true;
      const dev: PairedDevice = { id: `${base}#${o.printer}`, name: `Bridge: ${o.printer}` };
      return dev;
    },
    async write(bytes) {
      if (!doFetch) throw new PrintError("unsupported", "no_fetch");
      if (!ok) throw new PrintError("not_paired");
      let res: Response;
      try {
        res = await doFetch(`${base}/print?printer=${encodeURIComponent(o.printer)}`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/octet-stream" },
          body: bytes as BodyInit,
        });
      } catch (err) {
        ok = false;
        throw new PrintError("bridge_unreachable", (err as Error)?.message, { cause: err });
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) throw new PrintError("bridge_rejected", `bridge_${res.status}`);
      if (!res.ok) throw new PrintError("io", `bridge_${res.status}`);
    },
    async close() {
      ok = false;
    },
  };
}
