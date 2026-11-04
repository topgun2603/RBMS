// Attacks the API with bad data, on the throwaway QA stack only. Three passes:
//  1. Every recorded real request, replayed with each field corrupted one at a time.
//  2. Every route in the API's own map: junk in the URL ids and search parameters, junk as the whole body, no sign-in.
//  3. Malformed requests: broken JSON, wrong content type, a body over the limit.
// A crash (5xx), a hang, a leaked internal detail or an accepted bad value becomes a finding. Results: out/findings.json.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, apiUp, OUT, ownerToken, readJsonl, startApi, stopApi, TENANT } from "./lib.mjs";

const CONCURRENCY = 8;
const TIMEOUT_MS = 30_000;
const SAMPLES_PER_ROUTE = 2;
const MAX_FIELDS = 40;
const INFINITY = "__QA_INFINITY__";

const long = (n) => "x".repeat(n);
const NUMBER_BAD = [
  ["letters", "abc"], ["digits+letters", "12abc"], ["empty text", ""], ["space", " "], ["null", null], ["true", true], ["empty list", []], ["empty object", {}], ["list", [1]],
  ["negative", -1], ["small negative", -0.01], ["zero", 0], ["tiny fraction", 0.001], ["too many decimals", 1.23456789],
  ["number as text", "100"], ["exponent text", "1e5"], ["Tamil/Arabic digits", "١٢٣"], ["rupee sign", "₹100"], ["comma", "1,000"], ["NaN text", "NaN"], ["Infinity text", "Infinity"],
  ["huge", 1e21], ["past safe integer", 9007199254740993], ["past int4", 2147483648], ["max double", 1e308], ["-max double", -1e308], ["overflows to Infinity", INFINITY],
];
const STRING_BAD = [
  ["empty", ""], ["spaces only", "   "], ["null", null], ["number", 123], ["true", true], ["list", []], ["object", {}],
  ["100k characters", long(100_000)], ["null byte", "a\u0000b"], ["lone surrogate", "a\ud800b"], ["emoji", "🧾🔥"], ["right-to-left override", "‮abc"],
  ["script tag", "<script>alert(1)</script>"], ["SQL injection", "' OR '1'='1"], ["SQL drop", "'; DROP TABLE tenants;--"], ["path traversal", "../../etc/passwd"], ["template", "${7*7}{{7*7}}"], ["formula", "=HYPERLINK(\"http://x\")"], ["newlines", "a\r\nX-Injected: 1"],
];
const DATE_BAD = [["month 13", "2026-13-45"], ["zero date", "0000-00-00"], ["year 9999", "9999-12-31"], ["year 1900", "1900-01-01"], ["feb 30", "2026-02-30"], ["words", "yesterday"], ["number", 0]];
const ID_BAD = [["not an id", "not-a-uuid"], ["zero id", "00000000-0000-0000-0000-000000000000"], ["unknown id", "7f3c1d52-9a0e-4b7a-8c11-2d4e6f8a9b10"], ["number", 1]];
const CONTACT_BAD = [["letters", "abcdef"], ["too short", "12"], ["too long", "+9199999999999999999"], ["no @", "a.example.com"]];
const BOOL_BAD = [["text", "yes"], ["number", 1], ["null", null], ["list", []]];
const LIST_BAD = [["empty", []], ["null", null], ["text", "x"], ["object", {}], ["10k items", Array.from({ length: 10_000 }, () => 1)], ["list of nulls", [null, null]]];
const OBJECT_BAD = [["null", null], ["list", []], ["text", "x"], ["empty", {}], ["proto pollution", JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}}}')]];

const WHOLE_BODY_BAD = [["null", "null"], ["list", "[]"], ["number", "123"], ["text", '"abc"'], ["empty object", "{}"], ["list of objects", "[{}]"], ["deep nesting", "[".repeat(5000) + "]".repeat(5000)], ["proto pollution", '{"__proto__":{"isAdmin":true}}']];
const PATH_BAD = [["letters", "abc"], ["negative", "-1"], ["zero", "0"], ["huge", "99999999999999999999999"], ["exponent", "1e309"], ["zero id", "00000000-0000-0000-0000-000000000000"], ["SQL injection", "' OR '1'='1"], ["traversal", "../../etc/passwd"], ["null byte", "a\u0000b"], ["script", "<script>"], ["emoji", "🧾"], ["5k characters", long(5000)]];
const QUERY_BAD = [["negative", "-1"], ["letters", "abc"], ["huge", "99999999999999999999"], ["SQL injection", "' OR 1=1--"], ["null byte", "a\u0000b"], ["bad date", "2026-13-45"], ["5k characters", long(5000)], ["proto", "__proto__"]];
const QUERY_NAMES = ["page", "limit", "offset", "q", "from", "to", "sort", "status", "cursor", "id"];

/** Skipped from replay: they end the session this run depends on, or wipe the shops it tests. */
const SKIP = /\/auth\/(logout|sessions)|\/account\/delete|\/privacy\/.*erase|\/tenants\/[^/]+\/(delete|erase)|\/devices\/revoke/;

const ID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const templateOf = (url) => url.split("?")[0].replace(ID_RE, ":id").replace(/\/\d+(?=\/|$)/g, "/:n");

function badValuesFor(name, value) {
  if (typeof value === "number") return NUMBER_BAD;
  if (typeof value === "boolean") return BOOL_BAD;
  if (Array.isArray(value)) return LIST_BAD;
  if (value && typeof value === "object") return OBJECT_BAD;
  if (typeof value !== "string") return STRING_BAD.slice(0, 7);
  if (ID_RE.test(value)) {
    ID_RE.lastIndex = 0;
    return [...ID_BAD, ...STRING_BAD.slice(8, 10)];
  }
  ID_RE.lastIndex = 0;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return [...DATE_BAD, ...STRING_BAD.slice(8, 10)];
  if (/phone|mobile|email|gstin|pincode|pan$|upi|hsn/i.test(name)) return [...CONTACT_BAD, ...STRING_BAD];
  return STRING_BAD;
}

/** Every leaf (and list / object) in a body as a path: lines.0.qty. Only the first item of a list is walked. */
function fieldsOf(value, path = []) {
  const out = [];
  if (Array.isArray(value)) {
    out.push(path);
    if (value.length) out.push(...fieldsOf(value[0], [...path, 0]));
  } else if (value && typeof value === "object") {
    if (path.length) out.push(path);
    for (const k of Object.keys(value)) out.push(...fieldsOf(value[k], [...path, k]));
  } else out.push(path);
  return out;
}
const getAt = (o, p) => p.reduce((v, k) => v?.[k], o);
function setAt(o, p, v) {
  const copy = structuredClone(o);
  let cur = copy;
  for (const k of p.slice(0, -1)) cur = cur[k];
  cur[p[p.length - 1]] = v;
  return copy;
}

const findings = new Map();
const stats = { requests: 0, crashes: 0, hangs: 0, leaks: 0, accepted: 0, odd: 0, apiDowns: 0, baselineOk: 0, baselineFailed: 0 };
const coverage = new Map();
const LEAK = /node_modules|\.tsx?:\d+|\bat async\b|relation "|syntax error at|violates |column "|drizzle|invalid input syntax|PostgresError|ECONNREFUSED/i;

function note(kind, route, field, label, status, sample, detail) {
  const key = `${kind}|${route}|${field}|${label}`;
  if (findings.has(key)) return (findings.get(key).count += 1);
  findings.set(key, { kind, route, field, label, status, sample: String(sample ?? "").slice(0, 300), detail: String(detail ?? "").slice(0, 400), count: 1 });
}

let token = "";
let queue = Promise.resolve();
/** One request. Re-signs in on an expired owner token; a dead API is restarted and the killing request recorded. */
async function send({ method, path, headers = {}, rawBody, route, field, label, expectReject = false, odd = false, sample }) {
  stats.requests++;
  const started = Date.now();
  let res, text;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: rawBody, signal: AbortSignal.timeout(TIMEOUT_MS) });
    text = await res.text();
  } catch (e) {
    if (e.name === "TimeoutError") {
      stats.hangs++;
      note("hang", route, field, label, 0, sample, `no answer in ${TIMEOUT_MS / 1000} s`);
      return { status: 0 };
    }
    if (await apiUp()) return { status: 0 };
    stats.apiDowns++;
    note("api-down", route, field, label, 0, sample, e.cause?.message ?? e.message);
    queue = queue.then(startApi);
    await queue;
    return { status: 0 };
  }
  if (res.status >= 500 && res.status !== 503 && res.status !== 501) {
    stats.crashes++;
    note("crash", route, field, label, res.status, sample, text);
  } else if (res.status < 500 && res.status >= 400 && LEAK.test(text)) {
    stats.leaks++;
    note("leak", route, field, label, res.status, sample, text);
  } else if (res.ok && expectReject) {
    stats.accepted++;
    note("accepted", route, field, label, res.status, sample, text);
  } else if (res.ok && odd) {
    stats.odd++;
    note("odd", route, field, label, res.status, sample, text);
  }
  if (Date.now() - started > 10_000) note("slow", route, field, label, res.status, sample, `${Date.now() - started} ms`);
  return { status: res.status, text };
}

async function pool(tasks) {
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < tasks.length) await tasks[i++]();
    }),
  );
}

/** Odd but sometimes legal: accepted ones are listed for a person to judge (a negative quantity on a bill is not fine; a negative stock adjustment might be). */
const ODD = new Set(["negative", "small negative", "zero", "tiny fraction", "too many decimals", "number as text", "exponent text", "spaces only", "empty", "empty text", "space", "script tag", "SQL injection", "null", "year 1900", "year 9999", "too short", "too long", "no @", "right-to-left override"]);

/** Names and codes must be unique on many routes: without this a replay is refused as a duplicate and the bad value is never judged. */
let uniq = 0;
function freshen(v, key = "") {
  if (Array.isArray(v)) return v.map((x) => freshen(x, key));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, freshen(x, k)]));
  if (typeof v === "string" && /^(slug|sku|barcode|code|name|title|handle|number|key|email)$/i.test(key)) {
    const tag = (++uniq).toString(36);
    return key === "email" ? v.replace("@", `+q${tag}@`) : `${v.slice(0, 40)}-q${tag}`.toLowerCase();
  }
  return v;
}

/** A number field that was given something that isn't a usable number, a text field given the wrong type: accepting these is wrong. */
const MUST_REJECT = new Set(["letters", "digits+letters", "empty list", "empty object", "list", "NaN text", "Infinity text", "overflows to Infinity", "huge", "max double", "-max double", "past safe integer", "rupee sign", "comma", "Tamil/Arabic digits", "month 13", "zero date", "feb 30", "words", "not an id", "10k items", "100k characters"]);

// ---------------------------------------------------------------- 1. corrupt each field of recorded requests
async function replayPass() {
  const recorded = readJsonl(join(OUT, "recorded.jsonl"));
  const byRoute = new Map();
  for (const r of recorded) {
    let body;
    try {
      body = r.body ? JSON.parse(r.body) : undefined;
    } catch {
      continue;
    }
    if (!body || typeof body !== "object" || !["POST", "PUT", "PATCH"].includes(r.method)) continue;
    const route = `${r.method} ${templateOf(r.url)}`;
    if (SKIP.test(route)) continue;
    const list = byRoute.get(route) ?? [];
    list.push({ ...r, parsed: body, size: JSON.stringify(body).length });
    byRoute.set(route, list);
  }
  const tasks = [];
  for (const [route, list] of byRoute) {
    coverage.set(route, { deep: true, fields: 0, reached: 0, attempts: 0 });
    const samples = list.sort((a, b) => b.size - a.size).slice(0, SAMPLES_PER_ROUTE);
    for (const s of samples) {
      const headers = { "content-type": "application/json", ...(s.tenant ? { "x-tenant": s.tenant } : {}), ...(s.authorization ? { authorization: s.authorization } : {}), ...(s.host ? { "x-forwarded-host": s.host } : {}) };
      // Baseline: the untouched request must still work, or a refusal says nothing about the bad value.
      tasks.push(async () => {
        let hdrs = { ...headers };
        let r = await fetch(`${API}${s.url}`, { method: s.method, headers: { ...hdrs, "idempotency-key": `qa-b-${uniq++}` }, body: JSON.stringify(freshen(s.parsed)) }).catch(() => ({ status: 0 }));
        if (r.status === 401 && s.authorization) {
          s.useOwner = true;
          hdrs = { ...hdrs, authorization: `Bearer ${token}` };
          r = await fetch(`${API}${s.url}`, { method: s.method, headers: { ...hdrs, "idempotency-key": `qa-b-${uniq++}` }, body: JSON.stringify(freshen(s.parsed)) }).catch(() => ({ status: 0 }));
        }
        const ok = r.status >= 200 && r.status < 300;
        ok ? stats.baselineOk++ : stats.baselineFailed++;
        const c = coverage.get(route);
        c.baseline = Math.max(c.baseline ?? 0, r.status);
        c.baselineOk = c.baselineOk || ok;
      });
      const fields = fieldsOf(s.parsed).slice(0, MAX_FIELDS);
      coverage.get(route).fields = Math.max(coverage.get(route).fields, fields.length);
      for (const p of fields) {
        const fieldName = p.join(".") || "(root)";
        const current = p.length ? getAt(s.parsed, p) : s.parsed;
        for (const [label, bad] of badValuesFor(String(p[p.length - 1] ?? ""), current)) {
          tasks.push(async () => {
            const fresh = freshen(s.parsed);
            const mutated = p.length ? setAt(fresh, p, bad) : bad;
            const rawBody = JSON.stringify(mutated).replace(`"${INFINITY}"`, "1e400");
            const r = await send({ method: s.method, path: s.url, headers: { ...headers, ...(s.useOwner ? { authorization: `Bearer ${token}` } : {}), "idempotency-key": `qa-${stats.requests}` }, rawBody, route, field: fieldName, label, expectReject: MUST_REJECT.has(label) && typeof current !== "object", odd: ODD.has(label), sample: rawBody });
            const c = coverage.get(route);
            c.attempts++;
            if (r.status && ![401, 402, 403, 404].includes(r.status) && c.baselineOk) c.reached++;
          });
        }
      }
    }
  }
  console.log(`pass 1: ${byRoute.size} routes with real bodies, ${tasks.length} corrupted requests`);
  await pool(tasks);
}

// ---------------------------------------------------------------- 2. every route: bad ids, bad search params, bad whole bodies, no sign-in
async function sweepPass(routes) {
  const auth = () => ({ authorization: `Bearer ${token}`, "x-tenant": TENANT });
  const tasks = [];
  for (const { method, path } of routes) {
    const route = `${method} ${path}`;
    if (SKIP.test(route)) continue;
    if (!coverage.has(route)) coverage.set(route, { deep: false, fields: 0, reached: 0, attempts: 0 });
    const params = [...path.matchAll(/:(\w+)/g)].map((m) => m[1]);
    const fill = (name, value) => path.replace(/:(\w+)/g, (_, n) => (n === name ? encodeURIComponent(value) : "00000000-0000-0000-0000-000000000000"));
    for (const name of params) for (const [label, bad] of PATH_BAD) tasks.push(() => send({ method, path: fill(name, bad), headers: auth(), route, field: `url :${name}`, label, sample: bad.slice(0, 80) }));
    const plain = fill("", "");
    if (method === "GET") {
      for (const q of QUERY_NAMES) for (const [label, bad] of QUERY_BAD) tasks.push(() => send({ method, path: `${plain}?${q}=${encodeURIComponent(bad)}`, headers: auth(), route, field: `?${q}`, label, sample: bad.slice(0, 80) }));
    } else if (method !== "DELETE") {
      for (const [label, raw] of WHOLE_BODY_BAD) tasks.push(() => send({ method, path: plain, headers: { ...auth(), "content-type": "application/json" }, rawBody: raw, route, field: "(whole body)", label, sample: raw.slice(0, 80) }));
    }
    // No sign-in at all: a protected route must say so, not crash.
    tasks.push(async () => {
      const r = await send({ method, path: plain, headers: method === "GET" || method === "DELETE" ? {} : { "content-type": "application/json" }, rawBody: method === "GET" || method === "DELETE" ? undefined : "{}", route, field: "(no sign-in)", label: "anonymous", sample: "" });
      coverage.get(route).anonymous = r.status;
    });
  }
  console.log(`pass 2: ${routes.length} routes, ${tasks.length} requests`);
  await pool(tasks);
}

// ---------------------------------------------------------------- 3. malformed requests
async function malformedPass() {
  const auth = { authorization: `Bearer ${token}`, "x-tenant": TENANT };
  const route = "POST /v1/invoices";
  const tries = [
    ["broken JSON", '{"a":', { "content-type": "application/json" }],
    ["not JSON", "hello", { "content-type": "application/json" }],
    ["form body", "a=1", { "content-type": "application/x-www-form-urlencoded" }],
    ["xml", "<a/>", { "content-type": "application/xml" }],
    ["2 MB body", `{"a":"${long(2_000_000)}"}`, { "content-type": "application/json" }],
    ["bad tenant", "{}", { "content-type": "application/json", "x-tenant": "' OR 1=1--" }],
    ["unknown tenant", "{}", { "content-type": "application/json", "x-tenant": "no-such-shop" }],
    ["bad token", "{}", { "content-type": "application/json", authorization: "Bearer not-a-token" }],
    ["token with SQL", "{}", { "content-type": "application/json", authorization: "Bearer ' OR 1=1--" }],
  ];
  for (const [label, rawBody, h] of tries) await send({ method: "POST", path: "/v1/invoices", headers: { ...auth, ...h }, rawBody, route, field: "(request)", label, sample: label });
}

await startApi();
token = await ownerToken();
const spec = await (await fetch(`${API}/v1/developer/openapi.json`, { headers: { authorization: `Bearer ${token}`, "x-tenant": TENANT } })).json();
const routes = [];
for (const [path, ops] of Object.entries(spec.paths ?? {})) {
  for (const method of Object.keys(ops)) {
    if (["get", "post", "put", "patch", "delete"].includes(method)) routes.push({ method: method.toUpperCase(), path: path.replace(/\{(\w+)\}/g, ":$1") });
  }
}
console.log(`API map: ${routes.length} routes`);

const started = Date.now();
const only = process.argv[2];
if (!only || only === "1") await replayPass();
token = await ownerToken();
if (!only || only === "2") await sweepPass(routes);
token = await ownerToken();
if (!only || only === "3") await malformedPass();

writeFileSync(join(OUT, "findings.json"), JSON.stringify({ when: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), stats, routes: routes.length, coverage: Object.fromEntries(coverage), findings: [...findings.values()] }, null, 1));
console.log(JSON.stringify(stats), `findings: ${findings.size}`);
stopApi();
process.exit(0);
