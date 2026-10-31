/**
 * Database test of the payroll service: staff, attendance with a correction, leave approval, PIN check-in, an advance,
 * the October payroll (paid days, LOP, PF / ESI, advance recovery), finalizing (attendance locked), payments, the book
 * sources (balanced), statutory dues and cancelling. Runs only with `PAYROLL_TEST_DATABASE_URL` set (a development
 * Postgres with migration 0049 applied); it copies the payroll tables into a throw-away schema and drops it afterwards.
 *   PowerShell: $env:PAYROLL_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; pnpm test
 */
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PayrollService } from "./service";

const URL_ = process.env.PAYROLL_TEST_DATABASE_URL;
const SCHEMA = `payroll_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = [
  "payroll_settings",
  "payroll_employees",
  "payroll_holidays",
  "payroll_attendance",
  "payroll_attendance_log",
  "payroll_leave_types",
  "payroll_leave_balances",
  "payroll_leave_requests",
  "payroll_advances",
  "payroll_runs",
  "payroll_run_lines",
  "payroll_payments",
  "payroll_due_payments",
];
const T = "11111111-1111-4111-8111-111111111111";
const OWNER = { userId: "22222222-2222-4222-8222-222222222222" };
const RAVI_USER = "33333333-3333-4333-8333-333333333333";

describe.skipIf(!URL_)("payroll service against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let now = new Date("2026-11-02T09:45:00+05:30");
  let service: PayrollService;
  const changed: string[] = [];

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    service = new PayrollService({
      db,
      now: () => now,
      pins: { memberForPin: async (_t, pin) => (pin === "4321" ? { userId: RAVI_USER, name: "Ravi" } : null) },
      books: { changed: (t) => changed.push(t) },
    });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("runs a month from attendance to the books", async () => {
    await service.updateSettings(T, { pf: { enabled: true }, esi: { enabled: true } }, OWNER);
    const meena = await service.createEmployee(T, {
      name: "Meena",
      joinDate: "2025-04-01",
      salary: { payType: "monthly", basic: 1_200_000, hra: 300_000, pf: true, esi: true },
      payMethod: "bank",
      accountNumber: "123456789012",
      ifsc: "SBIN0001234",
    });
    const ravi = await service.createEmployee(T, { name: "Ravi", joinDate: "2026-01-10", userId: RAVI_USER, salary: { payType: "daily", dailyRate: 60_000 } });
    expect(meena.code).toBe("EMP-001");
    expect(ravi.code).toBe("EMP-002");
    expect((await service.listEmployees(T, {}, { withPay: false })).items[0]!.salary).toBeNull();

    await service.addHoliday(T, { date: "2026-10-02", name: "Gandhi Jayanti" });

    // A mark, then a correction (needs a reason; both are logged).
    await service.mark(T, { employeeId: meena.id, date: "2026-10-05", status: "absent" }, OWNER);
    await expect(service.mark(T, { employeeId: meena.id, date: "2026-10-05", status: "half_day" }, OWNER)).rejects.toMatchObject({ code: "reason_required" });
    await service.mark(T, { employeeId: meena.id, date: "2026-10-05", status: "half_day", reason: "Came after lunch" }, OWNER);
    const log = await service.log(T, { employeeId: meena.id });
    expect(log.items.map((l) => l.reason)).toEqual(["Came after lunch", null]);

    // Two days of casual leave, approved.
    const cl = (await service.leaveTypes(T)).find((t) => t.code === "CL")!;
    const req = await service.requestLeave(T, { employeeId: meena.id, leaveTypeId: cl.id, from: "2026-10-07", to: "2026-10-08" }, OWNER, { canApprove: true });
    const approved = await service.approveLeave(T, req.id, {}, OWNER);
    expect(approved.status).toBe("approved");
    const bal = (await service.balances(T, { year: 2026, employeeId: meena.id })).items[0]!.types.find((t) => t.code === "CL")!;
    expect(bal).toMatchObject({ used: 2, balance: 10 });

    // An advance to Ravi, recovered ₹1,000 a month.
    await service.createAdvance(T, { employeeId: ravi.id, date: "2026-10-10", amount: 300_000, instalment: 100_000 }, OWNER);

    // October payroll.
    const run = await service.createRun(T, { month: "2026-10" }, OWNER);
    const m = run.lines.find((l) => l.employeeId === meena.id)!;
    const r = run.lines.find((l) => l.employeeId === ravi.id)!;
    // Meena: 26 working days (Sundays and the holiday off), half a day LOP → 25.5 paid.
    expect(m.basisDays).toBe(26);
    expect(m.paidDays).toBe(25.5);
    expect(m.gross).toBe(Math.round((1_200_000 * 25.5) / 26) + Math.round((300_000 * 25.5) / 26));
    expect(m.heads.pfEmployee).toBe(141_200); // 12% of 11,769.23 → ₹1,412
    expect(m.heads.esiEmployee).toBe(11_100); // 0.75% of 14,711.54 → ₹110.34, up to ₹111
    // Ravi (daily, joined in January): 26 working days at ₹600, ₹1,000 advance back.
    expect(r.paidDays).toBe(26);
    expect(r.gross).toBe(1_560_000);
    expect(r.heads.advance).toBe(100_000);
    expect(r.net).toBe(1_460_000);

    const final = await service.finalizeRun(T, run.id, OWNER);
    expect(final.status).toBe("finalized");
    await expect(service.mark(T, { employeeId: ravi.id, date: "2026-10-20", status: "absent" }, OWNER)).rejects.toMatchObject({ code: "payroll_finalized" });
    expect((await service.advances(T, {})).outstanding).toBe(200_000);

    // Ravi checks in with his PIN on 2 November (15 minutes late) and out in the evening.
    const inn = await service.checkByPin(T, { pin: "4321" }, OWNER);
    expect(inn).toMatchObject({ action: "in", lateMinutes: 15 });
    await expect(service.checkByPin(T, { pin: "0000" }, OWNER)).rejects.toMatchObject({ code: "wrong_pin" });
    now = new Date("2026-11-02T21:15:00+05:30");
    const out = await service.checkByPin(T, { pin: "4321" }, OWNER);
    expect(out).toMatchObject({ action: "out", workedMinutes: 690, overtimeMinutes: 30 });

    // Pay everyone; the books get the payroll and both payments, and they balance.
    const paid = await service.pay(T, run.id, { date: "2026-11-02" }, OWNER);
    expect(paid.paid).toBe(2);
    const books = await service.bookSources(T);
    expect(books.runs).toHaveLength(1);
    const b = books.runs[0]!;
    expect(b.gross + b.employerPf + b.employerEsi + b.roundOff).toBe(b.net + b.pf + b.esi + b.pt + b.tds + b.advance + b.other);
    expect(books.payments.reduce((t, p) => t + p.amount, 0)).toBe(b.net);
    expect(books.payments.find((p) => p.employeeName === "Meena")?.method).toBe("bank");
    expect(books.advances).toHaveLength(1);
    expect(changed.length).toBeGreaterThan(0);

    // PF for October deposited.
    const dues = await service.dues(T, { from: "2026-10", to: "2026-10" });
    const pf = dues.items.find((d) => d.kind === "pf")!;
    expect(pf.due).toBe(m.heads.pfEmployee! + m.heads.pfEmployer!);
    await service.payDue(T, { kind: "pf", month: "2026-10", amount: pf.due }, OWNER);
    expect((await service.dues(T, { from: "2026-10", to: "2026-10" })).items.find((d) => d.kind === "pf")!.balance).toBe(0);

    // Cancelling: refused while payments stand, then allowed; the books lose the payroll and the payments.
    await expect(service.cancelRun(T, run.id, { reason: "Wrong month" }, OWNER)).rejects.toMatchObject({ code: "run_has_payments" });
    for (const l of (await service.getRun(T, run.id)).lines) await service.unpay(T, l.payment!.id, OWNER);
    await service.cancelRun(T, run.id, { reason: "Recalculate" }, OWNER);
    const after = await service.bookSources(T);
    expect(after.runs).toHaveLength(0);
    expect(after.payments).toHaveLength(0);
    expect((await service.advances(T, {})).outstanding).toBe(300_000);

    // A fresh payroll for October can be run again.
    const again = await service.createRun(T, { month: "2026-10" }, OWNER);
    expect(again.lines).toHaveLength(2);
  });
});
