// Turns out/findings.json into out/report.html: one page, most serious first, with what was and wasn't reached.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT } from "./lib.mjs";

const data = JSON.parse(readFileSync(join(OUT, "findings.json"), "utf8"));
const triagePath = join(OUT, "..", "triage.json");
const triage = existsSync(triagePath) ? JSON.parse(readFileSync(triagePath, "utf8")) : [];
const read = (f) => (existsSync(join(OUT, f)) ? JSON.parse(readFileSync(join(OUT, f), "utf8")) : null);
const money = read("money.json") ?? [];
const coverage = read("coverage.json");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const KINDS = [
  ["api-down", "Took the whole API down"],
  ["crash", "Server crashed on bad data (5xx)"],
  ["hang", "Never answered"],
  ["leak", "Leaked internal details in the error"],
  ["slow", "Took over 10 seconds"],
  ["accepted", "Accepted a value it should refuse (needs a human look: some fields are ignored, not stored)"],
  ["odd", "Accepted something odd but sometimes legal (a person judges each)"],
];

const cov = Object.entries(data.coverage ?? {});
const deep = cov.filter(([, c]) => c.deep);
const reached = deep.filter(([, c]) => c.reached > 0);
const notReached = deep.filter(([, c]) => c.attempts > 0 && c.reached === 0).map(([r]) => r);
const shallow = cov.filter(([, c]) => !c.deep).map(([r]) => r);
const openWithoutSignIn = cov.filter(([r, c]) => c.anonymous >= 200 && c.anonymous < 300 && !r.startsWith("GET")).map(([r]) => r);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");

const section = (id, title) => {
  const rows = data.findings.filter((f) => f.kind === id);
  if (!rows.length) return `<h3>${esc(title)}: none</h3>`;
  const byRoute = new Map();
  for (const f of rows) byRoute.set(f.route, [...(byRoute.get(f.route) ?? []), f]);
  const body = [...byRoute.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 200)
    .map(([route, list]) => `<details><summary><code>${esc(route)}</code> <b>${list.length}</b></summary><table><tr><th>Field</th><th>Bad value</th><th>Status</th><th>Answer</th></tr>${list.slice(0, 60).map((f) => `<tr><td><code>${esc(f.field)}</code></td><td>${esc(f.label)}</td><td>${f.status}</td><td class="m">${esc(f.detail.slice(0, 200))}</td></tr>`).join("")}</table></details>`)
    .join("");
  return `<h3>${esc(title)}: ${rows.length} on ${byRoute.size} routes</h3>${body}`;
};

const triageHtml = triage.length
  ? `<h2>Confirmed by a person (reproduced by hand)</h2><table><tr><th>Severity</th><th>Problem</th><th>Where</th><th>Status</th></tr>${triage.map((t) => `<tr class="${esc(t.severity)}"><td><b>${esc(t.severity)}</b></td><td>${esc(t.problem)}</td><td><code>${esc(t.where)}</code></td><td>${esc(t.status)}</td></tr>`).join("")}</table>`
  : "";

const moneyHtml = money.length ? `<h2>Money attack: ${money.filter((m) => m.verdict === "PASS").length} of ${money.length} as expected</h2><p>Hand-written expected answers. JUDGE means either answer is defensible, so you decide.</p><table><tr><th>Result</th><th>Area</th><th>Attack</th><th>Answer</th></tr>${[...money].sort((a, b) => (a.verdict === "PASS") - (b.verdict === "PASS")).map((m) => `<tr><td><b>${esc(m.verdict)}</b></td><td>${esc(m.area)}</td><td>${esc(m.name)}</td><td class="m">${esc(m.status)} ${esc(String(m.evidence).slice(0, 90))}</td></tr>`).join("")}</table>` : "";
const covRows = coverage?.results ?? [];
const sum = (k) => covRows.reduce((s, r) => s + (r[k] ?? 0), 0);
const coverageHtml = covRows.length ? `<h2>Test coverage: ${((sum("linesCovered") / sum("linesTotal")) * 100).toFixed(1)}% of lines</h2><p>${sum("passed").toLocaleString("en-IN")} tests passed, ${sum("failed")} failed, ${sum("skipped")} skipped, database tests included. No tests at all: ${esc(coverage.untested.join(", "))}. Coverage only says code ran, not that it is right.</p><details open><summary>By package, lowest first (packages over 200 lines)</summary><table><tr><th>Package</th><th>Lines</th><th>Branches</th><th>Passed</th><th>Failed</th></tr>${covRows.filter((r) => (r.linesTotal ?? 0) > 200).sort((a, b) => a.lines - b.lines).map((r) => `<tr><td><code>${esc(r.name)}</code></td><td>${r.lines}%</td><td>${r.branches}%</td><td>${r.passed}</td><td>${r.failed}</td></tr>`).join("")}</table></details>` : "";

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RBMS bad-data report</title><style>
body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;max-width:1100px;margin-inline:auto;color:#1c1712;background:#fdfbf5}h1{margin:0 0 4px}h2{margin-top:32px;border-bottom:2px solid #1c1712;padding-bottom:4px}
.c{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.c div{background:#fff;border:1.5px solid #1c1712;border-radius:10px;padding:12px}.c b{display:block;font-size:26px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}.m{font-family:monospace;word-break:break-all}details{margin:4px 0}summary{cursor:pointer}code{font-size:12.5px;word-break:break-all}
tr.Critical td:first-child{color:#b81a12}tr.High td:first-child{color:#c2410c}</style></head><body>
<h1>RBMS bad-data report</h1><p>${esc(data.when)}, ${Math.round(data.seconds / 60)} minutes, on a throwaway copy.</p>
<div class="c"><div><b>${data.stats.requests.toLocaleString("en-IN")}</b>bad requests sent</div><div><b>${data.routes}</b>routes in the API map</div><div><b>${data.stats.crashes}</b>crashes</div><div><b>${data.stats.apiDowns}</b>API went down</div><div><b>${data.stats.hangs}</b>hangs</div><div><b>${data.stats.leaks}</b>leaks</div></div>
${triageHtml}
${moneyHtml}${coverageHtml}<h2>How far it reached</h2>
<ul><li><b>${deep.length}</b> routes had real request bodies to corrupt field by field; on <b>${reached.length}</b> (${pct(reached.length, deep.length)}) the untouched request still worked, so a refusal really was about the bad value.</li><li><b>${shallow.length}</b> routes got shallow attacks only (junk ids, junk whole bodies), because no flow test exercises them with a valid body. Bad data in their fields is <b>untested</b>.</li></ul>
<details><summary>Corrupted requests that never got past sign-in or lookups (${notReached.length})</summary><pre>${esc(notReached.join("\n"))}</pre></details>
<details><summary>Routes with shallow attacks only (${shallow.length})</summary><pre>${esc(shallow.join("\n"))}</pre></details>
<details open><summary>Changing routes that answered 2xx with no sign-in (${openWithoutSignIn.length}): check each is meant to be public</summary><pre>${esc(openWithoutSignIn.join("\n"))}</pre></details>
<h2>Raw findings</h2>${KINDS.map(([k, t]) => section(k, t)).join("")}
<h2>Not tested here</h2><ul><li>Real payments, WhatsApp, SMS, GST portal and e-invoice providers, printers and scales.</li><li>Bad data typed into screens in the browser (the server is the last line of defence, so it comes first).</li><li>The phone app.</li></ul>
</body></html>`;
writeFileSync(join(OUT, "report.html"), html);
console.log(`report: ${join(OUT, "report.html")}`);
