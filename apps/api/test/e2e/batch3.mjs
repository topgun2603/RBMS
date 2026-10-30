// Batch 3 end-to-end (docs/batch3.md) against the running API (http://localhost:4000) and the real database.
//   node test/e2e/batch3.mjs        (pnpm --filter @rbms/api test:e2e:3; test:e2e:all seeds and runs every script)
//   node test/e2e/batch3.mjs chat   (only the sections whose file name contains "chat")
// The API must run in development: test OTP (TEST_OTP_CODE / TEST_OTP_TARGETS), mock payments, mock payout/KYC/
// WhatsApp/e-invoice providers and the console email driver. Shops: e2e-bill (BL, pro) and e2e-store (EC, pro) from
// `pnpm --filter @rbms/api seed:e2e`; owner e2e-owner@example.com. Every run uses fresh "E2E <run>" names and
// new +91 99990 0xxxxx test phones, so it is safe to re-run. Sections live in ./b3 and share ./b3/lib.mjs.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { results, RUN, signIn, OWNER, waitForApi } from "./b3/lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];
const sections = readdirSync(join(here, "b3"))
  .filter((f) => /^\d\d-.+\.mjs$/.test(f))
  .filter((f) => !filter || f.includes(filter))
  .sort();

await waitForApi();
await signIn("owner", OWNER);
for (const file of sections) {
  const mod = await import(pathToFileURL(join(here, "b3", file)).href);
  const before = results.length;
  try {
    await mod.default();
  } catch (e) {
    results.push(["FAIL", `${file}: section crashed`, e.stack ?? e.message]);
  }
  if (results.length === before) results.push(["FAIL", `${file}: no steps ran`, ""]);
}

console.log(`\nbatch 3 e2e run ${RUN}\n`);
for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `\n      ${String(d).replace(/\n/g, "\n      ")}` : ""}`);
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} passed`);
process.exitCode = passed === results.length ? 0 : 1;
