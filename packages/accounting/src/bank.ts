/**
 * Bank reconciliation (Part B): statement import per bank account, matching statement lines to the books, entries
 * made from statement lines, the reconciliation statement and the "reconciled up to" record, and the cheque register.
 * Journal postings go through AccountingService (postModuleEntry / reverseModuleEntry); this file writes only the
 * acct_bank_* and acct_cheques tables.
 */
import { badRequest, conflict, notFound } from "@rbms/core";
import type { Db, DbOrTx } from "@rbms/db";
import { isValidDate } from "@rbms/gst";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildReconciliation, statementBalanceOn, suggestMatches, type BookSideLine, type MatchSuggestion, type ReconciliationStatement } from "./bank-match";
import { BankImportError, lineHashes, parseStatement, readStatementFile, type ColumnMapping, type ParseOptions } from "./bank-import";
import { SYS } from "./chart";
import type { ReportTable } from "./reports-logic";
import { acctAccounts, acctEntries, acctLines, PARTY_TYPES } from "./schema";
import { acctBankLines, acctBankMatches, acctBankRecons, acctBankStatements, acctCheques, CHEQUE_DIRECTIONS, type AcctBankLine, type AcctCheque } from "./schema-b";
import type { AccountingService } from "./service";

const date = z.string().refine(isValidDate, "Use a YYYY-MM-DD date");
const uuid = z.string().uuid();
const paise = z.number().int().positive().max(2_000_000_000);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const matchInput = z
  .object({
    accountId: uuid,
    bankLineIds: z.array(uuid).max(50).default([]),
    bookLineIds: z.array(uuid).max(50).default([]),
    /** Post the difference (bank minus books) to this account, e.g. Bank charges for card / UPI fees. */
    differenceAccountId: uuid.nullish(),
    note: optText(200),
  })
  .strict();

/** Kinds of entries offered when a statement line is not in the books yet. */
export const ENTRY_PRESETS = ["bank_charges", "interest_received", "interest_paid", "other_income", "other_expense", "drawings", "capital", "cash_deposit", "cash_withdrawal", "account"] as const;
export const createEntryInput = z
  .object({
    preset: z.enum(ENTRY_PRESETS),
    /** The other account (required for preset "account"). */
    accountId: uuid.nullish(),
    narration: optText(300),
    partyType: z.enum(PARTY_TYPES).nullish(),
    partyId: uuid.nullish(),
  })
  .strict();

export const chequeInput = z
  .object({
    direction: z.enum(CHEQUE_DIRECTIONS),
    accountId: uuid,
    chequeNo: z.string().trim().min(1).max(20),
    chequeDate: date,
    amount: paise,
    partyType: z.enum(PARTY_TYPES).nullish(),
    partyId: uuid.nullish(),
    partyName: z.string().trim().max(120).default(""),
    drawnOn: optText(80),
    acctLineId: uuid.nullish(),
    note: optText(300),
  })
  .strict();
export const chequePatch = chequeInput.partial().strict();
export const chequeAction = z
  .object({
    action: z.enum(["deposit", "clear", "bounce", "cancel", "reopen"]),
    date: date.optional(),
    reason: optText(200),
    /** Bank's bounce charges (paise), posted Dr Bank charges / Cr the bank account. */
    charges: z.number().int().min(0).max(10_000_000).optional(),
  })
  .strict();

const ALLOWED_PRESET_KEY: Record<string, string | null> = {
  bank_charges: SYS.bankCharges,
  interest_received: SYS.interestReceived,
  interest_paid: SYS.interestPaid,
  other_income: SYS.otherIncome,
  other_expense: SYS.otherExpense,
  drawings: SYS.drawings,
  capital: SYS.capital,
  cash_deposit: SYS.cash,
  cash_withdrawal: SYS.cash,
  account: null,
};

export interface BookLineRow {
  id: string;
  entryId: string;
  date: string;
  amount: number;
  narration: string;
  reference: string | null;
  number: string;
  entryStatus: string;
  reversalOfId: string | null;
  reversedById: string | null;
  sourceType: string | null;
  /** Source of the entry, or of the entry it reverses: pairs a reversal with the posting it undoes. */
  pairKey: string;
  matchGroupId: string | null;
  chequeNo: string | null;
}

const num = (v: unknown) => Number(v ?? 0);

/**
 * What a book line belongs to, so a posting and the posting that undoes it pair up: an engine reversal points at its
 * original (reversalOfId); a later business fact is a mirror posting of the same document under a `_cancel` /
 * `_reversal` source type (supplier_payment_reversal, invoice_cancel, ...).
 */
export function pairKeyOf(r: { entryId: string; reversalOfId: string | null; sourceType: string | null; sourceId: string | null; origSource?: string | null }): string {
  const base = (t: string) => t.replace(/_(cancel|reversal)$/, "");
  if (r.reversalOfId) {
    if (!r.origSource) return r.reversalOfId;
    const [t, id] = r.origSource.split("|");
    return `${base(t ?? "")}|${id ?? ""}`;
  }
  return r.sourceType && r.sourceId ? `${base(r.sourceType)}|${r.sourceId}` : r.entryId;
}
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export class BankService {
  constructor(private readonly deps: { db: Db; acct: AccountingService; now?: () => Date }) {}

  private get db() {
    return this.deps.db;
  }
  private today() {
    return this.deps.acct.today();
  }

  // ================================================================ accounts

  async bankAccount(tenantId: string, accountId: string) {
    const a = await this.deps.acct.getAccount(tenantId, accountId);
    if (!a.isBank) throw badRequest("Choose a bank account (an account marked as a bank account in the chart)");
    return a;
  }

  /** Bank accounts with the book balance, the last statement balance and how far each is reconciled. */
  async accounts(tenantId: string) {
    await this.deps.acct.ensureInit(tenantId);
    const today = this.today();
    const banks = await this.db
      .select()
      .from(acctAccounts)
      .where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.isBank, true)))
      .orderBy(asc(acctAccounts.code));
    if (banks.length === 0) return { items: [] };
    const ids = banks.map((b) => b.id);
    const [stats, recons, books] = await Promise.all([
      this.db
        .select({
          accountId: acctBankLines.accountId,
          lines: sql<string>`count(*)`,
          open: sql<string>`count(*) filter (where ${acctBankLines.status} = 'open')`,
          last: sql<string | null>`max(${acctBankLines.date})`,
          first: sql<string | null>`min(${acctBankLines.date})`,
        })
        .from(acctBankLines)
        .where(and(eq(acctBankLines.tenantId, tenantId), inArray(acctBankLines.accountId, ids)))
        .groupBy(acctBankLines.accountId),
      this.db
        .select()
        .from(acctBankRecons)
        .where(and(eq(acctBankRecons.tenantId, tenantId), inArray(acctBankRecons.accountId, ids)))
        .orderBy(desc(acctBankRecons.asOf), desc(acctBankRecons.at)),
      this.db
        .select({ id: acctLines.accountId, net: sql<string>`coalesce(sum(${acctLines.debit} - ${acctLines.credit}), 0)` })
        .from(acctLines)
        .where(and(eq(acctLines.tenantId, tenantId), inArray(acctLines.accountId, ids), lte(acctLines.entryDate, today)))
        .groupBy(acctLines.accountId),
    ]);
    const items = [];
    for (const b of banks) {
      const s = stats.find((x) => x.accountId === b.id);
      const r = recons.find((x) => x.accountId === b.id);
      let statementBalance: number | null = null;
      if (s?.last) statementBalance = statementBalanceOn(await this.statementLines(tenantId, b.id, s.last), s.last);
      items.push({
        id: b.id,
        code: b.code,
        name: b.name,
        active: b.active,
        bankName: b.bankName,
        bankAccountLast4: b.bankAccountLast4,
        bankIfsc: b.bankIfsc,
        bookBalance: num(books.find((x) => x.id === b.id)?.net),
        statementLines: num(s?.lines),
        openLines: num(s?.open),
        statementFrom: s?.first ?? null,
        statementTo: s?.last ?? null,
        statementBalance,
        reconciledThrough: r?.asOf ?? null,
        lastReconciliation: r ?? null,
      });
    }
    return { items };
  }

  private statementLines(tenantId: string, accountId: string, asOf: string) {
    return this.db
      .select({ date: acctBankLines.date, amount: acctBankLines.amount, balance: acctBankLines.balance })
      .from(acctBankLines)
      .where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.accountId, accountId), lte(acctBankLines.date, asOf), ne(acctBankLines.status, "excluded")))
      .orderBy(asc(acctBankLines.date), asc(acctBankLines.seq));
  }

  // ================================================================ import

  private parse(data: Uint8Array, opts: ParseOptions & { fileName?: string }) {
    try {
      const rows = readStatementFile(data, opts.fileName ?? "");
      return { rows, result: parseStatement(rows, opts) };
    } catch (err) {
      if (err instanceof BankImportError) throw badRequest(err.message);
      throw err;
    }
  }

  /** Reads the file and shows what would be imported: layout, columns, lines, errors and lines already imported. */
  async preview(tenantId: string, accountId: string, data: Uint8Array, opts: ParseOptions & { fileName?: string } = {}) {
    await this.bankAccount(tenantId, accountId);
    const { rows, result } = this.parse(data, opts);
    const hashes = lineHashes(result.lines);
    const existing = await this.existingHashes(tenantId, accountId, hashes);
    const duplicates = hashes.filter((h) => existing.has(h)).length;
    return {
      layout: result.layout,
      headerRow: result.headerRow,
      headers: result.headers,
      mapping: result.mapping,
      sample: rows.slice(0, Math.min(rows.length, result.headerRow + 8)).map((r) => r.slice(0, 16)),
      lines: result.lines.slice(0, 200).map((l, i) => ({ ...l, duplicate: existing.has(hashes[i]!) })),
      errors: result.errors.slice(0, 200),
      warnings: result.warnings,
      counts: { lines: result.lines.length, new: result.lines.length - duplicates, duplicates, errors: result.errors.length, skipped: result.skipped },
      from: result.from,
      to: result.to,
      openingBalance: result.openingBalance,
      closingBalance: result.closingBalance,
      reversed: result.reversed,
    };
  }

  private async existingHashes(tenantId: string, accountId: string, hashes: string[]) {
    const out = new Set<string>();
    for (let i = 0; i < hashes.length; i += 1000) {
      const part = hashes.slice(i, i + 1000);
      if (!part.length) continue;
      const rows = await this.db
        .select({ hash: acctBankLines.hash })
        .from(acctBankLines)
        .where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.accountId, accountId), inArray(acctBankLines.hash, part)));
      for (const r of rows) out.add(r.hash);
    }
    return out;
  }

  /** Imports a statement. Lines already imported (same hash) are skipped, so the same file can be imported again. */
  async import(tenantId: string, accountId: string, data: Uint8Array, opts: ParseOptions & { fileName?: string } = {}, userId: string | null = null) {
    await this.bankAccount(tenantId, accountId);
    const { result } = this.parse(data, opts);
    if (result.lines.length === 0) throw badRequest("No statement lines were found in the file", { errors: result.errors.slice(0, 20) });
    const hashes = lineHashes(result.lines);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`acct-bank:${tenantId}:${accountId}`}))`);
      const [seqRow] = await tx
        .select({ max: sql<string>`coalesce(max(${acctBankLines.seq}), 0)` })
        .from(acctBankLines)
        .where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.accountId, accountId)));
      const base = num(seqRow?.max);
      const statementId = randomUUID();
      const rows = result.lines.map((l, i) => ({
        tenantId,
        accountId,
        statementId,
        date: l.date,
        valueDate: l.valueDate,
        narration: l.narration.slice(0, 500),
        reference: l.reference?.slice(0, 80) ?? null,
        amount: l.amount,
        balance: l.balance,
        seq: base + i + 1,
        hash: hashes[i]!,
      }));
      let added = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const ins = await tx.insert(acctBankLines).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ id: acctBankLines.id });
        added += ins.length;
      }
      await tx.insert(acctBankStatements).values({
        id: statementId,
        tenantId,
        accountId,
        fileName: opts.fileName?.slice(0, 200) ?? null,
        layout: result.layout,
        fromDate: result.from,
        toDate: result.to,
        openingBalance: result.openingBalance,
        closingBalance: result.closingBalance,
        rows: result.lines.length,
        added,
        duplicates: result.lines.length - added,
        skipped: result.skipped + result.errors.length,
        mapping: { ...(result.mapping as Record<string, unknown>), headerRow: result.headerRow },
        createdBy: userId,
      });
      return { statementId, layout: result.layout, lines: result.lines.length, added, duplicates: result.lines.length - added, errors: result.errors.slice(0, 50), warnings: result.warnings, from: result.from, to: result.to };
    });
  }

  async statements(tenantId: string, accountId: string) {
    const items = await this.db
      .select()
      .from(acctBankStatements)
      .where(and(eq(acctBankStatements.tenantId, tenantId), eq(acctBankStatements.accountId, accountId)))
      .orderBy(desc(acctBankStatements.createdAt))
      .limit(100);
    return { items };
  }

  /** Removes an import: its lines that are still open. Refused when any of them is matched. */
  async deleteStatement(tenantId: string, id: string) {
    return this.db.transaction(async (tx) => {
      const [st] = await tx.select().from(acctBankStatements).where(and(eq(acctBankStatements.tenantId, tenantId), eq(acctBankStatements.id, id))).limit(1);
      if (!st) throw notFound("Statement");
      const [busy] = await tx
        .select({ n: sql<string>`count(*)` })
        .from(acctBankLines)
        .where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.statementId, id), eq(acctBankLines.status, "matched")));
      if (num(busy?.n) > 0) throw conflict("Some lines of this statement are matched. Unmatch them first.");
      const del = await tx.delete(acctBankLines).where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.statementId, id))).returning({ id: acctBankLines.id });
      await tx.delete(acctBankStatements).where(and(eq(acctBankStatements.tenantId, tenantId), eq(acctBankStatements.id, id)));
      return { removed: del.length };
    });
  }

  // ================================================================ lines

  async lines(tenantId: string, q: { accountId: string; status?: string; from?: string; to?: string; q?: string; limit?: number; offset?: number }) {
    const accountId = uuid.parse(q.accountId);
    const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 500);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    const where = and(
      eq(acctBankLines.tenantId, tenantId),
      eq(acctBankLines.accountId, accountId),
      q.status && ["open", "matched", "excluded"].includes(q.status) ? eq(acctBankLines.status, q.status as "open") : undefined,
      q.from && isValidDate(q.from) ? gte(acctBankLines.date, q.from) : undefined,
      q.to && isValidDate(q.to) ? lte(acctBankLines.date, q.to) : undefined,
      q.q ? sql`(${acctBankLines.narration} ilike ${`%${q.q.replace(/[\\%_]/g, "\\$&")}%`} or ${acctBankLines.reference} ilike ${`%${q.q.replace(/[\\%_]/g, "\\$&")}%`})` : undefined,
    );
    const [items, [cnt]] = await Promise.all([
      this.db.select().from(acctBankLines).where(where).orderBy(desc(acctBankLines.date), desc(acctBankLines.seq)).limit(limit).offset(offset),
      this.db.select({ n: sql<string>`count(*)` }).from(acctBankLines).where(where),
    ]);
    return { items, total: num(cnt?.n), limit, offset };
  }

  /**
   * Journal lines on the bank account with their match state. A posting and its reversal that are both unmatched
   * cancel out and are left out of the open list (`dropCancelled`).
   */
  async bookLines(tenantId: string, accountId: string, q: { from?: string | null; to?: string | null; onlyOpen?: boolean; limit?: number } = {}): Promise<BookLineRow[]> {
    const orig = sql.raw("o");
    const rows = await this.db
      .select({
        id: acctLines.id,
        entryId: acctLines.entryId,
        date: acctLines.entryDate,
        debit: acctLines.debit,
        credit: acctLines.credit,
        memo: acctLines.memo,
        narration: acctEntries.narration,
        reference: acctEntries.reference,
        number: acctEntries.number,
        entryStatus: acctEntries.status,
        reversalOfId: acctEntries.reversalOfId,
        reversedById: acctEntries.reversedById,
        sourceType: acctEntries.sourceType,
        sourceId: acctEntries.sourceId,
        origSource: sql<string | null>`(select ${orig}.source_type || '|' || ${orig}.source_id from ${acctEntries} ${orig} where ${orig}.id = ${acctEntries.reversalOfId})`,
        matchGroupId: acctBankMatches.groupId,
        chequeNo: sql<string | null>`(select c.cheque_no from ${acctCheques} c where c.tenant_id = ${tenantId} and c.acct_line_id = ${acctLines.id} limit 1)`,
      })
      .from(acctLines)
      .innerJoin(acctEntries, eq(acctEntries.id, acctLines.entryId))
      .leftJoin(acctBankMatches, and(eq(acctBankMatches.tenantId, tenantId), eq(acctBankMatches.acctLineId, acctLines.id)))
      .where(
        and(
          eq(acctLines.tenantId, tenantId),
          eq(acctLines.accountId, accountId),
          q.from ? gte(acctLines.entryDate, q.from) : undefined,
          q.to ? lte(acctLines.entryDate, q.to) : undefined,
          q.onlyOpen ? isNull(acctBankMatches.id) : undefined,
        ),
      )
      .orderBy(asc(acctLines.entryDate), asc(acctEntries.seq), asc(acctLines.lineNo))
      .limit(q.limit ?? 5000);
    return rows.map((r) => ({
      id: r.id,
      entryId: r.entryId,
      date: r.date,
      amount: r.debit - r.credit,
      narration: r.memo ? `${r.narration} (${r.memo})` : r.narration,
      reference: r.reference,
      number: r.number,
      entryStatus: r.entryStatus,
      reversalOfId: r.reversalOfId,
      reversedById: r.reversedById,
      sourceType: r.sourceType,
      pairKey: pairKeyOf(r),
      matchGroupId: r.matchGroupId,
      chequeNo: r.chequeNo,
    }));
  }

  /** Leaves out a posting and its reversal when both are in the list (they cancel each other). */
  static dropCancelled<T extends { id: string; entryId: string; amount: number; pairKey: string; entryStatus?: string; reversalOfId: string | null }>(lines: readonly T[]): T[] {
    // Only pairs that undo each other: an engine reversal and its original, or a document's posting and its
    // cancellation / reversal (same document, opposite amount). Two versions of an edited document are not a pair.
    const byKey = new Map<string, T[]>();
    for (const l of lines) byKey.set(l.pairKey, [...(byKey.get(l.pairKey) ?? []), l]);
    const drop = new Set<string>();
    for (const l of lines) {
      if (drop.has(l.id)) continue;
      const undo = l.reversalOfId !== null || /_(cancel|reversal)\|/.test(`${(l as { sourceType?: string | null }).sourceType ?? ""}|`);
      if (!undo) continue;
      const twin = (byKey.get(l.pairKey) ?? []).find((o) => o.id !== l.id && !drop.has(o.id) && o.amount === -l.amount && (l.reversalOfId ? o.entryId === l.reversalOfId : true));
      if (twin) {
        drop.add(l.id);
        drop.add(twin.id);
      }
    }
    return lines.filter((l) => !drop.has(l.id));
  }

  // ================================================================ matching workspace

  /** Open statement lines, open book lines and the suggested matches for one bank account. */
  async workspace(tenantId: string, q: { accountId: string; from?: string; to?: string }) {
    const accountId = uuid.parse(q.accountId);
    const account = await this.bankAccount(tenantId, accountId);
    await this.deps.acct.ensureFresh(tenantId);
    await this.healStaleMatches(tenantId, accountId);
    const from = q.from && isValidDate(q.from) ? q.from : null;
    const to = q.to && isValidDate(q.to) ? q.to : null;
    const bank = await this.db
      .select()
      .from(acctBankLines)
      .where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.accountId, accountId), eq(acctBankLines.status, "open"), from ? gte(acctBankLines.date, from) : undefined, to ? lte(acctBankLines.date, to) : undefined))
      .orderBy(asc(acctBankLines.date), asc(acctBankLines.seq))
      .limit(1500);
    // Book lines from 45 days before the first open statement line (cheques take time) to 7 days after the last.
    const dates = bank.map((b) => b.date).sort();
    const bookFrom = from ? addDays(from, -45) : dates[0] ? addDays(dates[0], -45) : null;
    const bookTo = to ? addDays(to, 7) : null;
    const book = BankService.dropCancelled(await this.bookLines(tenantId, accountId, { from: bookFrom, to: bookTo, onlyOpen: true, limit: 4000 }));
    const suggestions = this.suggest(bank, book);
    const [summary] = await this.db
      .select({
        open: sql<string>`count(*) filter (where ${acctBankLines.status} = 'open')`,
        matched: sql<string>`count(*) filter (where ${acctBankLines.status} = 'matched')`,
        excluded: sql<string>`count(*) filter (where ${acctBankLines.status} = 'excluded')`,
      })
      .from(acctBankLines)
      .where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.accountId, accountId)));
    return {
      account: { id: account.id, name: account.name, code: account.code, bankName: account.bankName, bankAccountLast4: account.bankAccountLast4 },
      bankLines: bank,
      bookLines: book,
      suggestions,
      summary: { open: num(summary?.open), matched: num(summary?.matched), excluded: num(summary?.excluded), openBook: book.length },
    };
  }

  private suggest(bank: readonly AcctBankLine[], book: readonly BookLineRow[]): MatchSuggestion[] {
    const side: BookSideLine[] = book.map((b) => ({ id: b.id, date: b.date, amount: b.amount, narration: b.narration, reference: b.reference, number: b.number, chequeNo: b.chequeNo }));
    const out = suggestMatches(
      bank.map((b) => ({ id: b.id, date: b.date, amount: b.amount, narration: b.narration, reference: b.reference })),
      side,
    );
    // Book lines that cancel each other (a posting changed after it was matched: its reversal and the new version).
    const used = new Set(out.flatMap((s) => s.bookIds));
    const byKey = new Map<string, BookLineRow[]>();
    for (const b of book) if (!used.has(b.id)) byKey.set(b.pairKey, [...(byKey.get(b.pairKey) ?? []), b]);
    for (const list of byKey.values()) {
      for (const a of list) {
        if (used.has(a.id)) continue;
        const twin = list.find((x) => x.id !== a.id && !used.has(x.id) && x.amount === -a.amount);
        if (!twin) continue;
        used.add(a.id);
        used.add(twin.id);
        out.push({ kind: "one_to_one", bankIds: [], bookIds: [a.id, twin.id], confidence: 90, reasons: ["Book entries that cancel each other (the document was changed)"] });
      }
    }
    return out.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * A matched book line whose entry was later reversed by the document sync (the bill, payment or expense changed):
   * unless confirmed as reconciled, the match is removed so the statement line can be matched to the new version.
   * Kept when the reversal itself is real money going back (a bounced cheque): then only the reversal is left open.
   */
  private async healStaleMatches(tenantId: string, accountId: string) {
    const stale = await this.db
      .select({ groupId: acctBankMatches.groupId, reconciledAt: acctBankMatches.reconciledAt, reversedById: acctEntries.reversedById, sourceType: acctEntries.sourceType, sourceId: acctEntries.sourceId })
      .from(acctBankMatches)
      .innerJoin(acctLines, eq(acctLines.id, acctBankMatches.acctLineId))
      .innerJoin(acctEntries, eq(acctEntries.id, acctLines.entryId))
      .where(and(eq(acctBankMatches.tenantId, tenantId), eq(acctBankMatches.accountId, accountId), eq(acctEntries.status, "reversed"), isNull(acctBankMatches.reconciledAt), eq(acctEntries.origin, "auto")));
    for (const s of stale) {
      // Only when a newer version of the same document was posted (an edit); a plain removal keeps the match.
      if (!s.sourceType || !s.sourceId) continue;
      const [newer] = await this.db
        .select({ id: acctEntries.id })
        .from(acctEntries)
        .where(and(eq(acctEntries.tenantId, tenantId), eq(acctEntries.sourceType, s.sourceType), eq(acctEntries.sourceId, s.sourceId), eq(acctEntries.status, "posted")))
        .limit(1);
      if (newer) await this.unmatch(tenantId, s.groupId, { force: false, auto: true });
    }
  }

  /** Matches statement lines with book lines (totals must agree, or the difference is posted to an account). */
  async match(tenantId: string, input: z.input<typeof matchInput>, userId: string | null, how: { method?: string; confidence?: number | null } = {}) {
    const p = matchInput.parse(input);
    await this.bankAccount(tenantId, p.accountId);
    if (p.bankLineIds.length + p.bookLineIds.length < 2) throw badRequest("Pick a statement line and the entries it matches");
    const groupId = randomUUID();
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`acct-bank:${tenantId}:${p.accountId}`}))`);
      const bank = p.bankLineIds.length
        ? await tx
            .select()
            .from(acctBankLines)
            .where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.accountId, p.accountId), inArray(acctBankLines.id, p.bankLineIds)))
            .for("update")
        : [];
      if (bank.length !== new Set(p.bankLineIds).size) throw badRequest("A statement line was not found on this account");
      if (bank.some((b) => b.status !== "open")) throw conflict("A statement line is already matched or left out");
      const book = p.bookLineIds.length
        ? await tx
            .select({ id: acctLines.id, debit: acctLines.debit, credit: acctLines.credit, date: acctLines.entryDate })
            .from(acctLines)
            .where(and(eq(acctLines.tenantId, tenantId), eq(acctLines.accountId, p.accountId), inArray(acctLines.id, p.bookLineIds)))
        : [];
      if (book.length !== new Set(p.bookLineIds).size) throw badRequest("A book entry was not found on this account");
      const taken = p.bookLineIds.length
        ? await tx.select({ id: acctBankMatches.id }).from(acctBankMatches).where(and(eq(acctBankMatches.tenantId, tenantId), inArray(acctBankMatches.acctLineId, p.bookLineIds))).limit(1)
        : [];
      if (taken.length) throw conflict("A book entry is already matched");
      const bankSum = bank.reduce((t, b) => t + b.amount, 0);
      const bookSum = book.reduce((t, b) => t + b.debit - b.credit, 0);
      const bookIds = [...p.bookLineIds];
      let differenceEntryId: string | null = null;
      if (bankSum !== bookSum) {
        if (!p.differenceAccountId || bank.length === 0) {
          throw badRequest(`The amounts don't agree: statement ₹${(bankSum / 100).toFixed(2)}, books ₹${(bookSum / 100).toFixed(2)}. Choose an account for the difference or change the selection.`, { bankSum, bookSum });
        }
        const other = await this.deps.acct.getAccount(tenantId, p.differenceAccountId);
        if (other.id === p.accountId) throw badRequest("Choose another account for the difference");
        const d = bankSum - bookSum;
        const when = bank.map((b) => b.date).sort().at(-1)!;
        differenceEntryId = await this.deps.acct.postModuleEntry(
          tenantId,
          {
            sourceType: "bank_difference",
            sourceId: groupId,
            date: when,
            narration: p.note ?? `Difference on a bank match (${d < 0 ? "charges" : "extra received"})`,
            lines:
              d < 0
                ? [
                    { accountId: other.id, debit: -d, credit: 0 },
                    { accountId: p.accountId, debit: 0, credit: -d },
                  ]
                : [
                    { accountId: p.accountId, debit: d, credit: 0 },
                    { accountId: other.id, debit: 0, credit: d },
                  ],
          },
          { tx, userId },
        );
        const [line] = await tx.select({ id: acctLines.id }).from(acctLines).where(and(eq(acctLines.entryId, differenceEntryId), eq(acctLines.accountId, p.accountId))).limit(1);
        bookIds.push(line!.id);
      }
      if (bank.length === 0 && bookSum !== 0) throw badRequest("Book entries matched with each other must cancel out (add up to zero)");
      await this.insertGroup(tx, tenantId, p.accountId, groupId, bank.map((b) => b.id), bookIds, how.method ?? "manual", how.confidence ?? null, userId);
      return { groupId, differenceEntryId, bankLines: bank.length, bookLines: bookIds.length };
    });
    return result;
  }

  private async insertGroup(tx: DbOrTx, tenantId: string, accountId: string, groupId: string, bankIds: string[], bookIds: string[], method: string, confidence: number | null, userId: string | null) {
    const rows = [
      ...bankIds.map((id) => ({ tenantId, accountId, groupId, bankLineId: id, acctLineId: null, method, confidence, createdBy: userId })),
      ...bookIds.map((id) => ({ tenantId, accountId, groupId, bankLineId: null, acctLineId: id, method, confidence, createdBy: userId })),
    ];
    await tx.insert(acctBankMatches).values(rows);
    if (bankIds.length) await tx.update(acctBankLines).set({ status: "matched", matchGroupId: groupId }).where(and(eq(acctBankLines.tenantId, tenantId), inArray(acctBankLines.id, bankIds)));
    // Cheques behind the matched book lines are cleared on the statement date.
    if (bookIds.length && bankIds.length) {
      const [last] = await tx.select({ d: sql<string>`max(${acctBankLines.date})` }).from(acctBankLines).where(inArray(acctBankLines.id, bankIds));
      await tx
        .update(acctCheques)
        .set({ status: "cleared", clearedOn: last?.d ?? this.today() })
        .where(and(eq(acctCheques.tenantId, tenantId), inArray(acctCheques.acctLineId, bookIds), inArray(acctCheques.status, ["pending", "deposited"])));
    }
  }

  /** Removes a match. Refused once the reconciliation covering it was confirmed. A difference entry is reversed. */
  async unmatch(tenantId: string, groupId: string, opts: { force?: boolean; auto?: boolean; userId?: string | null } = {}) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(acctBankMatches).where(and(eq(acctBankMatches.tenantId, tenantId), eq(acctBankMatches.groupId, groupId)));
      if (!rows.length) throw notFound("Match");
      if (rows.some((r) => r.reconciledAt) && !opts.force) throw conflict("This match is part of a confirmed reconciliation. Re-open the reconciliation first.");
      const bankIds = rows.filter((r) => r.bankLineId).map((r) => r.bankLineId!);
      const bookIds = rows.filter((r) => r.acctLineId).map((r) => r.acctLineId!);
      await tx.delete(acctBankMatches).where(and(eq(acctBankMatches.tenantId, tenantId), eq(acctBankMatches.groupId, groupId)));
      if (bankIds.length) await tx.update(acctBankLines).set({ status: "open", matchGroupId: null }).where(and(eq(acctBankLines.tenantId, tenantId), inArray(acctBankLines.id, bankIds)));
      if (bookIds.length) {
        await tx
          .update(acctCheques)
          .set({ status: sql`case when ${acctCheques.depositedOn} is not null then 'deposited' else 'pending' end`, clearedOn: null })
          .where(and(eq(acctCheques.tenantId, tenantId), inArray(acctCheques.acctLineId, bookIds), eq(acctCheques.status, "cleared")));
      }
      const [diff] = await tx
        .select({ id: acctEntries.id, date: acctEntries.date })
        .from(acctEntries)
        .where(and(eq(acctEntries.tenantId, tenantId), eq(acctEntries.sourceType, "bank_difference"), eq(acctEntries.sourceId, groupId), eq(acctEntries.status, "posted")))
        .limit(1);
      if (diff) await this.deps.acct.reverseModuleEntry(tenantId, diff.id, { date: diff.date, reason: "Bank match removed", sourceType: "bank_difference_reversal" }, { tx, userId: opts.userId ?? null });
      return { unmatched: rows.length, auto: !!opts.auto };
    });
  }

  /** Accepts every suggestion at or above `minConfidence` (default 90). */
  async autoMatch(tenantId: string, input: { accountId: string; minConfidence?: number }, userId: string | null) {
    const min = Math.min(100, Math.max(50, Number(input.minConfidence ?? 90) || 90));
    const ws = await this.workspace(tenantId, { accountId: input.accountId });
    let matched = 0;
    for (const s of ws.suggestions) {
      if (s.confidence < min) continue;
      try {
        await this.match(tenantId, { accountId: input.accountId, bankLineIds: s.bankIds, bookLineIds: s.bookIds }, userId, { method: "auto", confidence: s.confidence });
        matched++;
      } catch {
        // Someone else matched a line in between; skip it.
      }
    }
    return { matched, suggestions: ws.suggestions.length };
  }

  /** Posts an entry for a statement line that is not in the books (bank charges, interest, cash deposit ...) and matches it. */
  async createEntry(tenantId: string, bankLineId: string, input: z.input<typeof createEntryInput>, userId: string | null) {
    const p = createEntryInput.parse(input);
    const [line] = await this.db.select().from(acctBankLines).where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.id, bankLineId))).limit(1);
    if (!line) throw notFound("Statement line");
    if (line.status !== "open") throw conflict("This statement line is already matched or left out");
    const key = ALLOWED_PRESET_KEY[p.preset];
    let otherId: string;
    if (key) otherId = await this.deps.acct.accountIdByKey(tenantId, key);
    else {
      if (!p.accountId) throw badRequest("Choose the account");
      otherId = (await this.deps.acct.getAccount(tenantId, p.accountId)).id;
    }
    if (otherId === line.accountId) throw badRequest("Choose an account other than this bank account");
    if (p.preset === "cash_deposit" && line.amount < 0) throw badRequest("A cash deposit is money coming into the bank");
    if (p.preset === "cash_withdrawal" && line.amount > 0) throw badRequest("A cash withdrawal is money going out of the bank");
    const amt = Math.abs(line.amount);
    const party = p.partyType && p.partyId ? { partyType: p.partyType, partyId: p.partyId } : {};
    const narration = p.narration ?? (line.narration ? `Bank: ${line.narration}` : "From the bank statement");
    return this.db.transaction(async (tx) => {
      const entryId = await this.deps.acct.postModuleEntry(
        tenantId,
        {
          sourceType: "bank_entry",
          sourceId: line.id,
          date: line.date,
          narration,
          reference: line.reference,
          lines:
            line.amount < 0
              ? [
                  { accountId: otherId, debit: amt, credit: 0, ...party },
                  { accountId: line.accountId, debit: 0, credit: amt },
                ]
              : [
                  { accountId: line.accountId, debit: amt, credit: 0 },
                  { accountId: otherId, debit: 0, credit: amt, ...party },
                ],
        },
        { tx, userId },
      );
      const [bookLine] = await tx.select({ id: acctLines.id }).from(acctLines).where(and(eq(acctLines.entryId, entryId), eq(acctLines.accountId, line.accountId))).limit(1);
      const groupId = randomUUID();
      await this.insertGroup(tx, tenantId, line.accountId, groupId, [line.id], [bookLine!.id], "created", 100, userId);
      return { entryId, groupId };
    });
  }

  /** Cancels an entry made from a statement line: reverses it and frees the line. */
  async cancelCreatedEntry(tenantId: string, bankLineId: string, userId: string | null) {
    const [e] = await this.db
      .select({ id: acctEntries.id, date: acctEntries.date })
      .from(acctEntries)
      .where(and(eq(acctEntries.tenantId, tenantId), eq(acctEntries.sourceType, "bank_entry"), eq(acctEntries.sourceId, bankLineId), eq(acctEntries.status, "posted")))
      .limit(1);
    if (!e) throw notFound("Entry made from this line");
    const [line] = await this.db.select().from(acctBankLines).where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.id, bankLineId))).limit(1);
    if (line?.matchGroupId) await this.unmatch(tenantId, line.matchGroupId, { userId });
    await this.deps.acct.reverseModuleEntry(tenantId, e.id, { date: e.date, reason: "Entry from the bank statement cancelled", sourceType: "bank_entry_reversal" }, { userId });
    return { ok: true as const };
  }

  /** Leaves a statement line out of the reconciliation (an opening-balance row, a line the bank reversed the same day). */
  async setExcluded(tenantId: string, bankLineId: string, excluded: boolean, note: string | null) {
    const [line] = await this.db.select().from(acctBankLines).where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.id, bankLineId))).limit(1);
    if (!line) throw notFound("Statement line");
    if (line.status === "matched") throw conflict("Unmatch the line first");
    await this.db
      .update(acctBankLines)
      .set({ status: excluded ? "excluded" : "open", note: note?.slice(0, 200) ?? null })
      .where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.id, bankLineId)));
    return { ok: true as const };
  }

  /** The match group a line belongs to, with both sides (for the "matched" list). */
  async matchedGroups(tenantId: string, accountId: string, q: { limit?: number } = {}) {
    const groups = await this.db
      .select({ groupId: acctBankMatches.groupId, at: sql<string>`max(${acctBankMatches.createdAt})`, method: sql<string>`max(${acctBankMatches.method})`, reconciled: sql<boolean>`bool_or(${acctBankMatches.reconciledAt} is not null)` })
      .from(acctBankMatches)
      .where(and(eq(acctBankMatches.tenantId, tenantId), eq(acctBankMatches.accountId, accountId)))
      .groupBy(acctBankMatches.groupId)
      .orderBy(desc(sql`max(${acctBankMatches.createdAt})`))
      .limit(Math.min(q.limit ?? 50, 200));
    if (!groups.length) return { items: [] };
    const ids = groups.map((g) => g.groupId);
    const [bank, book] = await Promise.all([
      this.db
        .select({ groupId: acctBankMatches.groupId, id: acctBankLines.id, date: acctBankLines.date, amount: acctBankLines.amount, narration: acctBankLines.narration, reference: acctBankLines.reference })
        .from(acctBankMatches)
        .innerJoin(acctBankLines, eq(acctBankLines.id, acctBankMatches.bankLineId))
        .where(and(eq(acctBankMatches.tenantId, tenantId), inArray(acctBankMatches.groupId, ids))),
      this.db
        .select({ groupId: acctBankMatches.groupId, id: acctLines.id, date: acctLines.entryDate, debit: acctLines.debit, credit: acctLines.credit, narration: acctEntries.narration, number: acctEntries.number })
        .from(acctBankMatches)
        .innerJoin(acctLines, eq(acctLines.id, acctBankMatches.acctLineId))
        .innerJoin(acctEntries, eq(acctEntries.id, acctLines.entryId))
        .where(and(eq(acctBankMatches.tenantId, tenantId), inArray(acctBankMatches.groupId, ids))),
    ]);
    return {
      items: groups.map((g) => ({
        groupId: g.groupId,
        method: g.method,
        reconciled: !!g.reconciled,
        at: g.at,
        bankLines: bank.filter((b) => b.groupId === g.groupId),
        bookLines: book.filter((b) => b.groupId === g.groupId).map((b) => ({ id: b.id, date: b.date, amount: b.debit - b.credit, narration: b.narration, number: b.number })),
      })),
    };
  }

  // ================================================================ reconciliation statement

  async reconciliation(tenantId: string, q: { accountId: string; asOf?: string; bankBalance?: string | number | null }): Promise<ReconciliationStatement & { account: { id: string; name: string; code: string }; statementBalance: number | null; statementFrom: string | null; assumedCleared: number; reconciledThrough: string | null; history: (typeof acctBankRecons.$inferSelect)[]; postDated: AcctCheque[] }> {
    const accountId = uuid.parse(q.accountId);
    const account = await this.bankAccount(tenantId, accountId);
    await this.deps.acct.ensureFresh(tenantId);
    const asOf = q.asOf && isValidDate(q.asOf) ? q.asOf : this.today();
    const bookBalance = await this.deps.acct.accountBalance(tenantId, accountId, asOf);
    const allBook = await this.bookLines(tenantId, accountId, { to: asOf, limit: 200_000 });
    // Cleared date of each matched book line = latest statement date in its group; booked date of statement lines = latest book date.
    const groups = new Set(allBook.filter((b) => b.matchGroupId).map((b) => b.matchGroupId!));
    const bankRows = await this.db
      .select()
      .from(acctBankLines)
      .where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.accountId, accountId), lte(acctBankLines.date, asOf)))
      .orderBy(asc(acctBankLines.date), asc(acctBankLines.seq));
    for (const b of bankRows) if (b.matchGroupId) groups.add(b.matchGroupId);
    const groupBankDate = new Map<string, string>();
    const groupBookDate = new Map<string, string>();
    if (groups.size) {
      const ids = [...groups];
      for (let i = 0; i < ids.length; i += 1000) {
        const part = ids.slice(i, i + 1000);
        const rows = await this.db
          .select({ groupId: acctBankMatches.groupId, bankDate: sql<string | null>`max(${acctBankLines.date})`, bookDate: sql<string | null>`max(${acctLines.entryDate})` })
          .from(acctBankMatches)
          .leftJoin(acctBankLines, eq(acctBankLines.id, acctBankMatches.bankLineId))
          .leftJoin(acctLines, eq(acctLines.id, acctBankMatches.acctLineId))
          .where(and(eq(acctBankMatches.tenantId, tenantId), inArray(acctBankMatches.groupId, part)))
          .groupBy(acctBankMatches.groupId);
        for (const r of rows) {
          // Book lines matched with each other (no statement line) count as cleared on their own date.
          groupBankDate.set(r.groupId, r.bankDate ?? r.bookDate ?? asOf);
          if (r.bookDate) groupBookDate.set(r.groupId, r.bookDate);
        }
      }
    }
    const open = BankService.dropCancelled(allBook.filter((b) => !b.matchGroupId));
    const matched = allBook.filter((b) => b.matchGroupId);
    // Entries dated before the first imported statement line are taken as already in the bank: the statement's
    // opening balance includes them. (One that clears later shows on the statement; match it and it counts then.)
    const firstLine = bankRows.find((b) => b.status !== "excluded")?.date ?? null;
    let assumedCleared = 0;
    const book = [...open, ...matched].map((b) => {
      let clearedOn = b.matchGroupId ? (groupBankDate.get(b.matchGroupId) ?? null) : null;
      if (!b.matchGroupId && firstLine && b.date < firstLine) {
        clearedOn = b.date;
        assumedCleared++;
      }
      return { id: b.id, date: b.date, amount: b.amount, narration: b.narration, number: b.number, chequeNo: b.chequeNo, clearedOn };
    });
    // Lines dropped as cancelling pairs are equal and opposite, so the book balance is unaffected.
    const bank = bankRows.map((b) => ({
      id: b.id,
      date: b.date,
      amount: b.amount,
      narration: b.narration,
      reference: b.reference,
      excluded: b.status === "excluded",
      bookedOn: b.matchGroupId ? (groupBookDate.get(b.matchGroupId) ?? null) : null,
    }));
    const statementBalance = statementBalanceOn(bankRows.filter((b) => b.status !== "excluded"), asOf);
    const typed = q.bankBalance === undefined || q.bankBalance === null || q.bankBalance === "" ? null : Math.round(Number(q.bankBalance));
    const bankBalance = typed !== null && Number.isFinite(typed) ? typed : statementBalance;
    const st = buildReconciliation(asOf, bookBalance, book, bank, bankBalance);
    const history = await this.db
      .select()
      .from(acctBankRecons)
      .where(and(eq(acctBankRecons.tenantId, tenantId), eq(acctBankRecons.accountId, accountId)))
      .orderBy(desc(acctBankRecons.asOf), desc(acctBankRecons.at))
      .limit(20);
    const postDated = await this.db
      .select()
      .from(acctCheques)
      .where(and(eq(acctCheques.tenantId, tenantId), eq(acctCheques.accountId, accountId), inArray(acctCheques.status, ["pending", "deposited"]), isNull(acctCheques.acctLineId)))
      .orderBy(asc(acctCheques.chequeDate))
      .limit(200);
    return { ...st, account: { id: account.id, name: account.name, code: account.code }, statementBalance, statementFrom: firstLine, assumedCleared, reconciledThrough: history[0]?.asOf ?? null, history, postDated };
  }

  /** Confirms the reconciliation on a date: records it and freezes the matches up to it. */
  async confirm(tenantId: string, input: { accountId: string; asOf: string; bankBalance?: number | null; note?: string | null; acceptDifference?: boolean }, userId: string | null) {
    const p = z
      .object({ accountId: uuid, asOf: date, bankBalance: z.number().int().nullish(), note: optText(300), acceptDifference: z.boolean().optional() })
      .strict()
      .parse(input);
    if (p.asOf > this.today()) throw badRequest("You can't reconcile a date that has not come yet");
    const st = await this.reconciliation(tenantId, { accountId: p.accountId, asOf: p.asOf, bankBalance: p.bankBalance ?? null });
    if (st.bankBalance === null) throw badRequest("Type the balance shown on the bank statement for that date");
    if (st.difference !== 0 && !p.acceptDifference) throw conflict(`There is a difference of ₹${((st.difference ?? 0) / 100).toFixed(2)}. Match or add the missing entries, or confirm with a note.`);
    if (st.difference !== 0 && !p.note) throw badRequest("Write a note explaining the difference");
    await this.db.transaction(async (tx) => {
      await tx.insert(acctBankRecons).values({ tenantId, accountId: p.accountId, asOf: p.asOf, bookBalance: st.bookBalance, bankBalance: st.bankBalance!, difference: st.difference ?? 0, note: p.note, userId });
      await tx.execute(sql`
        update ${acctBankMatches} m set reconciled_at = now()
        where m.tenant_id = ${tenantId} and m.account_id = ${p.accountId} and m.reconciled_at is null
          and not exists (select 1 from ${acctBankMatches} x join ${acctBankLines} b on b.id = x.bank_line_id where x.group_id = m.group_id and b.date > ${p.asOf})
          and not exists (select 1 from ${acctBankMatches} x join ${acctLines} l on l.id = x.acct_line_id where x.group_id = m.group_id and l.entry_date > ${p.asOf})`);
    });
    const lock = (await this.deps.acct.settings(tenantId)).lockedThrough;
    return { ...st, confirmed: true, suggestLock: !lock || lock < p.asOf ? p.asOf : null };
  }

  /** Re-opens the confirmed reconciliations after a date (the matches can be changed again). */
  async reopen(tenantId: string, input: { accountId: string; after: string; reason: string }) {
    const p = z.object({ accountId: uuid, after: date, reason: z.string().trim().min(1).max(300) }).strict().parse(input);
    await this.db.transaction(async (tx) => {
      await tx.delete(acctBankRecons).where(and(eq(acctBankRecons.tenantId, tenantId), eq(acctBankRecons.accountId, p.accountId), gte(acctBankRecons.asOf, p.after)));
      await tx.execute(sql`
        update ${acctBankMatches} m set reconciled_at = null
        where m.tenant_id = ${tenantId} and m.account_id = ${p.accountId} and m.reconciled_at is not null
          and (exists (select 1 from ${acctBankMatches} x join ${acctBankLines} b on b.id = x.bank_line_id where x.group_id = m.group_id and b.date >= ${p.after})
            or exists (select 1 from ${acctBankMatches} x join ${acctLines} l on l.id = x.acct_line_id where x.group_id = m.group_id and l.entry_date >= ${p.after}))`);
    });
    return { ok: true as const, reason: p.reason };
  }

  /** The reconciliation statement as a table (CSV and PDF). */
  async reconciliationTable(tenantId: string, q: Record<string, string | undefined>, shop: string): Promise<ReportTable> {
    const st = await this.reconciliation(tenantId, { accountId: q.accountId ?? "", asOf: q.asOf, bankBalance: q.bankBalance ?? null });
    const rows: ReportTable["rows"] = [];
    const head = (label: string, amount: number | null) => rows.push({ cells: { date: "", ref: "", label, amount }, style: "head" });
    const item = (d: string, ref: string, label: string, amount: number) => rows.push({ cells: { date: d, ref, label, amount } });
    head("Balance as per books", st.bookBalance);
    head("Add: payments in the books not yet in the bank (cheques issued, transfers)", -st.totals.notInBankPayments);
    for (const l of st.notInBankPayments) item(l.date, l.chequeNo ? `Chq ${l.chequeNo}` : l.number, l.narration, -l.amount);
    head("Less: receipts in the books not yet in the bank (cheques deposited, money in transit)", -st.totals.notInBankReceipts);
    for (const l of st.notInBankReceipts) item(l.date, l.chequeNo ? `Chq ${l.chequeNo}` : l.number, l.narration, -l.amount);
    head("Add: money in the bank not yet in the books", st.totals.notInBooksCredits);
    for (const l of st.notInBooksCredits) item(l.date, l.reference ?? "", l.narration, l.amount);
    head("Less: money out of the bank not yet in the books", st.totals.notInBooksDebits);
    for (const l of st.notInBooksDebits) item(l.date, l.reference ?? "", l.narration, l.amount);
    head("Balance the bank should show", st.expectedBankBalance);
    head("Balance as per the bank statement", st.bankBalance);
    head("Difference", st.difference);
    return {
      title: `Bank reconciliation - ${st.account.name}`,
      subtitle: `${shop ? `${shop} · ` : ""}as on ${st.asOf}`,
      columns: [
        { key: "date", label: "Date" },
        { key: "ref", label: "Cheque / ref" },
        { key: "label", label: "Particulars" },
        { key: "amount", label: "Amount (₹)", kind: "money" },
      ],
      rows,
      notes: ["Amounts are signed as the bank sees them: + money in, - money out. Prepared from the statement lines imported and the matches made in the books."],
    };
  }

  // ================================================================ cheque register

  async cheques(tenantId: string, q: { direction?: string; status?: string; accountId?: string; q?: string } = {}) {
    const statuses = (q.status ?? "").split(",").filter((s) => ["pending", "deposited", "cleared", "bounced", "cancelled"].includes(s));
    const items = await this.db
      .select()
      .from(acctCheques)
      .where(
        and(
          eq(acctCheques.tenantId, tenantId),
          q.direction === "issued" || q.direction === "received" ? eq(acctCheques.direction, q.direction) : undefined,
          statuses.length ? inArray(acctCheques.status, statuses as AcctCheque["status"][]) : undefined,
          q.accountId && uuid.safeParse(q.accountId).success ? eq(acctCheques.accountId, q.accountId) : undefined,
          q.q ? or(sql`${acctCheques.chequeNo} ilike ${`%${q.q.replace(/[\\%_]/g, "\\$&")}%`}`, sql`${acctCheques.partyName} ilike ${`%${q.q.replace(/[\\%_]/g, "\\$&")}%`}`) : undefined,
        ),
      )
      .orderBy(desc(acctCheques.chequeDate), desc(acctCheques.createdAt))
      .limit(500);
    const today = this.today();
    const dueToDeposit = items.filter((c) => c.direction === "received" && c.status === "pending" && c.chequeDate <= today).length;
    const postDated = items.filter((c) => (c.status === "pending" || c.status === "deposited") && c.chequeDate > today).length;
    return { items, today, summary: { dueToDeposit, postDated, uncleared: items.filter((c) => c.status === "pending" || c.status === "deposited").length } };
  }

  private async checkBookLine(tenantId: string, accountId: string, lineId: string | null | undefined) {
    if (!lineId) return;
    const [l] = await this.db.select({ id: acctLines.id }).from(acctLines).where(and(eq(acctLines.tenantId, tenantId), eq(acctLines.id, lineId), eq(acctLines.accountId, accountId))).limit(1);
    if (!l) throw badRequest("That book entry is not on this bank account");
  }

  async createCheque(tenantId: string, input: z.input<typeof chequeInput>, userId: string | null) {
    const p = chequeInput.parse(input);
    await this.bankAccount(tenantId, p.accountId);
    await this.checkBookLine(tenantId, p.accountId, p.acctLineId);
    const [row] = await this.db
      .insert(acctCheques)
      .values({ tenantId, ...p, partyType: p.partyType ?? null, partyId: p.partyId ?? null, acctLineId: p.acctLineId ?? null, createdBy: userId })
      .returning();
    return row!;
  }

  private async cheque(tenantId: string, id: string) {
    const [c] = await this.db.select().from(acctCheques).where(and(eq(acctCheques.tenantId, tenantId), eq(acctCheques.id, id))).limit(1);
    if (!c) throw notFound("Cheque");
    return c;
  }

  async updateCheque(tenantId: string, id: string, input: z.input<typeof chequePatch>) {
    const p = chequePatch.parse(input);
    const c = await this.cheque(tenantId, id);
    if (c.status !== "pending" && c.status !== "deposited" && (p.amount !== undefined || p.chequeNo !== undefined)) throw conflict("A cleared, bounced or cancelled cheque can't be changed");
    if (p.accountId) await this.bankAccount(tenantId, p.accountId);
    await this.checkBookLine(tenantId, p.accountId ?? c.accountId, p.acctLineId);
    const [row] = await this.db.update(acctCheques).set(p).where(and(eq(acctCheques.tenantId, tenantId), eq(acctCheques.id, id))).returning();
    return row!;
  }

  /** Book lines a cheque could be (same amount and direction on its bank account, not yet linked). */
  async chequeCandidates(tenantId: string, id: string) {
    const c = await this.cheque(tenantId, id);
    const want = c.direction === "received" ? c.amount : -c.amount;
    const lines = await this.bookLines(tenantId, c.accountId, { from: addDays(c.chequeDate, -60), to: addDays(c.chequeDate, 60), limit: 2000 });
    const linked = new Set(
      (await this.db.select({ id: acctCheques.acctLineId }).from(acctCheques).where(and(eq(acctCheques.tenantId, tenantId), ne(acctCheques.id, id)))).map((r) => r.id),
    );
    return { items: lines.filter((l) => l.amount === want && !linked.has(l.id) && l.entryStatus === "posted").slice(0, 30) };
  }

  /**
   * Moves a cheque along: deposit (received cheques), clear, bounce, cancel, reopen. A bounce posts the bank's charges
   * (Dr Bank charges / Cr the bank account) and reverses the payment entry when it was a manual entry. When the
   * payment came from a bill or Payables, that document must be changed there (the books follow it); the answer says
   * which document.
   */
  async chequeAction(tenantId: string, id: string, input: z.input<typeof chequeAction>, userId: string | null) {
    const p = chequeAction.parse(input);
    const c = await this.cheque(tenantId, id);
    const when = p.date ?? this.today();
    const set: Partial<typeof acctCheques.$inferInsert> = {};
    let sourceFix: { sourceType: string | null; sourceId: string | null; number: string } | null = null;
    switch (p.action) {
      case "deposit":
        if (c.direction !== "received") throw badRequest("Only a received cheque is deposited");
        if (c.status !== "pending") throw conflict("Only a cheque not yet deposited can be deposited");
        set.status = "deposited";
        set.depositedOn = when;
        break;
      case "clear":
        if (c.status !== "pending" && c.status !== "deposited") throw conflict("This cheque is already settled");
        set.status = "cleared";
        set.clearedOn = when;
        break;
      case "cancel":
        if (c.status === "cleared") throw conflict("A cleared cheque can't be cancelled");
        set.status = "cancelled";
        break;
      case "reopen":
        if (c.status !== "cancelled" && c.status !== "bounced") throw conflict("Only a cancelled or bounced cheque can be opened again");
        set.status = c.depositedOn ? "deposited" : "pending";
        set.bouncedOn = null;
        break;
      case "bounce": {
        if (c.status === "cancelled" || c.status === "bounced") throw conflict("This cheque is already closed");
        set.status = "bounced";
        set.bouncedOn = when;
        set.bounceReason = p.reason ?? null;
        set.bounceCharges = p.charges ?? 0;
        const entries = [...c.entryIds];
        if (p.charges && p.charges > 0) {
          const chargesAcct = await this.deps.acct.accountIdByKey(tenantId, SYS.bankCharges);
          entries.push(
            await this.deps.acct.postModuleEntry(
              tenantId,
              {
                sourceType: "cheque_bounce",
                sourceId: c.id,
                date: when,
                narration: `Cheque ${c.chequeNo} bounced${c.partyName ? ` (${c.partyName})` : ""}: bank charges${p.reason ? ` - ${p.reason}` : ""}`,
                reference: c.chequeNo,
                lines: [
                  { accountId: chargesAcct, debit: p.charges, credit: 0 },
                  { accountId: c.accountId, debit: 0, credit: p.charges },
                ],
              },
              { userId },
            ),
          );
        }
        if (c.acctLineId) {
          const [e] = await this.db
            .select({ id: acctEntries.id, origin: acctEntries.origin, status: acctEntries.status, sourceType: acctEntries.sourceType, sourceId: acctEntries.sourceId, number: acctEntries.number })
            .from(acctLines)
            .innerJoin(acctEntries, eq(acctEntries.id, acctLines.entryId))
            .where(and(eq(acctLines.tenantId, tenantId), eq(acctLines.id, c.acctLineId)))
            .limit(1);
          if (e && e.status === "posted") {
            if (e.origin === "manual") {
              const r = await this.deps.acct.reverseEntry(tenantId, e.id, { date: when, reason: `Cheque ${c.chequeNo} bounced` }, userId);
              entries.push(r.id);
            } else sourceFix = { sourceType: e.sourceType, sourceId: e.sourceId, number: e.number };
          }
        }
        set.entryIds = entries;
        break;
      }
    }
    const [row] = await this.db.update(acctCheques).set(set).where(and(eq(acctCheques.tenantId, tenantId), eq(acctCheques.id, id))).returning();
    return { cheque: row!, sourceFix };
  }
}
