import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { liveCartsOf } from "./service";

describe("liveCartsOf", () => {
  it("binds the expiry cut-off as a driver value, never a raw Date (postgres-js rejects those)", () => {
    const now = new Date("2026-10-15T04:26:48.982Z");
    const q = new PgDialect().sqlToQuery(liveCartsOf("t1", "c1", now)!);
    expect(q.sql).toContain('"store_carts"."expires_at" > $3');
    expect(q.params).toEqual(["t1", "c1", "2026-10-15T04:26:48.982Z"]);
    expect(q.params.some((p) => p instanceof Date)).toBe(false);
  });
});
