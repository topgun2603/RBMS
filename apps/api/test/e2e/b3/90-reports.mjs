// B5 reports: datasets, run (grouped by month, totals), CSV, saved reports, schedules + run-now email (console driver
// line in api.log), bad specs. Shop e2e-bill only; the schedule and saved report are deleted at the end.
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUN, call, eq, expect, fails, ok, sleep, step, today } from "./lib.mjs";

const LOG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "api.log");
const OWNER_EMAIL = "e2e-owner@example.com";

/** The last `bytes` of api.log (null when there is no log file). */
function tailLog(bytes = 2 * 1024 * 1024) {
  if (!existsSync(LOG)) return null;
  const fd = openSync(LOG, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

const sumOf = (rows, k) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
const monthStart = () => `${today().slice(0, 8)}01`;

export default async function () {
  const state = {};
  try {
    await body(state);
  } finally {
    if (state.scheduleId) await call("DELETE", `/v1/reports/schedules/${state.scheduleId}`).catch(() => undefined);
    if (state.savedId) await call("DELETE", `/v1/reports/saved/${state.savedId}`).catch(() => undefined);
  }
}

async function body(state) {
  await step("reports: datasets list", async () => {
    const j = ok(await call("GET", "/v1/reports/datasets"), "datasets");
    const ids = j.items.map((d) => d.id);
    for (const id of ["invoices.sales-lines", "invoices.bills", "invoices.payments", "invoices.customers"]) expect(ids.includes(id), `missing ${id} in ${ids}`);
    const sl = j.items.find((d) => d.id === "invoices.sales-lines");
    expect(sl.columns.some((c) => c.key === "taxable" && c.aggregatable), "taxable column");
    expect(sl.measures.includes("sum") && sl.dateBuckets.includes("month") && sl.datePresets.includes("this_fy"), "builder metadata");
    ok(await call("GET", "/v1/reports/datasets/invoices.sales-lines"), "get dataset");
    fails(await call("GET", "/v1/reports/datasets/nope.nothing"), 404, null, "unknown dataset");
    return ids.join(", ");
  });

  // A bill of our own so this month has rows.
  await step("reports: a bill for this month", async () => {
    const b = ok(
      await call("POST", "/v1/invoices", { customer: { name: `E2E ${RUN} reports` }, date: today(), issue: true, lines: [{ description: `E2E ${RUN} report line`, qty: 2, unit: "pcs", rate: 12345, gstRate: 12 }] }),
      "bill",
    );
    state.bill = b;
    return `${b.number} taxable ${b.totals.taxable}`;
  });

  const spec = {
    dataset: "invoices.sales-lines",
    groupBy: ["date:month"],
    measures: [
      { column: "taxable", fn: "sum" },
      { column: "total", fn: "sum" },
    ],
    dateRange: { preset: "this_fy" },
  };

  await step("reports: run grouped by month (this FY) → totals = sum of rows; this month = sales register", async () => {
    let last = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      const j = ok(await call("POST", "/v1/reports/run", spec), "run");
      eq(j.mode, "grouped", "mode");
      expect(j.rows.length >= 1 && j.totals, "no rows/totals");
      eq(j.columns.map((c) => c.key).join(","), "date,sum_taxable,sum_total", "columns");
      eq(sumOf(j.rows, "sum_taxable"), Number(j.totals.sum_taxable), "totals.sum_taxable = Σ rows");
      eq(sumOf(j.rows, "sum_total"), Number(j.totals.sum_total), "totals.sum_total = Σ rows");
      const months = j.rows.map((r) => String(r.date));
      eq(new Set(months).size, months.length, "one row per month");
      expect(j.dateRange.from.endsWith("-04-01") && j.dateRange.to === today(), `dateRange ${JSON.stringify(j.dateRange)}`);
      const cur = j.rows.find((r) => String(r.date).startsWith(today().slice(0, 7)));
      expect(cur, `no row for this month in ${months}`);
      const reg = ok(await call("GET", `/v1/invoices/reports/sales-register?from=${monthStart()}&to=${today()}`), "register");
      // Bills are made concurrently by other sections: retry until both reads see the same set.
      if (Number(cur.sum_taxable) === reg.totals.taxable) {
        expect(Number(cur.sum_taxable) >= state.bill.totals.taxable, "our bill not counted");
        return `${j.rows.length} months; this month taxable ${cur.sum_taxable} = register ${reg.totals.taxable} (${reg.totals.count} bills); FY total ${j.totals.sum_total}`;
      }
      last = `this month ${cur.sum_taxable} vs register ${reg.totals.taxable}`;
      await sleep(500);
    }
    throw new Error(`report and sales register disagree: ${last}`);
  });

  await step("reports: rows mode filtered to our bill", async () => {
    const j = ok(
      await call("POST", "/v1/reports/run", {
        dataset: "invoices.sales-lines",
        columns: ["invoiceNumber", "item", "qty", "taxable", "total"],
        filters: [{ column: "invoiceNumber", op: "eq", value: state.bill.number }],
        dateRange: { preset: "this_month" },
      }),
      "run rows",
    );
    eq(j.mode, "rows", "mode");
    eq(j.rows.length, 1, "rows");
    eq(Number(j.rows[0].taxable), state.bill.totals.taxable, "taxable");
    eq(Number(j.rows[0].qty), 2, "qty");
    eq(Number(j.totals.taxable), state.bill.totals.taxable, "totals.taxable");
  });

  await step("reports: format=csv", async () => {
    const r = await call("POST", "/v1/reports/run?format=csv", { spec, title: `E2E ${RUN} monthly` }, { raw: true });
    expect(r.status === 200, `csv ${r.status} ${r.text.slice(0, 300)}`);
    expect(/text\/csv/.test(r.headers.get("content-type") ?? ""), `content-type ${r.headers.get("content-type")}`);
    expect(/filename="e2e-[a-z0-9]+-monthly-.*\.csv"/.test(r.headers.get("content-disposition") ?? ""), `disposition ${r.headers.get("content-disposition")}`);
    const lines = r.text.replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(lines.length >= 2, `csv lines ${lines.length}`);
    expect(/Taxable/i.test(lines[0]), `header ${lines[0]}`);
    const x = await call("POST", "/v1/reports/run?format=xlsx", spec, { binary: true });
    eq(x.status, 200, "xlsx status");
    eq(x.body.subarray(0, 2).toString("latin1"), "PK", "xlsx zip magic");
    return `${lines.length} csv lines: ${lines[0]}; xlsx ${x.body.length} B`;
  });

  await step("reports: bad specs → 400", async () => {
    fails(await call("POST", "/v1/reports/run", { dataset: "invoices.sales-lines", columns: ["nope"] }), 400, null, "unknown column");
    fails(await call("POST", "/v1/reports/run", { dataset: "invoices.sales-lines", groupBy: ["item"], measures: [{ column: "customerName", fn: "sum" }] }), 400, null, "sum on text");
    fails(await call("POST", "/v1/reports/run", { dataset: "invoices.sales-lines", groupBy: ["item:month"] }), 400, null, "bucket on text");
    fails(await call("POST", "/v1/reports/run", { dataset: "invoices.sales-lines", filters: [{ column: "item", op: "gte", value: "a" }] }), 400, null, "gte on text");
    fails(await call("POST", "/v1/reports/run", { dataset: "invoices.sales-lines", columns: ["item"], extra: 1 }), 400, null, "unknown spec key");
    const r = await call("POST", "/v1/reports/run", { dataset: "nope.nothing" });
    expect(r.status === 400 || r.status === 404, `unknown dataset ${r.status}`);
  });

  await step("reports: save the report", async () => {
    const s = ok(await call("POST", "/v1/reports/saved", { name: `E2E ${RUN} monthly sales`, spec, shared: false }), "save");
    state.savedId = s.id;
    eq(s.dataset, "invoices.sales-lines", "dataset");
    const list = ok(await call("GET", "/v1/reports/saved?dataset=invoices.sales-lines"), "list saved");
    expect(list.items.some((x) => x.id === s.id), "saved not listed");
    const run = ok(await call("POST", `/v1/reports/saved/${s.id}/run`), "run saved");
    eq(run.mode, "grouped", "saved run mode");
    const p = ok(await call("PATCH", `/v1/reports/saved/${s.id}`, { description: "E2E" }), "patch");
    eq(p.description, "E2E", "description");
    fails(await call("POST", "/v1/reports/saved", { name: "bad", spec: { dataset: "invoices.sales-lines", columns: ["nope"] } }), 400, null, "save bad spec");
    return s.id;
  });

  await step("reports: schedule (weekly, csv) + run-now → emailed with attachment", async () => {
    const sch = ok(
      await call("POST", "/v1/reports/schedules", { reportId: state.savedId, preset: "weekly", weekday: 1, hour: 8, recipients: [OWNER_EMAIL], format: "csv" }),
      "schedule",
    );
    state.scheduleId = sch.id;
    eq(sch.cron, "0 8 * * 1", "cron");
    expect(new Date(sch.nextRunAt).getTime() > Date.now(), `nextRunAt ${sch.nextRunAt}`);
    fails(await call("POST", "/v1/reports/schedules", { reportId: state.savedId, preset: "hourly", recipients: [OWNER_EMAIL] }), 400, null, "bad preset");
    fails(await call("POST", "/v1/reports/schedules", { reportId: state.savedId, preset: "daily", recipients: ["not-an-email"] }), 400, null, "bad email");
    const out = ok(await call("POST", `/v1/reports/schedules/${sch.id}/run-now`), "run-now");
    eq(out.result.status, "ok", `run-now status (${out.result.error})`);
    expect(out.result.sentTo.includes(OWNER_EMAIL), `sentTo ${out.result.sentTo}`);
    eq(out.schedule.lastStatus, "ok", "lastStatus");
    eq(out.schedule.nextRunAt, sch.nextRunAt, "next run unchanged");
    const slug = `e2e-${RUN.toLowerCase()}-monthly-sales-`;
    const log = tailLog();
    if (log === null) return `rows ${out.result.rowCount}; sent to ${out.result.sentTo} — api.log not found at ${LOG}, email line not checked`;
    let hit = null;
    for (let i = 0; i < 20 && !hit; i++) {
      const text = i === 0 ? log : tailLog();
      hit = text
        .split(/\r?\n/)
        .find((l) => l.includes(`[notify:console] email → ${OWNER_EMAIL}`) && l.includes(`(attachments: ${slug}`) && /\.csv \d+ B\)/.test(l));
      if (!hit) await sleep(250);
    }
    expect(hit, `no console email line for ${slug}*.csv in api.log`);
    return `rows ${out.result.rowCount}; ${hit.replace(/^.*\[notify:console\]/, "[notify:console]").trim()}`;
  });
}
