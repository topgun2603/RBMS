#!/usr/bin/env node
// Restore drill: back up the database, restore it into a fresh "<db>_restore" database on the same server, check that
// the copy matches, print a report and drop the copy. Exit 0 = the backup is restorable. See docs/ops.md.
//
//   node scripts/ops/restore-drill.mjs [--url <source-url>] [--restore-db srikit_restore] [--keep] [--keep-dump]
//                                      [--docker|--local] [--json]
//
// Row counts are compared exactly: they are taken inside the same exported snapshot that pg_dump uses, so writes
// made by a running API during the drill don't cause false mismatches.
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fmtBytes, fmtMs, loadEnv, parseArgs, pgTarget, sqlClient } from "./lib/common.mjs";
import { dumpDatabase } from "./lib/backup.mjs";
import { assertRestoreTarget, dropDatabase, prepareDatabase, restoreDump } from "./lib/restore.mjs";

loadEnv();
const { flags } = parseArgs(process.argv.slice(2), ["keep", "keep-dump", "docker", "local", "json", "help"]);
if (flags.help) {
  console.log("usage: node scripts/ops/restore-drill.mjs [--url URL] [--restore-db NAME_restore] [--keep] [--keep-dump] [--docker|--local] [--json]");
  process.exit(0);
}
const sourceUrl = flags.url ?? process.env.DATABASE_URL;
if (!sourceUrl) {
  console.error("DATABASE_URL is not set (and no --url given)");
  process.exit(2);
}
const tool = flags.docker ? "docker" : flags.local ? "local" : "auto";
const source = pgTarget(sourceUrl);
const restoreDb = flags["restore-db"] ?? `${source.database}_restore`;
assertRestoreTarget(restoreDb, false);
const restoreUrl = source.withDatabase(restoreDb);
const log = flags.json ? () => {} : (s) => console.log(`[drill] ${s}`);

/** Tables the report always lists (when they exist). */
const KEY_TABLES = ["tenants", "users", "tenant_memberships", "invoices", "orders", "catalog_products", "audit_events", "plans", "subscriptions"];

/** Every user table (schema-qualified) with an exact row count, the migrations and a sample tenant. */
async function inspect(sql, sampleTenantId) {
  const tables = await sql`
    select table_schema as schema, table_name as name
    from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
    order by 1, 2`;
  const counts = {};
  for (const t of tables) {
    const [{ n }] = await sql.unsafe(`select count(*)::bigint as n from "${t.schema}"."${t.name}"`);
    counts[`${t.schema}.${t.name}`] = Number(n);
  }
  const hasMigrations = tables.some((t) => t.schema === "drizzle" && t.name === "__drizzle_migrations");
  const migrations = hasMigrations ? await sql`select hash, created_at::text as created_at from drizzle.__drizzle_migrations order by id` : [];

  let tenant = null;
  const hasTenants = tables.some((t) => t.schema === "public" && t.name === "tenants");
  if (hasTenants) {
    const rows = sampleTenantId
      ? await sql`select row_to_json(t)::text as json, t.id::text as id, t.slug from tenants t where t.id = ${sampleTenantId}`
      : await sql`select row_to_json(t)::text as json, t.id::text as id, t.slug from tenants t order by created_at, id limit 1`;
    if (rows[0]) {
      // Rows of that tenant in every tenant-scoped table.
      const scoped = await sql`
        select c.table_schema as schema, c.table_name as name from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
        where c.column_name = 'tenant_id' and c.table_schema = 'public' order by 2`;
      const perTable = {};
      for (const s of scoped) {
        const [{ n }] = await sql.unsafe(`select count(*)::bigint as n from "${s.schema}"."${s.name}" where tenant_id = $1`, [rows[0].id]);
        if (Number(n) > 0) perTable[s.name] = Number(n);
      }
      tenant = { id: rows[0].id, slug: rows[0].slug, json: rows[0].json, perTable };
    }
  }
  return { counts, migrations, tenant };
}

function compare(a, b) {
  const problems = [];
  const names = new Set([...Object.keys(a.counts), ...Object.keys(b.counts)]);
  let matched = 0;
  for (const n of [...names].sort()) {
    if (!(n in b.counts)) problems.push(`table ${n} missing in the restore`);
    else if (!(n in a.counts)) problems.push(`table ${n} only in the restore`);
    else if (a.counts[n] !== b.counts[n]) problems.push(`table ${n}: ${a.counts[n]} rows in the source, ${b.counts[n]} in the restore`);
    else matched++;
  }
  const migOk = JSON.stringify(a.migrations) === JSON.stringify(b.migrations);
  if (!migOk) problems.push(`migrations differ: ${a.migrations.length} in the source, ${b.migrations.length} in the restore`);
  let tenantOk = true;
  if (a.tenant) {
    if (!b.tenant) tenantOk = false;
    else if (a.tenant.json !== b.tenant.json) tenantOk = false;
    else if (JSON.stringify(a.tenant.perTable) !== JSON.stringify(b.tenant.perTable)) tenantOk = false;
    if (!tenantOk) problems.push(`sample tenant ${a.tenant.slug} (${a.tenant.id}) reads differently in the restore`);
  }
  return { problems, matched, tables: names.size, migOk, tenantOk };
}

const t0 = Date.now();
const timings = {};
let dump;
let ok = false;
let report;
try {
  log(`source  ${source.display}`);
  log(`restore ${pgTarget(restoreUrl).display}`);

  // 1. Snapshot + counts + dump of exactly that snapshot.
  const src = await sqlClient(sourceUrl);
  let before;
  try {
    await src.begin("isolation level repeatable read read only", async (tx) => {
      const [{ snap }] = await tx`select pg_export_snapshot() as snap`;
      let t = Date.now();
      before = await inspect(tx);
      timings.inspectSource = Date.now() - t;
      t = Date.now();
      // The transaction stays open while pg_dump runs, so the snapshot stays importable.
      dump = await dumpDatabase({ url: sourceUrl, dir: join(tmpdir(), "srikit-drill"), snapshot: snap, tool, log });
      timings.dump = Date.now() - t;
    });
  } finally {
    await src.end();
  }

  // 2. Fresh restore database + restore.
  let t = Date.now();
  await prepareDatabase(restoreUrl, { fresh: true, log });
  const restored = await restoreDump({ file: dump.file, url: restoreUrl, tool, log });
  timings.restore = Date.now() - t;

  // 3. Same inspection on the copy (same sample tenant).
  const dst = await sqlClient(restoreUrl);
  let after;
  try {
    t = Date.now();
    after = await inspect(dst, before.tenant?.id);
    timings.inspectRestore = Date.now() - t;
  } finally {
    await dst.end();
  }

  const cmp = compare(before, after);
  ok = cmp.problems.length === 0;
  const key = KEY_TABLES.map((n) => `public.${n}`).filter((n) => n in before.counts);
  const totalRows = Object.values(before.counts).reduce((s, n) => s + n, 0);
  report = {
    ok,
    source: source.database,
    restoreDb,
    dump: { name: dump.name, size: dump.size, sha256: dump.sha256, how: dump.how },
    restoreHow: restored.how,
    tables: cmp.tables,
    tablesMatched: cmp.matched,
    totalRows,
    keyTables: Object.fromEntries(key.map((n) => [n, { source: before.counts[n], restore: after.counts[n] }])),
    migrations: { source: before.migrations.length, restore: after.migrations.length, match: cmp.migOk },
    sampleTenant: before.tenant
      ? { slug: before.tenant.slug, id: before.tenant.id, rowMatch: cmp.tenantOk, tenantRows: before.tenant.perTable }
      : null,
    problems: cmp.problems,
    timings,
  };
} catch (err) {
  report = { ok: false, error: err.message, timings };
} finally {
  if (!flags.keep) {
    try {
      await dropDatabase(restoreUrl);
      log(`dropped ${restoreDb}`);
    } catch (e) {
      log(`could not drop ${restoreDb}: ${e.message}`);
    }
  }
  if (dump && !flags["keep-dump"]) await rm(dump.file, { force: true });
}
report.totalMs = Date.now() - t0;

if (flags.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const line = "─".repeat(64);
  console.log(`\n${line}\nRESTORE DRILL ${report.ok ? "PASSED" : "FAILED"}  (${new Date().toISOString()})\n${line}`);
  if (report.error) console.log(`error: ${report.error}`);
  if (report.dump) {
    console.log(`source db        ${report.source}  →  ${report.restoreDb} (dropped after the drill${flags.keep ? ": no, --keep" : ""})`);
    console.log(`dump             ${report.dump.name}  ${fmtBytes(report.dump.size)}  via ${report.dump.how}  sha256 ${report.dump.sha256.slice(0, 16)}…`);
    console.log(`tables           ${report.tablesMatched}/${report.tables} row counts match  (${report.totalRows} rows in total)`);
    console.log(`migrations       ${report.migrations.source} in source, ${report.migrations.restore} in restore  ${report.migrations.match ? "match" : "MISMATCH"}`);
    if (report.sampleTenant) {
      const rows = Object.entries(report.sampleTenant.tenantRows).map(([k, v]) => `${k}=${v}`);
      console.log(`sample tenant    ${report.sampleTenant.slug} (${report.sampleTenant.id})  ${report.sampleTenant.rowMatch ? "reads identically" : "DIFFERS"}`);
      console.log(`                 rows in ${rows.length} tenant tables: ${rows.slice(0, 8).join(", ")}${rows.length > 8 ? ", …" : ""}`);
    }
    console.log("key tables       source / restore");
    for (const [n, c] of Object.entries(report.keyTables)) console.log(`  ${n.padEnd(28)} ${String(c.source).padStart(7)} / ${String(c.restore).padStart(7)}${c.source === c.restore ? "" : "  MISMATCH"}`);
    for (const p of report.problems) console.log(`PROBLEM: ${p}`);
  }
  const tm = report.timings;
  console.log(
    `timings          dump ${fmtMs(tm.dump ?? 0)}, restore ${fmtMs(tm.restore ?? 0)}, checks ${fmtMs((tm.inspectSource ?? 0) + (tm.inspectRestore ?? 0))}, total ${fmtMs(report.totalMs)}`,
  );
  console.log(line);
}
process.exit(report.ok ? 0 : 1);
