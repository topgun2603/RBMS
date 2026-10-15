// Shared helpers for the batch-3 end-to-end sections (apps/api/test/e2e/batch3.mjs runs every section in b3/).
// Same conventions as batch1/batch2/billing: real API on :4000 in development, test OTP identities, e2e shops only.
import { createServer } from "node:http";

export const API = process.env.API_URL ?? "http://localhost:4000";
export const OWNER = process.env.E2E_OWNER ?? "e2e-owner@example.com";
export const OTP = process.env.E2E_OTP ?? "123456";
/** BL shop (pro): bills, branches, e-invoice, loyalty on bills, developer, reports, WhatsApp. */
export const BILL = "e2e-bill";
/** EC shop (pro): marketplace, chat, help desk, loyalty at checkout, WhatsApp. */
export const STORE = "e2e-store";
/** BL shop (starter). */
export const LITE = "e2e-lite";
export const RUN = Date.now().toString(36).slice(-6).toUpperCase();
export const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
export const rs = (p) => `₹${(p / 100).toFixed(2)}`;

/** Unique test phone per call: +91 99990 0xxxxx (test OTP numbers). Each section passes its own block (0–9). */
let phoneSeq = Date.now() % 9000;
export function testPhone(block = 0) {
  phoneSeq = (phoneSeq + 1) % 9000;
  return `+9199990${block}${String(1000 + phoneSeq).padStart(4, "0")}`;
}

export const tokens = {};

/** Waits for /health (the dev server restarts in watch mode when files change). */
export async function waitForApi(maxMs = 60_000) {
  const until = Date.now() + maxMs;
  for (;;) {
    try {
      const r = await fetch(`${API}/health`);
      if (r.ok) return;
    } catch {
      // restarting
    }
    if (Date.now() > until) throw new Error(`API at ${API} is not up`);
    await sleep(500);
  }
}

/**
 * One request. `as` = a key of `tokens` (null = anonymous), `tenant` = x-tenant slug (null = none), `raw` = return the
 * text, `binary` = return a Buffer. Retries once on a connection error (dev server restart).
 */
export async function call(method, path, body, { as = "owner", tenant = BILL, raw = false, binary = false, headers = {} } = {}) {
  const h = { ...headers };
  const isText = typeof body === "string";
  if (body !== undefined && !isText) h["content-type"] = "application/json";
  if (as && tokens[as] && !h.authorization) h.authorization = `Bearer ${tokens[as]}`;
  if (tenant) h["x-tenant"] = tenant;
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : isText ? body : JSON.stringify(body) });
      break;
    } catch (e) {
      if (attempt >= 2) throw e;
      await waitForApi();
    }
  }
  if (binary) return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text();
  if (raw) return { status: res.status, text, headers: res.headers };
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

export const expect = (c, m) => {
  if (!c) throw new Error(m);
};
export const ok = (r, w) => {
  expect(r.status < 300, `${w}: ${r.status} ${JSON.stringify(r.json ?? r.text).slice(0, 500)}`);
  return r.json;
};
export const fails = (r, status, code, w) => {
  expect(
    r.status === status && (!code || r.json?.error?.code === code),
    `${w}: expected ${status} ${code ?? ""}, got ${r.status} ${JSON.stringify(r.json).slice(0, 400)}`,
  );
  return r.json;
};
export const eq = (a, b, w) => expect(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

/** Test identities get no message and no resend limits: request (as the apps do), then verify with the fixed code. */
export async function signIn(as, target, tenant = null, name) {
  ok(await call("POST", "/v1/auth/otp/request", { target }, { as: null, tenant }), `otp request ${target}`);
  const r = await call("POST", "/v1/auth/otp/verify", { target, code: OTP, ...(name ? { name } : {}) }, { as: null, tenant });
  expect(r.status < 300, `otp verify ${target}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)} (is TEST_OTP_CODE set for the API?)`);
  tokens[as] = r.json.token;
  return r.json.user;
}

/** Results of every section, printed by batch3.mjs. */
export const results = [];
export async function step(name, fn) {
  try {
    results.push(["PASS", name, (await fn()) ?? ""]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
}

/**
 * Tiny local HTTP receiver (webhook tests): records requests; `respond(req)` returns `{ status, body }` (default 200).
 * Resolves `{ url, requests, close, setResponder, waitFor }` once listening on a free port.
 */
export async function receiver(respond = () => ({ status: 200, body: "ok" })) {
  const requests = [];
  let responder = respond;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8"), at: Date.now() };
      requests.push(entry);
      const out = responder(entry) ?? { status: 200, body: "ok" };
      res.writeHead(out.status ?? 200, { "content-type": "text/plain" });
      res.end(out.body ?? "");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    url: `http://localhost:${port}`,
    requests,
    setResponder: (f) => (responder = f),
    close: () => new Promise((r) => server.close(() => r())),
    async waitFor(pred, ms = 15_000) {
      const until = Date.now() + ms;
      for (;;) {
        const hit = requests.find(pred);
        if (hit) return hit;
        if (Date.now() > until) throw new Error(`receiver: no matching request in ${ms} ms (got ${requests.length})`);
        await sleep(200);
      }
    },
  };
}

/**
 * Reads a Server-Sent Events stream until `until(events)` is true or `ms` pass. Returns `{ events, status, headers }`
 * (events = [{ event, data, id }], data JSON-parsed when possible). `onOpen` runs once the response headers arrive.
 */
export async function readSse(url, { headers = {}, until = () => false, ms = 10_000, onOpen } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const events = [];
  let status = 0;
  let resHeaders = null;
  try {
    const res = await fetch(url, { headers: { accept: "text/event-stream", ...headers }, signal: ctrl.signal });
    status = res.status;
    resHeaders = res.headers;
    if (!res.ok || !res.body) return { events, status, headers: resHeaders, text: await res.text().catch(() => "") };
    if (onOpen) void Promise.resolve(onOpen()).catch(() => undefined);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const e = { event: "message", data: "", id: null };
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) e.event = line.slice(6).trim();
          else if (line.startsWith("data:")) e.data += (e.data ? "\n" : "") + line.slice(5).trim();
          else if (line.startsWith("id:")) e.id = line.slice(3).trim();
        }
        if (!e.data && e.event === "message") continue; // comments / retry
        try {
          e.data = JSON.parse(e.data);
        } catch {
          // plain text
        }
        events.push(e);
        if (until(events)) {
          ctrl.abort();
          return { events, status, headers: resHeaders };
        }
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") throw e;
  } finally {
    clearTimeout(timer);
  }
  return { events, status, headers: resHeaders };
}
