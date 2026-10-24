#!/usr/bin/env node
// Local print bridge: forwards raw ESC/POS bytes from the web counter to a configured receipt printer.
//
// - Listens on 127.0.0.1 only (never 0.0.0.0).
// - Every request needs `Authorization: Bearer <token>` (constant-time compare).
// - Browser requests must come from an allowed origin (CORS allow-list); a request with another Origin gets 403.
// - Accepts only `GET /health` and `POST /print?printer=<name>`. The body is raw bytes and is never interpreted.
// - Printers come from the config file only: a TCP host:port (usually 9100), a Windows printer name or a CUPS queue.
//   Nothing the browser sends picks a host, a command or a file path.
// - No dependencies: Node 18+ built-ins only.
//
// Run: node bridge.mjs [path/to/config.json]      (see README.md)

import { execFile } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_BODY = 512 * 1024;
const HERE = dirname(fileURLToPath(import.meta.url));

/** Validates the config and returns a normalised copy; throws Error with a readable message. */
export function loadConfig(raw) {
  const c = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!c || typeof c !== "object") throw new Error("config must be an object");
  const token = String(c.token ?? "");
  if (token.length < 16) throw new Error('config.token must be at least 16 characters (use: node bridge.mjs --new-token)');
  const origins = Array.isArray(c.allowedOrigins) ? c.allowedOrigins.map(String) : [];
  if (origins.length === 0) throw new Error("config.allowedOrigins must list the app origins, e.g. https://acme.example.com");
  for (const o of origins) {
    let u;
    try {
      u = new URL(o);
    } catch {
      throw new Error(`allowedOrigins: not a URL: ${o}`);
    }
    if (u.origin !== o) throw new Error(`allowedOrigins entries must be bare origins (no path, no trailing slash): ${o}`);
  }
  const port = c.port === undefined ? 9101 : Number(c.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("config.port must be 1024..65535");
  const printers = {};
  for (const [name, p] of Object.entries(c.printers ?? {})) {
    if (!p || typeof p !== "object") throw new Error(`printer ${name}: object expected`);
    if (p.type === "tcp") {
      if (typeof p.host !== "string" || !p.host) throw new Error(`printer ${name}: host required`);
      const pp = p.port === undefined ? 9100 : Number(p.port);
      if (!Number.isInteger(pp) || pp < 1 || pp > 65535) throw new Error(`printer ${name}: bad port`);
      printers[name] = { type: "tcp", host: p.host, port: pp };
    } else if (p.type === "windows") {
      if (typeof p.printer !== "string" || !p.printer.trim()) throw new Error(`printer ${name}: printer (Windows printer name) required`);
      printers[name] = { type: "windows", printer: p.printer };
    } else if (p.type === "cups") {
      if (typeof p.queue !== "string" || !/^[A-Za-z0-9_.-]+$/.test(p.queue)) throw new Error(`printer ${name}: queue must be letters, digits, _ . -`);
      printers[name] = { type: "cups", queue: p.queue };
    } else {
      throw new Error(`printer ${name}: type must be tcp, windows or cups`);
    }
  }
  if (Object.keys(printers).length === 0) throw new Error("config.printers is empty");
  return { token, allowedOrigins: origins, port, printers, timeoutMs: Number(c.timeoutMs) > 0 ? Number(c.timeoutMs) : 8000 };
}

function sameToken(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Sends bytes to a TCP printer (port 9100). */
export function sendTcp({ host, port }, bytes, timeoutMs = 8000) {
  return new Promise((resolveP, reject) => {
    const sock = net.connect({ host, port });
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      err ? reject(err) : resolveP();
    };
    sock.setTimeout(timeoutMs, () => done(new Error("printer timeout")));
    sock.on("error", done);
    sock.on("connect", () => sock.end(bytes, () => setTimeout(() => done(), 150)));
  });
}

function run(file, args, timeoutMs) {
  return new Promise((resolveP, reject) => {
    // execFile: no shell, arguments are passed as an array and never concatenated into a command line.
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, _out, stderr) => (err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolveP()));
  });
}

async function withTempFile(bytes, fn) {
  const path = join(tmpdir(), `srikit-print-${randomUUID()}.bin`);
  await writeFile(path, bytes, { mode: 0o600 });
  try {
    return await fn(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}

/** Raw print to a Windows printer through the spooler (scripts/raw-print.ps1 calls winspool RAW). */
export function sendWindows({ printer }, bytes, timeoutMs = 8000) {
  const script = join(HERE, "raw-print.ps1");
  return withTempFile(bytes, (file) =>
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Printer", printer, "-File", file], timeoutMs + 4000),
  );
}

/** Raw print through CUPS: `lp -d <queue> -o raw <file>`. */
export function sendCups({ queue }, bytes, timeoutMs = 8000) {
  return withTempFile(bytes, (file) => run("lp", ["-d", queue, "-o", "raw", file], timeoutMs));
}

const defaultSenders = { tcp: sendTcp, windows: sendWindows, cups: sendCups };

/** Creates the HTTP server (not listening yet). `senders` is injectable for tests. */
export function createBridge(config, senders = defaultSenders, log = () => {}) {
  const cfg = loadConfig(config);

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = origin !== undefined && cfg.allowedOrigins.includes(origin);
    const send = (status, body, extra = {}) => {
      const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra };
      if (allowed) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Vary"] = "Origin";
      }
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };

    // A browser request from any other site is refused outright (and gets no CORS headers).
    if (origin !== undefined && !allowed) return send(403, { error: "origin_not_allowed" });

    if (req.method === "OPTIONS") {
      return send(204, {}, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "600",
      });
    }

    const auth = String(req.headers.authorization ?? "");
    if (!auth.startsWith("Bearer ") || !sameToken(auth.slice(7), cfg.token)) return send(401, { error: "unauthorized" });

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true, printers: Object.keys(cfg.printers) });

    if (req.method === "POST" && url.pathname === "/print") {
      const name = url.searchParams.get("printer") ?? "default";
      const target = Object.hasOwn(cfg.printers, name) ? cfg.printers[name] : undefined;
      if (!target) return send(404, { error: "unknown_printer" });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) return send(413, { error: "too_large" });
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length === 0) return send(400, { error: "empty" });
      try {
        await senders[target.type](target, bytes, cfg.timeoutMs);
        log(`printed ${bytes.length} bytes to ${name} (${target.type})`);
        return send(200, { ok: true, bytes: bytes.length });
      } catch (err) {
        log(`print to ${name} failed: ${err.message}`);
        return send(502, { error: "printer_error", message: String(err.message).slice(0, 200) });
      }
    }
    return send(404, { error: "not_found" });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, config: cfg };
}

/** Starts listening on 127.0.0.1. Resolves with the server. */
export function startBridge(config, senders, log = () => {}) {
  const { server, config: cfg } = createBridge(config, senders, log);
  return new Promise((resolveP, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, "127.0.0.1", () => resolveP(server));
  });
}

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  if (process.argv.includes("--new-token")) {
    console.log(randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "").slice(0, 8));
    process.exit(0);
  }
  const path = resolve(process.argv[2] ?? join(HERE, "config.json"));
  if (!existsSync(path)) {
    console.error(`No config at ${path}. Copy config.example.json to config.json and edit it.`);
    process.exit(1);
  }
  try {
    const server = await startBridge(readFileSync(path, "utf8"), defaultSenders, (m) => console.log(new Date().toISOString(), m));
    console.log(`Print bridge listening on http://127.0.0.1:${server.address().port}`);
  } catch (err) {
    console.error(`Cannot start: ${err.message}`);
    process.exit(1);
  }
}
