import type { Db } from "@rbms/db";
import { describe, expect, it, vi } from "vitest";
import { ALERT_RATE, ENQUIRY_DIGEST_JOB, MemoryWindowCounter } from "./logic";
import type { EnquiryCounterPort } from "./ports";
import { EnquiriesService } from "./service";

const T = "11111111-1111-4111-8111-111111111111";
const form = { name: "Meena", phone: "9876543210", topic: "Admission" };

/** No repeat found; each insert returns a new numbered row. */
function fakeDb() {
  let n = 0;
  const chain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy"]) q[k] = () => q;
    q.limit = async () => rows;
    q.then = (res: (v: unknown) => void) => res(rows);
    return q;
  };
  return {
    select: () => chain([]),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => undefined,
        select: () => chain([{ n }]),
        insert: () => ({
          values: (v: Record<string, unknown>) => ({
            returning: async () => [{ ...v, id: `e${++n}`, number: `ENQ-${n}`, createdAt: new Date(Date.UTC(2026, 9, 30, 10, n)) }],
          }),
        }),
      }),
  } as unknown as Db;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("public enquiry limits use the shared counter", () => {
  it("counts per visitor and per shop in the host's counter, and answers 429 when it says so", async () => {
    const keys: string[] = [];
    const counter: EnquiryCounterPort = { hit: vi.fn(async (key: string) => (keys.push(key), { count: key.startsWith("enq:v:") && keys.length > 2 ? 99 : 1, resetMs: 1000 })) };
    const service = new EnquiriesService({ db: fakeDb(), counter });
    expect(await service.submit(T, form, { ip: "203.0.113.9" })).toMatchObject({ ok: true });
    expect(keys).toEqual([`enq:v:${T}:203.0.113.9`, `enq:s:${T}`]);
    await expect(service.submit(T, form, { ip: "203.0.113.9" })).rejects.toMatchObject({ status: 429 });
  });

  it("is shared between API instances: two services on one counter add up", async () => {
    const counter = new MemoryWindowCounter();
    const a = new EnquiriesService({ db: fakeDb(), counter });
    const b = new EnquiriesService({ db: fakeDb(), counter });
    for (let i = 0; i < 3; i++) await a.submit(T, form, { ip: "203.0.113.9" });
    for (let i = 0; i < 2; i++) await b.submit(T, form, { ip: "203.0.113.9" });
    await expect(b.submit(T, form, { ip: "203.0.113.9" })).rejects.toMatchObject({ status: 429 });
  });
});

describe("owner alerts are capped per hour, then one digest", () => {
  it(`alerts the first ${ALERT_RATE.limit}, then schedules a single digest for the end of the hour`, async () => {
    const received = vi.fn(async () => undefined);
    const digest = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => undefined);
    const now = () => new Date(Date.UTC(2026, 9, 30, 10, 0));
    const service = new EnquiriesService({ db: fakeDb(), notify: { received, digest }, queue: { enqueue }, now });
    for (let i = 0; i < ALERT_RATE.limit + 5; i++) {
      await service.submit(T, { ...form, phone: `98765${String(10000 + i)}` }, { ip: `203.0.113.${i}` });
      await flush();
    }
    expect(received).toHaveBeenCalledTimes(ALERT_RATE.limit);
    expect(enqueue).toHaveBeenCalledTimes(5);
    const jobIds = new Set(enqueue.mock.calls.map((c) => (c as unknown as [string, unknown, { jobId: string }])[2].jobId));
    expect(jobIds.size).toBe(1);
    const [name, data, opts] = enqueue.mock.calls[0] as unknown as [string, { tenantId: string; since: string }, { delayMs: number }];
    expect(name).toBe(ENQUIRY_DIGEST_JOB);
    expect(data.tenantId).toBe(T);
    expect(opts.delayMs).toBe(ALERT_RATE.windowMs);
  });
});
