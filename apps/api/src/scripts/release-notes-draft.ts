/**
 * Collects the commits since a ref for a "What's new" note (docs/ai.md "Phase 7 part B"). Production has no git, so this
 * runs on a developer machine and either posts the list to the API (Platform > What's new then shows it as a draft to
 * write with AI) or saves it to a JSON file to paste or load on that page.
 *
 *   pnpm --filter @rbms/api release-notes:draft -- --since v1.4.0
 *   pnpm --filter @rbms/api release-notes:draft -- --since 565f234 --until HEAD --out notes.json
 *   RBMS_ADMIN_TOKEN=<super-admin session token> pnpm --filter @rbms/api release-notes:draft -- --since v1.4.0 --post http://127.0.0.1:4000
 *
 * Merges and housekeeping commits (chore, test, docs, ci, refactor, deps...) are left out by the same rules the API uses.
 * The token is read from the environment only and never printed.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { aiPlatform } from "@rbms/ai";

const argv = process.argv.slice(2).filter((a) => a !== "--");
const opt = (name: string) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = argv[i]!;
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[i + 1];
};

const since = opt("since");
const until = opt("until") ?? "HEAD";
if (!since) {
  console.error("Usage: release-notes:draft -- --since <ref> [--until <ref>] [--out file.json] [--post <api url>]");
  process.exit(2);
}
if (!/^[\w./~^@{}-]{1,100}$/.test(since) || !/^[\w./~^@{}-]{1,100}$/.test(until)) {
  console.error("The refs may only contain letters, digits and . / ~ ^ @ { } - _");
  process.exit(2);
}

const log = execFileSync("git", ["log", `${since}..${until}`, "--no-merges", "--format=%h%x09%ad%x09%s", "--date=short"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const commits = aiPlatform.parseCommits(log);
console.log(`${commits.length} change${commits.length === 1 ? "" : "s"} since ${since} (merges and housekeeping left out).`);
for (const c of commits.slice(0, 40)) console.log(`  ${c.sha}  ${c.subject.slice(0, 110)}`);
if (commits.length > 40) console.log(`  ... and ${commits.length - 40} more`);
if (commits.length === 0) process.exit(0);

const payload = { commits, source: "script" as const, sinceRef: since };
const post = opt("post");
if (post) {
  const token = process.env.RBMS_ADMIN_TOKEN;
  if (!token) {
    console.error("Set RBMS_ADMIN_TOKEN (a super-admin session token) to post. Nothing was sent.");
    process.exit(2);
  }
  const url = `${post.replace(/\/+$/, "")}/v1/admin/platform/release-notes`;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
  if (!res.ok) {
    console.error(`The API answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const note = (await res.json()) as { id: string };
  console.log(`Posted as a draft (${note.id}). Open Platform > What's new in the admin console, then "Write with AI".`);
} else {
  const out = resolve(opt("out") ?? join(tmpdir(), `rbms-release-commits-${new Date().toISOString().slice(0, 10)}.json`));
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(`Saved to ${out}. Load it on Platform > What's new ("Load a saved list"), or run again with --post.`);
}
