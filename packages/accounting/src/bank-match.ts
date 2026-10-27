/**
 * Matching bank statement lines to book lines (journal lines on the bank account). Pure: the service loads the open
 * lines of both sides and accepts or shows the suggestions.
 *
 * Signs: a statement line is + for money in (deposit) and - for money out; a book line is debit - credit on the bank
 * account (+ money in). A match always has equal totals on both sides.
 *
 * 1. One to one: the same amount within a date window (7 days; 45 when the cheque / reference number agrees). Score =
 *    amount (50) + how close the dates are (up to 25) + reference / cheque number (30) + words of the narration and the
 *    party name (up to 15) + whether the amount is unique among the candidates (+10, or -10 when many lines share it).
 * 2. Many book lines to one statement line (a UPI or card settlement, a deposit of several cheques): the statement
 *    amount is the exact sum of 2-5 book lines of the same direction dated up to `windowDays` before it.
 * 3. One book line to several statement lines (a payment split by the bank): the other way round.
 * Suggestions never share a line; the best score wins. Confidence is 0-100; 90 and above is safe to accept in bulk.
 */

export interface BankSideLine {
  id: string;
  date: string;
  amount: number;
  narration: string;
  reference: string | null;
}

export interface BookSideLine {
  id: string;
  date: string;
  amount: number;
  narration: string;
  reference: string | null;
  /** Entry number (AU-000012). */
  number?: string | null;
  /** Cheque number from the cheque register, when the line is a cheque. */
  chequeNo?: string | null;
  partyName?: string | null;
}

export type MatchKind = "one_to_one" | "many_book" | "many_bank";

export interface MatchSuggestion {
  kind: MatchKind;
  bankIds: string[];
  bookIds: string[];
  confidence: number;
  /** Plain reasons for the screen: "Same amount", "Same day", "Cheque 123456 agrees", ... */
  reasons: string[];
}

export interface MatchOptions {
  windowDays?: number;
  chequeWindowDays?: number;
  maxGroup?: number;
  /** Candidates looked at per line for the grouped matches (nearest dates first). */
  groupCandidates?: number;
}

const DAY = 86_400_000;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

const STOP = new Set([
  "upi", "neft", "imps", "rtgs", "trf", "transfer", "to", "from", "by", "the", "and", "for", "ach", "nach", "pos", "atm", "inb", "mob", "ref", "txn", "payment",
  "paid", "received", "cr", "dr", "bank", "ltd", "pvt", "limited", "cash", "chq", "cheque", "dep", "deposit", "clg", "clearing", "inv", "bill", "via", "with", "upi/",
]);

/** Words worth comparing (3+ letters, no bank jargon). */
export function words(s: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of (s ?? "").toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
  return out;
}

/** Numbers of 4+ digits (cheque numbers, UTRs, bill numbers), without leading zeros. */
export function refTokens(...parts: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const p of parts) for (const m of (p ?? "").matchAll(/\d{4,}/g)) out.add(m[0].replace(/^0+(?=\d)/, ""));
  return out;
}

const overlap = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
};

function scorePair(bank: BankSideLine, book: BookSideLine, opts: Required<MatchOptions>, sameAmount: { bank: number; book: number }): MatchSuggestion | null {
  if (bank.amount !== book.amount) return null;
  const gap = Math.abs(daysBetween(book.date, bank.date));
  const bankRefs = refTokens(bank.reference, bank.narration);
  const bookRefs = refTokens(book.reference, book.chequeNo, book.narration);
  const refHit = overlap(bankRefs, bookRefs) > 0;
  if (gap > (refHit ? opts.chequeWindowDays : opts.windowDays)) return null;
  const reasons = ["Same amount"];
  let score = 50;
  if (gap === 0) {
    score += 25;
    reasons.push("Same day");
  } else if (gap <= 1) {
    score += 20;
    reasons.push("1 day apart");
  } else if (gap <= 3) {
    score += 12;
    reasons.push(`${gap} days apart`);
  } else if (gap <= 7) {
    score += 5;
    reasons.push(`${gap} days apart`);
  } else reasons.push(`${gap} days apart`);
  if (refHit) {
    score += 30;
    reasons.push(book.chequeNo ? `Cheque ${book.chequeNo} agrees` : "Reference number agrees");
  }
  const bw = words(bank.narration);
  const common = overlap(bw, words(`${book.narration} ${book.reference ?? ""}`));
  const party = book.partyName ? overlap(bw, words(book.partyName)) : 0;
  if (party > 0) {
    score += 10;
    reasons.push("Party name in the narration");
  }
  if (common > 0) {
    score += Math.min(5 * common, party > 0 ? 5 : 15);
    if (party === 0) reasons.push("Similar narration");
  }
  if (sameAmount.bank === 1 && sameAmount.book === 1) {
    score += 10;
    reasons.push("Only line with this amount");
  } else if (sameAmount.bank > 2 || sameAmount.book > 2) score -= 10;
  return { kind: "one_to_one", bankIds: [bank.id], bookIds: [book.id], confidence: Math.max(1, Math.min(100, score)), reasons };
}

/** Subsets of 2..max items whose amounts add up to `target` exactly (same sign as target). Best = closest dates first. */
export function subsetsSumming<T extends { amount: number }>(items: readonly T[], target: number, max: number, budget = 20_000): T[][] {
  const sign = Math.sign(target);
  const pool = items.filter((i) => Math.sign(i.amount) === sign && Math.abs(i.amount) < Math.abs(target));
  const abs = Math.abs(target);
  const out: T[][] = [];
  let steps = 0;
  const pick: T[] = [];
  const walk = (start: number, left: number) => {
    if (out.length >= 3 || steps > budget) return;
    for (let i = start; i < pool.length; i++) {
      steps++;
      const a = Math.abs(pool[i]!.amount);
      if (a > left) continue;
      pick.push(pool[i]!);
      if (a === left) {
        if (pick.length >= 2) out.push([...pick]);
      } else if (pick.length < max) walk(i + 1, left - a);
      pick.pop();
      if (out.length >= 3 || steps > budget) return;
    }
  };
  walk(0, abs);
  return out;
}

/** All suggestions, best first, without two suggestions sharing a line. */
export function suggestMatches(bank: readonly BankSideLine[], book: readonly BookSideLine[], options: MatchOptions = {}): MatchSuggestion[] {
  const opts: Required<MatchOptions> = { windowDays: 7, chequeWindowDays: 45, maxGroup: 5, groupCandidates: 18, ...options };
  const countBy = (xs: readonly { amount: number }[]) => {
    const m = new Map<number, number>();
    for (const x of xs) m.set(x.amount, (m.get(x.amount) ?? 0) + 1);
    return m;
  };
  const bankCount = countBy(bank);
  const bookCount = countBy(book);
  const bookByAmount = new Map<number, BookSideLine[]>();
  for (const b of book) bookByAmount.set(b.amount, [...(bookByAmount.get(b.amount) ?? []), b]);

  const pairs: MatchSuggestion[] = [];
  for (const s of bank) {
    for (const b of bookByAmount.get(s.amount) ?? []) {
      const p = scorePair(s, b, opts, { bank: bankCount.get(s.amount) ?? 0, book: bookCount.get(s.amount) ?? 0 });
      if (p) pairs.push(p);
    }
  }
  pairs.sort((a, b) => b.confidence - a.confidence || a.bankIds[0]!.localeCompare(b.bankIds[0]!));
  const usedBank = new Set<string>();
  const usedBook = new Set<string>();
  const out: MatchSuggestion[] = [];
  for (const p of pairs) {
    if (usedBank.has(p.bankIds[0]!) || usedBook.has(p.bookIds[0]!)) continue;
    usedBank.add(p.bankIds[0]!);
    usedBook.add(p.bookIds[0]!);
    out.push(p);
  }

  // Many book lines -> one statement line (settlements, several cheques in one deposit).
  for (const s of bank) {
    if (usedBank.has(s.id)) continue;
    const near = book
      .filter((b) => !usedBook.has(b.id) && daysBetween(b.date, s.date) >= 0 && daysBetween(b.date, s.date) <= opts.windowDays)
      .sort((x, y) => daysBetween(x.date, s.date) - daysBetween(y.date, s.date) || Math.abs(y.amount) - Math.abs(x.amount))
      .slice(0, opts.groupCandidates)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const sets = subsetsSumming(near, s.amount, opts.maxGroup);
    if (!sets.length) continue;
    const best = sets.sort((a, b) => spread(a, s.date) - spread(b, s.date) || a.length - b.length)[0]!;
    if (best.some((b) => usedBook.has(b.id))) continue;
    usedBank.add(s.id);
    for (const b of best) usedBook.add(b.id);
    const sp = spread(best, s.date);
    out.push({
      kind: "many_book",
      bankIds: [s.id],
      bookIds: best.map((b) => b.id),
      confidence: Math.max(40, Math.min(85, 80 - 4 * (best.length - 2) - 2 * sp + (sets.length === 1 ? 5 : -10))),
      reasons: [`${best.length} book entries add up to this amount`, sp === 0 ? "Same day" : `Within ${sp} days`],
    });
  }

  // One book line -> several statement lines.
  for (const b of book) {
    if (usedBook.has(b.id)) continue;
    const near = bank
      .filter((s) => !usedBank.has(s.id) && daysBetween(b.date, s.date) >= 0 && daysBetween(b.date, s.date) <= opts.windowDays)
      .sort((x, y) => daysBetween(b.date, x.date) - daysBetween(b.date, y.date))
      .slice(0, opts.groupCandidates)
      .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));
    const sets = subsetsSumming(near, b.amount, opts.maxGroup);
    if (!sets.length) continue;
    const best = sets.sort((x, y) => x.length - y.length)[0]!;
    if (best.some((s) => usedBank.has(s.id))) continue;
    usedBook.add(b.id);
    for (const s of best) usedBank.add(s.id);
    out.push({
      kind: "many_bank",
      bankIds: best.map((s) => s.id),
      bookIds: [b.id],
      confidence: Math.max(40, Math.min(80, 75 - 4 * (best.length - 2) + (sets.length === 1 ? 5 : -10))),
      reasons: [`${best.length} statement lines add up to this entry`],
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

function spread(lines: readonly { date: string }[], to: string): number {
  return lines.reduce((m, l) => Math.max(m, Math.abs(daysBetween(l.date, to))), 0);
}

// ------------------------------------------------------------------ reconciliation statement

export interface BrsBookLine {
  id: string;
  date: string;
  amount: number;
  narration: string;
  number: string;
  /** Date the bank cleared it (latest statement date of its match group), null when not matched. */
  clearedOn: string | null;
  chequeNo?: string | null;
}
export interface BrsBankLine {
  id: string;
  date: string;
  amount: number;
  narration: string;
  reference: string | null;
  /** Latest book date of its match group, null when not matched. */
  bookedOn: string | null;
  excluded?: boolean;
}

export interface ReconciliationStatement {
  asOf: string;
  /** Balance of the bank account in the books on the date. */
  bookBalance: number;
  /** Book payments (cheques issued, transfers) not yet in the bank: they make the bank balance higher. */
  notInBankPayments: BrsBookLine[];
  /** Book receipts (cheques deposited, money in transit) not yet in the bank: the bank balance is lower. */
  notInBankReceipts: BrsBookLine[];
  /** Money in the bank not yet in the books (interest, a customer's direct transfer). */
  notInBooksCredits: BrsBankLine[];
  /** Money out of the bank not yet in the books (charges, auto-debits). */
  notInBooksDebits: BrsBankLine[];
  totals: { notInBankPayments: number; notInBankReceipts: number; notInBooksCredits: number; notInBooksDebits: number };
  /** What the bank should show: book balance adjusted by the four lists. */
  expectedBankBalance: number;
  /** The statement's balance on the date (from the file, or typed), null when unknown. */
  bankBalance: number | null;
  difference: number | null;
  reconciled: boolean;
}

/**
 * Bank reconciliation statement on a date. Book lines dated on or before `asOf` that the bank had not cleared by then,
 * and statement lines on or before `asOf` that are not in the books by then:
 *   expected bank balance = book balance - uncleared book lines + statement lines not in the books (signed amounts).
 */
export function buildReconciliation(asOf: string, bookBalance: number, book: readonly BrsBookLine[], bank: readonly BrsBankLine[], bankBalance: number | null): ReconciliationStatement {
  const uncleared = book.filter((l) => l.date <= asOf && (!l.clearedOn || l.clearedOn > asOf));
  const bankOnly = bank.filter((l) => !l.excluded && l.date <= asOf && (!l.bookedOn || l.bookedOn > asOf));
  const sum = (xs: readonly { amount: number }[]) => xs.reduce((t, x) => t + x.amount, 0);
  const notInBankPayments = uncleared.filter((l) => l.amount < 0).sort(byDate);
  const notInBankReceipts = uncleared.filter((l) => l.amount > 0).sort(byDate);
  const notInBooksCredits = bankOnly.filter((l) => l.amount > 0).sort(byDate);
  const notInBooksDebits = bankOnly.filter((l) => l.amount < 0).sort(byDate);
  const expectedBankBalance = bookBalance - sum(uncleared) + sum(bankOnly);
  const difference = bankBalance === null ? null : bankBalance - expectedBankBalance;
  return {
    asOf,
    bookBalance,
    notInBankPayments,
    notInBankReceipts,
    notInBooksCredits,
    notInBooksDebits,
    totals: {
      notInBankPayments: sum(notInBankPayments),
      notInBankReceipts: sum(notInBankReceipts),
      notInBooksCredits: sum(notInBooksCredits),
      notInBooksDebits: sum(notInBooksDebits),
    },
    expectedBankBalance,
    bankBalance,
    difference,
    reconciled: difference === 0,
  };
}

const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);

/** The statement balance at the end of `asOf`: the last printed balance on or before it plus the lines after it. */
export function statementBalanceOn(lines: readonly { date: string; amount: number; balance: number | null }[], asOf: string): number | null {
  const upTo = lines.filter((l) => l.date <= asOf);
  for (let i = upTo.length - 1; i >= 0; i--) {
    const b = upTo[i]!.balance;
    if (b !== null) return b + upTo.slice(i + 1).reduce((t, l) => t + l.amount, 0);
  }
  return null;
}
