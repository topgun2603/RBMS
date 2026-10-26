/**
 * Database test of the Phase 7 part B tables (migration 0047_platform_tools): the RBMS ticket series under concurrency,
 * messages, tickets waiting on RBMS, follow-up notes (newest first, at most 50), What's new publish and "seen".
 * Runs only with `AI_TEST_DATABASE_URL` (a development Postgres with 0047 applied); it copies the tables into a throw-away
 * schema and drops it.
 *   PowerShell: $env:AI_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run src/platform/platform.db.test.ts
 */
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbPlatformStore } from "./store";

const URL_ = process.env.AI_TEST_DATABASE_URL;
const SCHEMA = `platform_it_${Math.random().toString(36).slice(2, 10)}`;
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const U = "11111111-0000-4000-8000-000000000001";

describe.skipIf(!URL_)("Phase 7 part B tables on a database", () => {
  let db: Db;
  let close: () => Promise<void>;
  let store: DbPlatformStore;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", `${SCHEMA},public`);
    ({ db, close } = createDb(u.toString(), { max: 6 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of ["platform_tickets", "platform_ticket_messages", "platform_shop_followups", "platform_release_notes", "platform_release_seen"]) {
      await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    }
    store = new DbPlatformStore(db);
  });
  afterAll(async () => {
    await db?.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  const ticket = (tenantId: string, subject: string) => ({ tenantId, requesterUserId: U, requesterName: "Kumar", requesterRole: "owner", subject, body: `${subject}: details`, source: "menu" as const, screen: "/billing", question: null, appId: "BL" });

  it("numbers tickets in one series even when shops write at the same time", async () => {
    const at = new Date("2026-10-27T05:00:00Z");
    const rows = await Promise.all(Array.from({ length: 8 }, (_, i) => store.createTicket(ticket(i % 2 ? A : B, `Problem ${i}`), at)));
    expect(new Set(rows.map((r) => r.number)).size).toBe(8);
    expect(rows.map((r) => r.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const first = rows[0]!;
    const msgs = await store.messages(first.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ authorKind: "shop", kind: "reply", body: `${first.subject}: details` });
    expect((await store.shopTickets(A, null, 50)).every((t) => t.tenantId === A)).toBe(true);
    expect(await store.shopTickets(A, "22222222-0000-4000-8000-000000000001", 50)).toHaveLength(0);
  });

  it("waiting tickets per shop, filters and updates", async () => {
    const w = await store.waiting();
    expect(w.get(A)?.waiting).toBe(4);
    const [one] = await store.tickets({ tenantId: A, limit: 1 });
    await store.updateTicket(one!.id, { status: "pending", category: "printing", urgency: "high" });
    expect((await store.waiting()).get(A)?.waiting).toBe(3);
    expect(await store.tickets({ category: "printing" })).toHaveLength(1);
    expect((await store.tickets({ status: "active" })).length).toBe(8);
    expect((await store.tickets({ q: "Problem 3" }))[0]!.subject).toBe("Problem 3");
  });

  it("follow-up notes are kept newest first and capped at 50", async () => {
    for (let i = 0; i < 55; i++) await store.saveFollowup(A, i === 0 ? { contactedAt: new Date() } : {}, { at: new Date().toISOString(), by: U, byName: "Team", kind: "note", text: `n${i}` });
    const f = (await store.followups()).get(A)!;
    expect(f.notes).toHaveLength(50);
    expect(f.notes[0]!.text).toBe("n54");
    expect(f.contactedAt).not.toBeNull();
    await store.saveFollowup(A, { snoozedUntil: new Date("2026-11-01T00:00:00Z"), ignored: true }, { at: new Date().toISOString(), by: U, byName: null, kind: "snooze", text: "" });
    expect((await store.followups()).get(A)).toMatchObject({ ignored: true, snoozedUntil: new Date("2026-11-01T00:00:00Z") });
  });

  it("What's new: only published notes, newest first; seen per person", async () => {
    const d = await store.createNote({ commits: [{ sha: "abc1234", subject: "Tamil voice billing" }], source: "script", sinceRef: "v1" });
    expect(d).toMatchObject({ status: "draft", items: [], source: "script" });
    expect(await store.published(10)).toHaveLength(0);
    await store.updateNote(d.id, { status: "published", publishedAt: new Date("2026-10-27T06:00:00Z"), titleEn: "New", titleTa: "புதியவை", items: [{ id: "i1", en: "Bill by voice", ta: "குரல் பில்", apps: ["BL"], trades: [] }] });
    expect((await store.published(10))[0]!.items[0]!.en).toBe("Bill by voice");
    expect(await store.seenAt(U)).toBeNull();
    await store.markSeen(U, new Date("2026-10-27T07:00:00Z"));
    await store.markSeen(U, new Date("2026-10-27T08:00:00Z"));
    expect(await store.seenAt(U)).toEqual(new Date("2026-10-27T08:00:00Z"));
  });
});
