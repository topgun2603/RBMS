import net from "node:net";
import { describe, expect, it } from "vitest";
import { createBridge, loadConfig, sendTcp, startBridge } from "./bridge.mjs";

const TOKEN = "0123456789abcdef0123456789abcdef";
const base = {
  token: TOKEN,
  port: 19101,
  allowedOrigins: ["https://acme.example.com"],
  printers: { default: { type: "windows", printer: "EPSON" }, lan: { type: "tcp", host: "192.168.1.50" }, q: { type: "cups", queue: "tm_t20" } },
};

async function withServer(senders, fn, cfg = base) {
  const { server } = createBridge(cfg, senders);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(url);
  } finally {
    await new Promise((r) => server.close(r));
  }
}
const auth = { Authorization: `Bearer ${TOKEN}` };
const origin = { Origin: "https://acme.example.com" };

describe("config validation", () => {
  it("accepts a good config and defaults the TCP port", () => {
    const c = loadConfig(base);
    expect(c.printers.lan).toEqual({ type: "tcp", host: "192.168.1.50", port: 9100 });
  });
  it("rejects weak tokens, missing origins, odd origins, bad printers", () => {
    expect(() => loadConfig({ ...base, token: "short" })).toThrow(/token/);
    expect(() => loadConfig({ ...base, allowedOrigins: [] })).toThrow(/allowedOrigins/);
    expect(() => loadConfig({ ...base, allowedOrigins: ["https://a.example.com/"] })).toThrow(/bare origins/);
    expect(() => loadConfig({ ...base, printers: {} })).toThrow(/empty/);
    expect(() => loadConfig({ ...base, printers: { x: { type: "shell", cmd: "calc" } } })).toThrow(/type must be/);
    expect(() => loadConfig({ ...base, printers: { x: { type: "cups", queue: "a; rm -rf /" } } })).toThrow(/queue/);
    expect(() => loadConfig({ ...base, port: 80 })).toThrow(/port/);
  });
});

describe("http behaviour", () => {
  it("requires the bearer token", async () => {
    await withServer({}, async (url) => {
      expect((await fetch(`${url}/health`)).status).toBe(401);
      expect((await fetch(`${url}/health`, { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
      const ok = await fetch(`${url}/health`, { headers: auth });
      expect(ok.status).toBe(200);
      expect((await ok.json()).printers).toEqual(["default", "lan", "q"]);
    });
  });

  it("refuses other origins and answers preflight only for allowed ones, with the private-network header", async () => {
    await withServer({}, async (url) => {
      const bad = await fetch(`${url}/health`, { headers: { ...auth, Origin: "https://evil.example" } });
      expect(bad.status).toBe(403);
      expect(bad.headers.get("access-control-allow-origin")).toBeNull();
      const pre = await fetch(`${url}/print`, { method: "OPTIONS", headers: { ...origin, "Access-Control-Request-Method": "POST" } });
      expect(pre.status).toBe(204);
      expect(pre.headers.get("access-control-allow-origin")).toBe("https://acme.example.com");
      expect(pre.headers.get("access-control-allow-private-network")).toBe("true");
      expect(pre.headers.get("access-control-allow-headers")).toContain("Authorization");
      const evilPre = await fetch(`${url}/print`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
      expect(evilPre.status).toBe(403);
    });
  });

  it("forwards the raw bytes to the named printer's sender and returns CORS headers", async () => {
    const got = [];
    const senders = {
      windows: async (t, bytes) => void got.push({ t, bytes: Array.from(bytes) }),
      tcp: async () => {},
      cups: async () => {},
    };
    await withServer(senders, async (url) => {
      const res = await fetch(`${url}/print?printer=default`, { method: "POST", headers: { ...auth, ...origin, "Content-Type": "application/octet-stream" }, body: Uint8Array.of(0x1b, 0x40, 0x1b, 0x70, 0, 25, 250) });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("https://acme.example.com");
      expect(got).toEqual([{ t: { type: "windows", printer: "EPSON" }, bytes: [0x1b, 0x40, 0x1b, 0x70, 0, 25, 250] }]);
    });
  });

  it("unknown printers (including prototype names) are 404; the page can't pick a host", async () => {
    await withServer({ windows: async () => {}, tcp: async () => assertNever(), cups: async () => {} }, async (url) => {
      for (const name of ["nope", "__proto__", "constructor", "192.168.1.9:9100"]) {
        const res = await fetch(`${url}/print?printer=${encodeURIComponent(name)}`, { method: "POST", headers: auth, body: Uint8Array.of(1) });
        expect(res.status).toBe(404);
      }
    });
  });

  it("rejects empty and oversized bodies, other paths and methods", async () => {
    await withServer({ windows: async () => {} }, async (url) => {
      expect((await fetch(`${url}/print`, { method: "POST", headers: auth, body: new Uint8Array(0) })).status).toBe(400);
      const big = await fetch(`${url}/print`, { method: "POST", headers: auth, body: new Uint8Array(600 * 1024) }).catch(() => ({ status: 413 }));
      expect(big.status).toBe(413);
      expect((await fetch(`${url}/anything`, { headers: auth })).status).toBe(404);
      expect((await fetch(`${url}/print`, { headers: auth })).status).toBe(404);
    });
  });

  it("a failing printer is a 502 with a short message", async () => {
    await withServer({ windows: async () => Promise.reject(new Error("printer offline")) }, async (url) => {
      const res = await fetch(`${url}/print`, { method: "POST", headers: auth, body: Uint8Array.of(1) });
      expect(res.status).toBe(502);
      expect((await res.json()).message).toBe("printer offline");
    });
  });

  it("startBridge binds to 127.0.0.1 only", async () => {
    const server = await startBridge({ ...base, port: 19102 }, {});
    try {
      expect(server.address().address).toBe("127.0.0.1");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("tcp sender", () => {
  it("writes the bytes to a TCP socket", async () => {
    const received = [];
    const srv = net.createServer((s) => s.on("data", (d) => received.push(...d)));
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    try {
      await sendTcp({ host: "127.0.0.1", port: srv.address().port }, Buffer.from([1, 2, 3]), 2000);
      await new Promise((r) => setTimeout(r, 50));
      expect(received).toEqual([1, 2, 3]);
    } finally {
      srv.close();
    }
  });
  it("fails fast when nothing listens", async () => {
    await expect(sendTcp({ host: "127.0.0.1", port: 1 }, Buffer.from([1]), 1000)).rejects.toBeTruthy();
  });
});

function assertNever() {
  throw new Error("sender must not be called");
}
