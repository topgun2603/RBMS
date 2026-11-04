// Runs the existing API flow tests through a small proxy and keeps every real request they send (out/recorded.jsonl).
// bad-data.mjs then replays those with each field corrupted, so bad values get past the outer checks into the real logic.
import { spawn } from "node:child_process";
import { createWriteStream, openSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { join } from "node:path";
import { API_PORT, OUT, qaEnv, ROOT, startApi, stopApi } from "./lib.mjs";

const PROXY_PORT = 4011;
const out = createWriteStream(join(OUT, "recorded.jsonl"));
let kept = 0;

const proxy = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const up = httpRequest({ host: "127.0.0.1", port: API_PORT, method: req.method, path: req.url, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
      if (r.statusCode < 400 && !req.url.startsWith("/health") && (req.headers["content-type"] ?? "").includes("json")) {
        const { authorization, "x-tenant": tenant, host } = req.headers;
        out.write(JSON.stringify({ method: req.method, url: req.url, status: r.statusCode, authorization, tenant, host, body: body.toString("utf8") }) + "\n");
        kept++;
      }
    });
    up.on("error", () => res.writeHead(502).end());
    up.end(body);
  });
});
await new Promise((r) => proxy.listen(PROXY_PORT, r));

await startApi();
const env = { ...qaEnv(), API_URL: `http://127.0.0.1:${PROXY_PORT}` };
const child = spawn(process.execPath, [join(ROOT, "apps/api/test/e2e/run-all.mjs")], { cwd: join(ROOT, "apps/api"), env, stdio: ["ignore", openSync(join(OUT, "e2e.log"), "w"), openSync(join(OUT, "e2e.err.log"), "w")] });
const code = await new Promise((r) => child.on("close", r));
console.log(`flow tests finished (exit ${code}); recorded ${kept} requests with a JSON body`);
proxy.close();
out.end();
stopApi();
process.exit(0);
