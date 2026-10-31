import { AppError } from "@rbms/core";
import { and, eq, isNull, type Db } from "@rbms/db";
import { invoices as invoiceTable, type InvoiceInput, type InvoicesService, type PaymentInput } from "@rbms/invoices";
import type { OfflineFlag, PosBillInfo, PosInvoicesPort } from "@rbms/pos";

/**
 * The invoices module as the POS offline sync sees it (docs/offline-billing.md): reserved number blocks, issuing a bill
 * with a reserved number, and the payments taken at the counter. Fallbacks that keep a sale from being lost: an unknown
 * customer becomes a walk-in, a till that was closed meanwhile is left off the bill (both flagged for review).
 */
export function posInvoicesPort(
  invoices: InvoicesService,
  db: Db,
  /** Checks alternate units against the catalogue and sets the server's unit factor (kit-pricing.ts). */
  prepareLines?: (tenantId: string, lines: unknown[]) => Promise<unknown[]>,
): PosInvoicesPort {
  const info = (inv: { id: string; number: string | null; total: number; paid: number; balance: number }): PosBillInfo => ({
    invoiceId: inv.id,
    number: inv.number,
    total: inv.total,
    paid: inv.paid,
    balance: inv.balance,
  });
  const isTillClosed = (err: unknown) => err instanceof AppError && err.code === "till_closed";

  return {
    reserveBlock: (tenant, q, inTx) => invoices.reserveSeqBlock(tenant, q, inTx),

    async issue(tenant, input) {
      const flags: OfflineFlag[] = [];
      let customerId = input.customerId;
      let walkIn = input.customer;
      if (customerId) {
        const found = await invoices.getCustomer(tenant.id, customerId).catch(() => null);
        if (!found) {
          flags.push({ code: "customer_missing", detail: { customerId } });
          customerId = undefined;
          walkIn ??= { name: "Walk-in" };
        }
      }
      let tillSessionId = input.tillSessionId;
      const lines = prepareLines ? await prepareLines(tenant.id, input.lines as unknown[]) : input.lines;
      const make = (till: string | undefined) =>
        invoices.create(
          tenant,
          {
            date: input.date,
            lines,
            issue: true,
            ...(customerId ? { customerId } : { customer: walkIn ?? { name: "Walk-in" } }),
            ...(input.notes ? { notes: input.notes } : {}),
            ...(till ? { tillSessionId: till } : {}),
          } as unknown as InvoiceInput,
          { branchId: input.branchId, ...(input.preset ? { presetNumber: input.preset } : {}) },
        );
      let inv;
      try {
        inv = await make(tillSessionId);
      } catch (err) {
        if (!tillSessionId || !isTillClosed(err)) throw err;
        flags.push({ code: "till_closed", detail: { tillSessionId } });
        tillSessionId = undefined;
        inv = await make(undefined);
      }
      const [row] = await db.select({ fy: invoiceTable.fy, seq: invoiceTable.seq }).from(invoiceTable).where(and(eq(invoiceTable.tenantId, tenant.id), eq(invoiceTable.id, inv.id))).limit(1);
      return {
        invoiceId: inv.id,
        number: inv.number ?? "",
        fy: row?.fy ?? input.preset?.fy ?? "",
        seq: row?.seq ?? input.preset?.seq ?? 0,
        total: inv.total,
        paid: inv.paid,
        balance: inv.balance,
        flags,
      };
    },

    async pay(tenant, invoiceId, input) {
      const flags: OfflineFlag[] = [];
      let paid = 0;
      let balance = 0;
      let tillSessionId = input.tillSessionId;
      for (const p of input.payments) {
        const body = (till: string | undefined): PaymentInput => ({
          amount: p.amount,
          method: p.method,
          date: input.date,
          ...(p.reference ? { reference: p.reference } : {}),
          ...(till ? { tillSessionId: till } : {}),
        });
        try {
          const inv = await invoices.addPayment(tenant.id, invoiceId, body(tillSessionId), input.userId).catch(async (err: unknown) => {
            if (!tillSessionId || !isTillClosed(err)) throw err;
            if (!flags.some((f) => f.code === "till_closed")) flags.push({ code: "till_closed", detail: { tillSessionId } });
            tillSessionId = undefined;
            return invoices.addPayment(tenant.id, invoiceId, body(undefined), input.userId);
          });
          paid = inv.paid;
          balance = inv.balance;
        } catch (err) {
          flags.push({ code: "payment_failed", detail: { method: p.method, amount: p.amount, error: err instanceof AppError ? err.code : "error" } });
        }
      }
      if (!paid) {
        const inv = await invoices.get(tenant.id, invoiceId);
        paid = inv.paid;
        balance = inv.balance;
      }
      return { paid, balance, flags };
    },

    async get(tenant, invoiceId) {
      const inv = await invoices.get(tenant.id, invoiceId).catch(() => null);
      return inv ? info(inv) : null;
    },

    async findBySeq(tenant, q) {
      const [row] = await db
        .select({ id: invoiceTable.id })
        .from(invoiceTable)
        .where(
          and(
            eq(invoiceTable.tenantId, tenant.id),
            eq(invoiceTable.fy, q.fy),
            eq(invoiceTable.seq, q.seq),
            q.branchId ? eq(invoiceTable.branchId, q.branchId) : isNull(invoiceTable.branchId),
          ),
        )
        .limit(1);
      if (!row) return null;
      const inv = await invoices.get(tenant.id, row.id).catch(() => null);
      return inv ? info(inv) : null;
    },
  };
}
