/**
 * Expenses wiring (docs/expenses-debit-notes.md): expenses bought on credit from a supplier are bills in that supplier's
 * Payables (inventory reads and pays them through `ExpenseBillsPort`), the supplier and branch lookups the expenses
 * module needs, and the recurring-expenses job. Packages never import each other; this file joins them over the tables.
 */
import { branches } from "@rbms/branches";
import type { Db, DbOrTx } from "@rbms/db";
import { expenseCategories, expenses, type BranchesPort, type SuppliersPort } from "@rbms/expenses";
import type { ExpenseBill, ExpenseBillsPort, InventoryService } from "@rbms/inventory";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

const isNotFound = (err: unknown) => (err as { status?: number })?.status === 404;

/** Recorded credit expenses with a supplier: the bills Payables shows, ages and pays. */
export function expenseBillsPort(db: Db): ExpenseBillsPort {
  const credit = (tenantId: string) =>
    and(eq(expenses.tenantId, tenantId), eq(expenses.status, "recorded"), eq(expenses.paymentMethod, "credit"), sql`${expenses.supplierId} is not null`);
  return {
    async bills(tx: DbOrTx, tenantId, q) {
      const where = and(credit(tenantId), q.supplierId ? eq(expenses.supplierId, q.supplierId) : undefined, q.ids?.length ? inArray(expenses.id, q.ids) : undefined);
      const query = tx
        .select({ e: expenses, category: expenseCategories.name })
        .from(expenses)
        .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        .where(where)
        .orderBy(expenses.id);
      // FOR UPDATE can't lock the nullable side of an outer join: lock the expense rows only.
      const rows = q.lock ? await query.for("update", { of: expenses }) : await query;
      return rows.map(
        ({ e, category }): ExpenseBill => ({
          id: e.id,
          supplierId: e.supplierId!,
          supplierName: e.vendorName ?? "Supplier",
          ref: e.reference ?? category ?? "Expense",
          category: category ?? "Other",
          date: e.date,
          dueDate: e.dueDate,
          total: e.amount,
          amountPaid: e.amountPaid,
          createdAt: e.createdAt,
        }),
      );
    },
    async setPaid(tx: DbOrTx, tenantId, expenseId, amountPaid) {
      await tx.update(expenses).set({ amountPaid }).where(and(eq(expenses.tenantId, tenantId), eq(expenses.id, expenseId)));
    },
    unpaidSql(tenantId: SQL, supplierId: SQL) {
      return sql<string>`(select coalesce(sum(x.amount - x.amount_paid), 0) from ${expenses} x where x.tenant_id = ${tenantId} and x.supplier_id = ${supplierId} and x.status = 'recorded' and x.payment_method = 'credit')`;
    },
  };
}

/** Suppliers for linking an expense (inventory). */
export function expenseSuppliersPort(inventory: () => InventoryService): SuppliersPort {
  return {
    async get(tenantId, id) {
      const s = await inventory()
        .getSupplier(tenantId, id)
        .catch((err) => {
          if (isNotFound(err)) return null;
          throw err;
        });
      return s ? { id: s.id, name: s.name, gstin: s.gstin ?? null } : null;
    },
  };
}

/** Branch names for the expense report (read only: no default branch is made for a shop without branches). */
export function expenseBranchesPort(db: Db): BranchesPort {
  return {
    list: (tenantId) => db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, tenantId)),
  };
}
