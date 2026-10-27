import { hasPermission, permissionDenied, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { attendanceCsv, bankSheetCsv, csvDisposition, registerCsv } from "./csv";
import { meQuery, monthQuery, pdfQuery } from "./inputs";
import { PAYROLL_ATTENDANCE, PAYROLL_FEATURE, PAYROLL_MANAGE, PAYROLL_SALARY_FEATURE } from "./ports";
import type { Actor, PayrollService } from "./service";

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const lineParam = z.object({ id: z.string().uuid(), lineId: z.string().uuid() });
const advancesQuery = z.object({ employeeId: z.string().uuid().optional(), status: z.enum(["open", "closed", "all"]).default("all") });

const BASE = { config: { feature: PAYROLL_FEATURE } };
const SALARY = { config: { feature: PAYROLL_SALARY_FEATURE } };

/** Holds any of the keys (owners and admins hold all). */
function requireAny(ctx: RequestContext, ...keys: string[]) {
  requireUser(ctx);
  if (keys.some((k) => hasPermission(ctx, k))) return;
  throw permissionDenied(keys[0]!);
}
const manage = (ctx: RequestContext) => requireAny(ctx, PAYROLL_MANAGE);
const desk = (ctx: RequestContext) => requireAny(ctx, PAYROLL_MANAGE, PAYROLL_ATTENDANCE);

const actorOf = (ctx: RequestContext): Actor => ({ userId: ctx.user?.id ?? null, ip: ctx.ip, userAgent: ctx.userAgent });
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
const body = (req: { body: unknown }) => req.body ?? {};
const csv = (reply: FastifyReply, name: string, text: string) =>
  reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", csvDisposition(name)).header("cache-control", "private, no-store").send(text);

/**
 * Routes under /v1/payroll (shop staff; feature `payroll`, salary parts feature `payroll.salary`). Permissions:
 * `payroll.manage` everything; `payroll.attendance` the attendance, check-in screen, holidays (read) and leave approval,
 * never salaries. `/me/*` needs no permission: it only shows the staff record linked to the signed-in login.
 *
 * - settings: `GET|PUT /settings`; `GET /members` (team members to link)
 * - staff: `GET /employees?status=active|left|all&branchId&q`, `POST /employees`, `GET|PUT|DELETE /employees/:id`
 * - holidays: `GET /holidays?year`, `POST /holidays`, `DELETE /holidays/:id`
 * - attendance: `GET /attendance/day?date&branchId`, `POST /attendance/mark`, `POST /attendance/bulk`, `POST /attendance/clear`,
 *   `GET /attendance/sheet?month&branchId&format=csv`, `GET /attendance/log`, `POST /attendance/kiosk { pin }`
 * - leave: `GET /leave/types`, `POST /leave/types`, `PATCH /leave/types/:id`, `GET|PUT /leave/balances`,
 *   `POST /leave/carry-forward`, `GET|POST /leave/requests`, `POST /leave/requests/:id/approve|reject|cancel`
 * - salary: `GET|POST /advances`, `PATCH /advances/:id`, `POST /advances/:id/cancel`; `GET|POST /runs`, `GET /runs/:id`,
 *   `POST /runs/:id/refresh|finalize|cancel|pay`, `PATCH /runs/:id/lines/:lineId`, `GET /runs/:id/register.csv`,
 *   `GET /runs/:id/bank-sheet.csv`, `POST /payments/:id/cancel`; `GET|POST /dues`, `POST /dues/:id/cancel`
 * - self: `GET /me`, `POST /me/check`, `GET /me/attendance?month`, `GET /me/payslips`, `GET /me/payslips/:id/pdf?lang`,
 *   `POST /me/leave-requests`, `POST /me/leave-requests/:id/cancel`
 * Payslip PDFs for managers: `GET /v1/documents/payslip/<lineId>.pdf` (registered by the host).
 */
export function payrollRoutes(service: PayrollService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
    });

    // ---- settings
    app.get("/settings", BASE, async (req) => {
      desk(req.ctx);
      return service.getSettings(tid(req));
    });
    app.put("/settings", BASE, async (req) => {
      manage(req.ctx);
      return service.updateSettings(tid(req), body(req), actorOf(req.ctx));
    });
    app.get("/members", BASE, async (req) => {
      manage(req.ctx);
      return service.linkableMembers(tid(req));
    });

    // ---- staff records
    app.get("/employees", BASE, async (req) => {
      desk(req.ctx);
      return service.listEmployees(tid(req), req.query ?? {}, { withPay: hasPermission(req.ctx, PAYROLL_MANAGE) });
    });
    app.post("/employees", BASE, async (req) => {
      manage(req.ctx);
      return service.createEmployee(tid(req), body(req), actorOf(req.ctx));
    });
    app.get(`/employees${ID}`, BASE, async (req) => {
      desk(req.ctx);
      return service.getEmployee(tid(req), idParam.parse(req.params).id, { withPay: hasPermission(req.ctx, PAYROLL_MANAGE) });
    });
    app.put(`/employees${ID}`, BASE, async (req) => {
      manage(req.ctx);
      return service.updateEmployee(tid(req), idParam.parse(req.params).id, body(req), actorOf(req.ctx));
    });
    app.delete(`/employees${ID}`, BASE, async (req) => {
      manage(req.ctx);
      await service.deleteEmployee(tid(req), idParam.parse(req.params).id, actorOf(req.ctx));
      return { ok: true };
    });

    // ---- holidays
    app.get("/holidays", BASE, async (req) => {
      desk(req.ctx);
      return service.holidays(tid(req), req.query ?? {});
    });
    app.post("/holidays", BASE, async (req) => {
      manage(req.ctx);
      return service.addHoliday(tid(req), body(req));
    });
    app.delete(`/holidays${ID}`, BASE, async (req) => {
      manage(req.ctx);
      await service.removeHoliday(tid(req), idParam.parse(req.params).id);
      return { ok: true };
    });

    // ---- attendance
    app.get("/attendance/day", BASE, async (req) => {
      desk(req.ctx);
      return service.day(tid(req), req.query ?? {});
    });
    app.post("/attendance/mark", BASE, async (req) => {
      desk(req.ctx);
      return service.mark(tid(req), body(req), actorOf(req.ctx));
    });
    app.post("/attendance/bulk", BASE, async (req) => {
      desk(req.ctx);
      return service.bulkMark(tid(req), body(req), actorOf(req.ctx));
    });
    app.post("/attendance/clear", BASE, async (req) => {
      desk(req.ctx);
      await service.clearMark(tid(req), body(req), actorOf(req.ctx));
      return { ok: true };
    });
    app.get("/attendance/sheet", BASE, async (req, reply) => {
      desk(req.ctx);
      const q = monthQuery.parse(req.query ?? {});
      const sheet = await service.sheet(tid(req), { month: q.month, branchId: q.branchId });
      if (q.format === "csv") return csv(reply, `attendance-${sheet.month}`, attendanceCsv(sheet));
      return sheet;
    });
    app.get("/attendance/log", BASE, async (req) => {
      desk(req.ctx);
      return service.log(tid(req), req.query ?? {});
    });
    app.post("/attendance/kiosk", BASE, async (req) => {
      desk(req.ctx);
      return service.checkByPin(tid(req), body(req), actorOf(req.ctx));
    });

    // ---- leave
    app.get("/leave/types", BASE, async (req) => ({ items: await service.leaveTypes(tid(req), hasPermission(req.ctx, PAYROLL_MANAGE)) }));
    app.post("/leave/types", BASE, async (req) => {
      manage(req.ctx);
      return service.createLeaveType(tid(req), body(req));
    });
    app.patch(`/leave/types${ID}`, BASE, async (req) => {
      manage(req.ctx);
      return service.updateLeaveType(tid(req), idParam.parse(req.params).id, body(req));
    });
    app.get("/leave/balances", BASE, async (req) => {
      desk(req.ctx);
      return service.balances(tid(req), req.query ?? {});
    });
    app.put("/leave/balances", BASE, async (req) => {
      manage(req.ctx);
      return service.setBalance(tid(req), body(req), actorOf(req.ctx));
    });
    app.post("/leave/carry-forward", BASE, async (req) => {
      manage(req.ctx);
      return service.carryForward(tid(req), body(req));
    });
    app.get("/leave/requests", BASE, async (req) => {
      desk(req.ctx);
      return service.leaveRequests(tid(req), req.query ?? {});
    });
    app.post("/leave/requests", BASE, async (req) => {
      desk(req.ctx);
      return service.requestLeave(tid(req), body(req), actorOf(req.ctx), { canApprove: true });
    });
    app.post(`/leave/requests${ID}/approve`, BASE, async (req) => {
      desk(req.ctx);
      return service.approveLeave(tid(req), idParam.parse(req.params).id, body(req), actorOf(req.ctx));
    });
    app.post(`/leave/requests${ID}/reject`, BASE, async (req) => {
      desk(req.ctx);
      return service.rejectLeave(tid(req), idParam.parse(req.params).id, body(req), actorOf(req.ctx));
    });
    app.post(`/leave/requests${ID}/cancel`, BASE, async (req) => {
      desk(req.ctx);
      return service.cancelLeave(tid(req), idParam.parse(req.params).id, actorOf(req.ctx));
    });

    // ---- advances
    app.get("/advances", SALARY, async (req) => {
      manage(req.ctx);
      const q = advancesQuery.parse(req.query ?? {});
      return service.advances(tid(req), { employeeId: q.employeeId, status: q.status });
    });
    app.post("/advances", SALARY, async (req) => {
      manage(req.ctx);
      return service.createAdvance(tid(req), body(req), actorOf(req.ctx));
    });
    app.patch(`/advances${ID}`, SALARY, async (req) => {
      manage(req.ctx);
      return service.updateAdvance(tid(req), idParam.parse(req.params).id, body(req));
    });
    app.post(`/advances${ID}/cancel`, SALARY, async (req) => {
      manage(req.ctx);
      return service.cancelAdvance(tid(req), idParam.parse(req.params).id, actorOf(req.ctx));
    });

    // ---- payroll runs
    app.get("/runs", SALARY, async (req) => {
      manage(req.ctx);
      return service.runs(tid(req), req.query ?? {});
    });
    app.post("/runs", SALARY, async (req) => {
      manage(req.ctx);
      return service.createRun(tid(req), body(req), actorOf(req.ctx));
    });
    app.get(`/runs${ID}`, SALARY, async (req) => {
      manage(req.ctx);
      return service.getRun(tid(req), idParam.parse(req.params).id);
    });
    app.post(`/runs${ID}/refresh`, SALARY, async (req) => {
      manage(req.ctx);
      return service.refreshRun(tid(req), idParam.parse(req.params).id);
    });
    app.patch(`/runs${ID}/lines/:lineId`, SALARY, async (req) => {
      manage(req.ctx);
      const { id, lineId } = lineParam.parse(req.params);
      return service.adjustLine(tid(req), id, lineId, body(req));
    });
    app.post(`/runs${ID}/finalize`, SALARY, async (req) => {
      manage(req.ctx);
      return service.finalizeRun(tid(req), idParam.parse(req.params).id, actorOf(req.ctx));
    });
    app.post(`/runs${ID}/cancel`, SALARY, async (req) => {
      manage(req.ctx);
      return service.cancelRun(tid(req), idParam.parse(req.params).id, body(req), actorOf(req.ctx));
    });
    app.post(`/runs${ID}/pay`, SALARY, async (req) => {
      manage(req.ctx);
      return service.pay(tid(req), idParam.parse(req.params).id, body(req), actorOf(req.ctx));
    });
    app.get(`/runs${ID}/register.csv`, SALARY, async (req, reply) => {
      manage(req.ctx);
      const run = await service.getRun(tid(req), idParam.parse(req.params).id);
      return csv(reply, `payroll-register-${run.month}`, registerCsv(run));
    });
    app.get(`/runs${ID}/bank-sheet.csv`, SALARY, async (req, reply) => {
      manage(req.ctx);
      const run = await service.getRun(tid(req), idParam.parse(req.params).id);
      return csv(reply, `salary-bank-transfer-${run.month}`, bankSheetCsv(run, `Salary ${run.month}`));
    });
    app.post(`/payments${ID}/cancel`, SALARY, async (req) => {
      manage(req.ctx);
      return service.unpay(tid(req), idParam.parse(req.params).id, actorOf(req.ctx));
    });

    // ---- statutory dues
    app.get("/dues", SALARY, async (req) => {
      manage(req.ctx);
      return service.dues(tid(req), req.query ?? {});
    });
    app.post("/dues", SALARY, async (req) => {
      manage(req.ctx);
      return service.payDue(tid(req), body(req), actorOf(req.ctx));
    });
    app.post(`/dues${ID}/cancel`, SALARY, async (req) => {
      manage(req.ctx);
      return service.cancelDue(tid(req), idParam.parse(req.params).id, actorOf(req.ctx));
    });

    // ---- self service (the staff record linked to the signed-in login)
    app.get("/me", BASE, async (req) => service.me(tid(req), requireUser(req.ctx).id));
    app.post("/me/check", BASE, async (req) => {
      const user = requireUser(req.ctx);
      return service.checkSelf(tid(req), { ...actorOf(req.ctx), userId: user.id });
    });
    app.get("/me/attendance", BASE, async (req) => service.myAttendance(tid(req), requireUser(req.ctx).id, meQuery.parse(req.query ?? {}).month));
    app.get("/me/payslips", SALARY, async (req) => service.myPayslips(tid(req), requireUser(req.ctx).id));
    app.get(`/me/payslips${ID}/pdf`, SALARY, async (req, reply) => {
      const { lang } = pdfQuery.parse(req.query ?? {});
      const locale = lang ?? (req.ctx.locale === "ta" ? "ta" : "en");
      const doc = await service.myPayslipPdf(tid(req), requireUser(req.ctx).id, idParam.parse(req.params).id, locale);
      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `inline; filename="${doc.filename.replace(/"/g, "")}"`)
        .header("cache-control", "private, no-store")
        .send(doc.pdf);
    });
    app.post("/me/leave-requests", BASE, async (req) => {
      const user = requireUser(req.ctx);
      return service.requestLeave(tid(req), body(req), actorOf(req.ctx), { selfUserId: user.id, canApprove: false });
    });
    app.post(`/me/leave-requests${ID}/cancel`, BASE, async (req) => {
      const user = requireUser(req.ctx);
      return service.cancelLeave(tid(req), idParam.parse(req.params).id, actorOf(req.ctx), { selfUserId: user.id });
    });
  };
}
