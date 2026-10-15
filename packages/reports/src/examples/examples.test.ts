import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { NOW, TENANT } from "../fixtures.test-helpers";
import { planReport } from "../spec";
import { paymentsDataset } from "./payments";
import { salesLinesDataset } from "./sales-lines";

const dialect = new PgDialect();

function capture() {
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = async (q: SQL) => {
    const { sql, params } = dialect.sqlToQuery(q);
    queries.push({ sql, params });
    return [];
  };
  return { queries, execute };
}

describe("example datasets", () => {
  it("sales lines: month × GST rate with jsonb lines, tenant-scoped", async () => {
    const { queries, execute } = capture();
    const ds = salesLinesDataset(execute);
    const plan = planReport(
      ds.definition,
      {
        dataset: "invoices.sales-lines",
        groupBy: ["date:month", "gstRate"],
        measures: [{ column: "taxable", fn: "sum" }, { column: "gst", fn: "sum" }],
        filters: [{ column: "item", op: "contains", value: "saree" }],
        dateRange: { preset: "this_fy" },
      },
      { now: NOW },
    );
    await ds.query(TENANT, plan);
    expect(queries[0]!.sql).toContain("FROM invoices i CROSS JOIN LATERAL jsonb_array_elements(i.lines) AS l(line) WHERE (i.tenant_id = $1 AND i.status NOT IN ('draft', 'cancelled'))");
    expect(queries[0]!.sql).toContain("GROUP BY 1, 2");
    expect(queries[0]!.params).toEqual([TENANT, "2026-04-01", "2026-10-16", "%saree%"]);
    expect(queries[1]!.sql).toMatch(/^SELECT count\(\*\) AS n, coalesce\(sum\(\(l\.line->>'taxable'\)::bigint\), 0\) AS t2/);
  });

  it("payments: timestamptz column filtered on IST boundaries", async () => {
    const { queries, execute } = capture();
    const ds = paymentsDataset(execute);
    const plan = planReport(
      ds.definition,
      { dataset: "invoices.payments", groupBy: ["method"], measures: [{ column: "amount", fn: "sum" }], filters: [{ column: "recordedAt", op: "eq", value: "2026-10-15" }] },
      { now: NOW },
    );
    await ds.query(TENANT, plan);
    expect(queries[0]!.sql).toContain("p.created_at >= $2::timestamptz AND p.created_at < $3::timestamptz");
    expect(queries[0]!.params).toEqual([TENANT, "2026-10-14T18:30:00.000Z", "2026-10-15T18:30:00.000Z"]);
  });
});
