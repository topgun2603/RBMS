import { describe, expect, it } from "vitest";
import { backupName, parseBackupDate, planRetention, stamp } from "./retention.mjs";

const at = (iso) => backupName("srikit", new Date(iso));

describe("backup names", () => {
  it("round-trips the dump time", () => {
    const d = new Date("2026-10-16T06:30:05Z");
    expect(stamp(d)).toBe("20261016T063005Z");
    expect(backupName("srikit", d)).toBe("srikit-20261016T063005Z.dump.gz");
    expect(parseBackupDate("db/srikit-20261016T063005Z.dump.gz")?.toISOString()).toBe("2026-10-16T06:30:05.000Z");
  });

  it("ignores other files and sanitises db names", () => {
    expect(parseBackupDate("notes.txt")).toBeNull();
    expect(parseBackupDate("srikit-20261016.dump.gz")).toBeNull();
    expect(parseBackupDate("srikit-20261399T999999Z.dump.gz")).toBeNull();
    expect(backupName("we ird/db", new Date("2026-01-01T00:00:00Z"))).toBe("we_ird_db-20260101T000000Z.dump.gz");
  });
});

describe("planRetention", () => {
  it("keeps everything when under the limits", () => {
    const names = [at("2026-10-14T20:00:00Z"), at("2026-10-15T20:00:00Z")];
    const r = planRetention(names, { keepDaily: 7, keepMonthly: 12 });
    expect(r.prune).toEqual([]);
    expect(r.keep).toHaveLength(2);
  });

  it("keeps the newest per day for N days and prunes the rest", () => {
    // Daily backups at 21:00 UTC (02:30 IST next day) for 10 days, plus a second same-day backup.
    const names = [];
    for (let d = 1; d <= 10; d++) names.push(at(`2026-09-${String(d).padStart(2, "0")}T21:00:00Z`));
    names.push(at("2026-09-10T22:00:00Z"));
    const r = planRetention(names, { keepDaily: 3, keepMonthly: 0 });
    expect(r.keep).toEqual([at("2026-09-10T22:00:00Z"), at("2026-09-09T21:00:00Z"), at("2026-09-08T21:00:00Z")]);
    expect(r.prune).toHaveLength(8);
    expect(r.prune).toContain(at("2026-09-10T21:00:00Z"));
  });

  it("keeps the newest of each month for M months on top of the dailies", () => {
    const names = [
      at("2026-07-15T00:00:00Z"),
      at("2026-07-31T00:00:00Z"),
      at("2026-08-10T00:00:00Z"),
      at("2026-08-31T00:00:00Z"),
      at("2026-09-30T00:00:00Z"),
      at("2026-10-14T00:00:00Z"),
      at("2026-10-15T00:00:00Z"),
    ];
    const r = planRetention(names, { keepDaily: 2, keepMonthly: 3 });
    // dailies: Oct 15, Oct 14. monthlies: Oct (15th), Sep 30, Aug 31.
    expect(r.keep).toEqual([at("2026-10-15T00:00:00Z"), at("2026-10-14T00:00:00Z"), at("2026-09-30T00:00:00Z"), at("2026-08-31T00:00:00Z")]);
    expect(r.prune).toEqual([at("2026-08-10T00:00:00Z"), at("2026-07-31T00:00:00Z"), at("2026-07-15T00:00:00Z")]);
    expect(r.reasons[at("2026-10-15T00:00:00Z")]).toEqual(["newest", "daily 2026-10-15", "monthly 2026-10"]);
  });

  it("uses IST calendar days by default", () => {
    // 2026-10-15T19:00Z = 16 Oct 00:30 IST; 2026-10-15T17:00Z = 15 Oct 22:30 IST → different IST days.
    const names = [at("2026-10-15T19:00:00Z"), at("2026-10-15T17:00:00Z")];
    expect(planRetention(names, { keepDaily: 2, keepMonthly: 0 }).prune).toEqual([]);
    // In UTC they are the same day, so only one daily survives.
    expect(planRetention(names, { keepDaily: 2, keepMonthly: 0, offsetMinutes: 0 }).prune).toEqual([at("2026-10-15T17:00:00Z")]);
  });

  it("never prunes files that aren't backups, and is order-independent", () => {
    const names = ["README.txt", at("2026-01-01T00:00:00Z"), at("2026-01-02T00:00:00Z"), at("2026-01-03T00:00:00Z")];
    const r1 = planRetention(names, { keepDaily: 1, keepMonthly: 0 });
    const r2 = planRetention([...names].reverse(), { keepDaily: 1, keepMonthly: 0 });
    expect(r1).toEqual(r2);
    expect(r1.keep).toEqual([at("2026-01-03T00:00:00Z")]);
    expect(r1.prune).not.toContain("README.txt");
  });

  it("validates the limits", () => {
    expect(() => planRetention([], { keepDaily: 0 })).toThrow(/keepDaily/);
    expect(() => planRetention([], { keepMonthly: -1 })).toThrow(/keepMonthly/);
    expect(planRetention([])).toEqual({ keep: [], prune: [], reasons: {} });
  });
});
