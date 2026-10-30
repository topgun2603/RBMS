/**
 * Database test of `Idempotency-Key`. Runs only with `IDEMPOTENCY_TEST_DATABASE_URL` set (a development Postgres); it
 * works in a throw-away schema and drops it afterwards.
 *   PowerShell: $env:IDEMPOTENCY_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5432/srikit"; pnpm test
 */
import { AppError, emptyContext } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIdempotency, IDEMPOTENCY_STALE_MS } from "./index";

const URL_ = process.env.IDEMPOTENCY_TEST_DATABASE_URL;
const SCHEMA = `idem_it_${Math.random().toString(36).slice(2, 10)}`;
const DDL = `
create table "${SCHEMA}".idempotency_keys (scope text not null, request_hash text not null, status integer, body text,
  content_type text, created_at timestamptz not null default now());
create unique index on "${SCHEMA}".idempotency_keys (scope);
`;

describe.skipIf(!URL_)("Idempotency-Key against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let clock = Date.now();
  let runs = 0;
  let fail = false;
  let app: FastifyInstance;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(sql.raw(DDL));

    const idem = createIdempotency(db, { now: () => clock });
    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = emptyContext();
      const user = req.headers["x-user"];
      if (typeof user === "string") req.ctx.user = { id: user, sessionId: "s", platformRoles: [], tenantRoles: ["owner"] };
    });
    app.addHook("preHandler", idem.preHandler);
    app.addHook("onSend", idem.onSend);
    app.setErrorHandler((err, _req, reply) =>
      err instanceof AppError ? reply.status(err.status).send({ error: { code: err.code } }) : reply.status(500).send({ error: { code: "internal" } }),
    );
    app.post("/bills", async (req) => {
      runs++;
      if (fail) throw new AppError(400, "nope", "nope");
      return { bill: runs, body: req.body };
    });
    await app.ready();
  });
  beforeEach(async () => {
    runs = 0;
    fail = false;
    clock = Date.now();
    await db.execute(sql.raw(`delete from "${SCHEMA}".idempotency_keys`));
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  const post = (key: string | null, body: unknown = { total: 100 }, user = "u1") =>
    app.inject({ method: "POST", url: "/bills", payload: body as object, headers: { "x-user": user, ...(key ? { "idempotency-key": key } : {}) } });

  it("runs a keyed write once and replays the answer", async () => {
    const a = await post("bill-key-0001");
    const b = await post("bill-key-0001");
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.json()).toEqual(a.json());
    expect(runs).toBe(1);
  });

  it("keeps keys apart per user and leaves unkeyed writes alone", async () => {
    await post("bill-key-0002", undefined, "u1");
    await post("bill-key-0002", undefined, "u2");
    await post(null);
    await post(null);
    expect(runs).toBe(4);
  });

  it("refuses the same key with a different body", async () => {
    await post("bill-key-0003", { total: 100 });
    const r = await post("bill-key-0003", { total: 200 });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("idempotency_key_reused");
  });

  it("releases the key when the request fails, so the retry runs", async () => {
    fail = true;
    expect((await post("bill-key-0004")).statusCode).toBe(400);
    fail = false;
    expect((await post("bill-key-0004")).statusCode).toBe(200);
    expect(runs).toBe(2);
  });

  it("answers 409 while the first is running, and lets a retry take over a dead one", async () => {
    // Run it once, then make its row look like a request still in flight.
    const first = await post("bill-key-0005");
    await db.execute(sql.raw(`update "${SCHEMA}".idempotency_keys set status = null, body = null`));
    const busy = await post("bill-key-0005");
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.code).toBe("idempotency_in_progress");
    clock += IDEMPOTENCY_STALE_MS + 1000;
    const retry = await post("bill-key-0005");
    expect(retry.statusCode).toBe(200);
    expect(first.statusCode).toBe(200);
    expect(runs).toBe(2);
  });

  it("rejects a malformed key", async () => {
    const r = await post("short");
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("idempotency_key_invalid");
  });
});
