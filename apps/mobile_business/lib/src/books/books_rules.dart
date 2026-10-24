// Customers, credit book and expenses rules, as the web applies them (packages/billing-ui: customer-dialog.tsx,
// credit-book/*, expenses/expense-dialog.tsx) and the server validates them (packages/invoices/src/service.ts,
// packages/expenses/src/service.ts). Pure functions: unit-tested without widgets.
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../counter/tender.dart';

/// Feature / permission keys (apps/api/src/permissions.ts `ROUTE_PERMISSIONS`, packages/invoices `FEATURES`,
/// packages/expenses `EXPENSES_FEATURE` / `EXPENSES_PERMISSION`).
abstract final class BooksKeys {
  static const invoices = 'invoices';
  static const creditBook = 'invoices.credit-book'; // a feature and a permission
  static const whatsapp = 'invoices.whatsapp';
  static const customersCreate = 'customers.create'; // POST / PATCH customers
  static const paymentsReceive = 'payments.receive'; // receipts need it too
  static const expenses = 'expenses';
  static const expensesManage = 'expenses.manage';

  /// Every /invoices and /expenses route is for these base roles (`requireRole(ctx, "owner", "admin", "staff")`).
  static const staffRoles = ['owner', 'admin', 'staff'];
}

/// What the signed-in member may do with customers, the credit book and expenses. Mirrors the server's checks
/// (feature on the route, permission from ROUTE_PERMISSIONS, staff role), so hidden means "would be refused".
class BooksAccess {
  const BooksAccess(this.gates);
  final Gates gates;

  bool get _staff => gates.hasRole(BooksKeys.staffRoles);

  /// More → Customers (the web's customers page: feature `invoices`).
  bool get customers => _staff && gates.feature(BooksKeys.invoices);

  /// Add / edit customers.
  bool get editCustomers => customers && gates.can(BooksKeys.customersCreate);

  /// More → Credit book, ledgers, statements.
  bool get creditBook => customers && gates.feature(BooksKeys.creditBook) && gates.can(BooksKeys.creditBook);

  /// Credit-book fields on the customer (opening balance, credit limit): the web shows them with the feature.
  bool get creditFields => gates.feature(BooksKeys.creditBook);

  /// Receive payment on account (`invoices.credit-book` + `payments.receive`).
  bool get receive => creditBook && gates.can(BooksKeys.paymentsReceive);

  /// Send a WhatsApp reminder from the shop's number: route feature `invoices.whatsapp`, permission
  /// `invoices.credit-book`.
  bool get remind => customers && gates.feature(BooksKeys.whatsapp) && gates.can(BooksKeys.creditBook);

  /// More → Expenses.
  bool get expenses => _staff && gates.feature(BooksKeys.expenses) && gates.can(BooksKeys.expensesManage);
}

// ---------------------------------------------------------------- balances

enum BalanceSide { due, advance, settled }

/// + = the customer owes the shop, − = advance (credit-book-ui.tsx `balanceSide`).
BalanceSide balanceSide(int balance) => balance > 0 ? BalanceSide.due : (balance < 0 ? BalanceSide.advance : BalanceSide.settled);

/// The credit-limit meter of the balance card (shown only with a positive limit): used, left, over.
class CreditUsage {
  const CreditUsage({required this.used, required this.limit});
  final int used;
  final int limit;
  bool get over => used > limit;
  int get available => over ? 0 : limit - used;
  int get overBy => over ? used - limit : 0;
  double get fraction => limit == 0 ? 0 : (used / limit).clamp(0, 1).toDouble();

  /// More than 80% used (the web's warning colour).
  bool get near => !over && limit > 0 && used / limit > 0.8;
}

/// customer-detail.tsx `BalanceCard`: a limit only when it is set and above zero; usage counts dues only.
CreditUsage? creditUsage(Customer c) {
  final limit = c.creditLimit;
  if (limit == null || limit <= 0) return null;
  return CreditUsage(used: c.outstanding > 0 ? c.outstanding : 0, limit: limit);
}

/// format.ts `whatsappNumber`: digits for wa.me (Indian mobiles get 91), or null when the number can't be used.
String? whatsappNumber(String? phone) {
  if (phone == null) return null;
  final d = phone.replaceAll(RegExp(r'\D'), '');
  if (RegExp(r'^[6-9]\d{9}$').hasMatch(d)) return '91$d';
  if (RegExp(r'^0[6-9]\d{9}$').hasMatch(d)) return '91${d.substring(1)}';
  if (d.length >= 8 && d.length <= 15) return d;
  return null;
}

/// credit-book-ui.tsx `waLink`: `https://wa.me/<number>?text=…` (no number: WhatsApp asks whom to send it to).
Uri waLink(String? phone, String text) => Uri.parse('https://wa.me/${whatsappNumber(phone) ?? ''}?text=${Uri.encodeComponent(text)}');

// ---------------------------------------------------------------- receipts

/// One bill a receipt settled, for the "Settled against" list.
class AllocationLine {
  const AllocationLine({required this.invoiceId, required this.number, required this.amount});
  final String invoiceId;

  /// The bill number, or `—` (receive-dialog.tsx shows `Bill —` for an unnumbered bill).
  final String number;
  final int amount;
}

/// What the receive dialog shows after saving (receive-dialog.tsx): the bills settled oldest first, the advance kept,
/// and "no open bills" when everything went to advance.
class ReceiptView {
  const ReceiptView({required this.amount, required this.date, required this.lines, required this.advance});
  final int amount;
  final String date;
  final List<AllocationLine> lines;
  final int advance;

  /// "There were no open bills, so the whole amount is kept as advance."
  bool get noBills => lines.isEmpty && advance > 0;
  bool get hasAdvance => advance > 0;
  int get settled => lines.fold(0, (s, l) => s + l.amount);
}

/// The server's answer as shown; the receipt's own amount / date win over what was typed (as the web does).
ReceiptView receiptView(ReceiptResult r, {required int typedAmount, required String typedDate}) => ReceiptView(
      amount: r.receipt.amount > 0 ? r.receipt.amount : typedAmount,
      date: r.receipt.date.isNotEmpty ? r.receipt.date : typedDate,
      lines: [
        for (final a in r.allocations) AllocationLine(invoiceId: a.invoiceId, number: a.number ?? '—', amount: a.amount),
      ],
      advance: r.advance,
    );

enum ReceiptError { amount, dateInFuture, dateInvalid, referenceTooLong, noteTooLong }

/// receive-dialog.tsx: an amount above zero (₹ with ≤ 2 decimals), a date not after today (IST), reference ≤ 100,
/// note ≤ 500 (`receiptInputSchema`; the web's input stops at 200, the server allows 500).
ReceiptError? validateReceipt({required String amount, required String date, String reference = '', String note = '', String? today}) {
  final paise = parseRupees(amount);
  if (paise == null || paise <= 0 || paise > maxReceiptPaise) return ReceiptError.amount;
  if (!isIsoDate(date)) return ReceiptError.dateInvalid;
  if (date.compareTo(today ?? todayIst()) > 0) return ReceiptError.dateInFuture;
  if (reference.trim().length > 100) return ReceiptError.referenceTooLong;
  if (note.trim().length > 500) return ReceiptError.noteTooLong;
  return null;
}

/// `money` on the server: at most ₹2 crore per receipt / expense.
const maxReceiptPaise = 2000000000;

/// The payment methods receipts and expenses take, in the web's order.
const paymentMethods = ['cash', 'upi', 'card', 'bank', 'cheque', 'other'];

// ---------------------------------------------------------------- ledger

/// One line of the ledger as the phone shows it (ledger-view.tsx `LedgerTimeline`): debit = billed, credit =
/// received, and the running balance as an amount with a due / advance side (never a bare minus sign).
class LedgerRow {
  const LedgerRow({
    required this.date,
    required this.type,
    this.number,
    this.detail,
    this.debit = 0,
    this.credit = 0,
    required this.balance,
    this.broughtForward = false,
  });

  final String date;
  final String type;
  final String? number;

  /// The description when it says more than the number.
  final String? detail;
  final int debit;
  final int credit;
  final int balance;

  /// The "Balance as of `from`" line.
  final bool broughtForward;

  BalanceSide get side => balanceSide(balance);

  /// `₹1,200.00` (always positive; [side] says which way).
  String get balanceAmount => formatPaise(balance.abs());
}

/// The ledger's lines: the balance brought forward to [from] first (when a range start is known), then the entries
/// in the server's order with their running balances. [closing] is the server's closing balance.
List<LedgerRow> ledgerRows(Ledger l, {String? from}) => [
      if (from != null) LedgerRow(date: from, type: 'opening', balance: l.openingBalance, broughtForward: true),
      for (final e in l.entries)
        LedgerRow(
          date: e.date,
          type: e.type,
          number: e.number,
          detail: e.description.isNotEmpty && e.description != e.number ? e.description : null,
          debit: e.debit,
          credit: e.credit,
          balance: e.balance,
        ),
    ];

/// Billed and received over the period (the ledger table's footer).
({int debit, int credit}) ledgerTotals(Ledger l) =>
    (debit: l.entries.fold(0, (s, e) => s + e.debit), credit: l.entries.fold(0, (s, e) => s + e.credit));

// ---------------------------------------------------------------- dates (IST)

bool isIsoDate(String s) {
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s)) return false;
  final d = DateTime.tryParse(s);
  return d != null && isoDate(d) == s;
}

String isoDate(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

DateTime _day(String iso) => DateTime.parse(iso);

/// A date range, both ends included (`YYYY-MM-DD`).
typedef DateRange = ({String from, String to});

/// This month so far, from today (IST).
DateRange thisMonth([String? today]) {
  final t = _day(today ?? todayIst());
  return (from: isoDate(DateTime(t.year, t.month)), to: isoDate(t));
}

/// Last calendar month.
DateRange lastMonth([String? today]) {
  final t = _day(today ?? todayIst());
  return (from: isoDate(DateTime(t.year, t.month - 1)), to: isoDate(DateTime(t.year, t.month, 0)));
}

/// The Indian financial year so far (1 April to today); the web ledger's default range.
DateRange thisFinancialYear([String? today]) {
  final t = _day(today ?? todayIst());
  final start = t.month >= 4 ? t.year : t.year - 1;
  return (from: isoDate(DateTime(start, 4)), to: isoDate(t));
}

// ---------------------------------------------------------------- customers

enum CustomerField { name, phone, email, gstin, address, opening, creditLimit }

/// customer-dialog.tsx `schema`: name 1–120, phone `^[+\d][\d\s-]{6,18}$`, a valid email, a valid GSTIN (format +
/// check character), address ≤ 300 (the server allows 500), opening balance / credit limit as rupees. Returns the
/// fields in error.
Set<CustomerField> validateCustomer({
  required String name,
  String phone = '',
  String email = '',
  String gstin = '',
  String address = '',
  String opening = '',
  String creditLimit = '',
}) {
  final errors = <CustomerField>{};
  final n = name.trim();
  if (n.isEmpty || n.length > 120) errors.add(CustomerField.name);
  final p = phone.trim();
  if (p.isNotEmpty && !RegExp(r'^[+\d][\d\s-]{6,18}$').hasMatch(p)) errors.add(CustomerField.phone);
  final e = email.trim();
  if (e.isNotEmpty && (e.length > 254 || !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(e))) errors.add(CustomerField.email);
  final g = gstin.trim();
  if (g.isNotEmpty && !isValidGstin(g)) errors.add(CustomerField.gstin);
  if (address.trim().length > 300) errors.add(CustomerField.address);
  if (opening.trim().isNotEmpty && parseRupees(opening) == null) errors.add(CustomerField.opening);
  if (creditLimit.trim().isNotEmpty && parseRupees(creditLimit) == null) errors.add(CustomerField.creditLimit);
  return errors;
}

const _gstinChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/// packages/gst `isValidGstin`: 2-digit state, PAN, entity number, `Z`, check character (base-36 mod variant).
bool isValidGstin(String input) {
  final g = input.replaceAll(RegExp(r'\s+'), '').toUpperCase();
  if (!RegExp(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$').hasMatch(g)) return false;
  var sum = 0;
  for (var i = 0; i < 14; i++) {
    final v = _gstinChars.indexOf(g[i]);
    final product = v * (i.isEven ? 1 : 2);
    sum += product ~/ 36 + product % 36;
  }
  return _gstinChars[(36 - sum % 36) % 36] == g[14];
}

/// The fields a customer form changed, as the PATCH body (or every non-empty field for a new customer). Empty
/// optional text clears the field (null). The opening balance is signed (+ owes, − advance); an empty credit limit is
/// "no limit" (null). [creditFields] false leaves opening balance and credit limit out (the web hides them without
/// the credit book).
Map<String, Object?> customerBody({
  Customer? before,
  required String name,
  String phone = '',
  String email = '',
  String gstin = '',
  String address = '',
  String opening = '',
  bool openingAdvance = false,
  String creditLimit = '',
  bool creditFields = false,
}) {
  String? opt(String s) => s.trim().isEmpty ? null : s.trim();
  final next = <String, Object?>{
    'name': name.trim(),
    'phone': opt(phone),
    'email': opt(email)?.toLowerCase(),
    'gstin': opt(gstin)?.replaceAll(RegExp(r'\s+'), '').toUpperCase(),
    'address': opt(address),
    if (creditFields) 'openingBalance': (parseRupees(opening) ?? 0) * (openingAdvance ? -1 : 1),
    if (creditFields) 'creditLimit': creditLimit.trim().isEmpty ? null : parseRupees(creditLimit),
  };
  if (before == null) return {for (final e in next.entries) if (e.value != null && e.value != 0) e.key: e.value};
  final old = <String, Object?>{
    'name': before.name,
    'phone': before.phone,
    'email': before.email,
    'gstin': before.gstin,
    'address': before.address,
    'openingBalance': before.openingBalance,
    'creditLimit': before.creditLimit,
  };
  return {for (final e in next.entries) if (old[e.key] != e.value) e.key: e.value};
}

// ---------------------------------------------------------------- expenses

enum ExpenseError { amount, amountTooLarge, date, dateInFuture, category, noteTooLong, referenceTooLong }

/// expense-dialog.tsx `schema` + `expenseInput`: amount above zero (₹, ≤ 2 decimals, ≤ ₹2 crore), a real
/// `YYYY-MM-DD` date not after today (the web's date input stops at today), a category, note ≤ 1000, reference ≤ 100.
ExpenseError? validateExpense({
  required String amount,
  required String date,
  required String? categoryId,
  String note = '',
  String reference = '',
  String? today,
}) {
  final paise = parseRupees(amount);
  if (paise == null || paise <= 0) return ExpenseError.amount;
  if (paise > maxReceiptPaise) return ExpenseError.amountTooLarge;
  if (!isIsoDate(date)) return ExpenseError.date;
  if (date.compareTo(today ?? todayIst()) > 0) return ExpenseError.dateInFuture;
  if (categoryId == null || categoryId.isEmpty) return ExpenseError.category;
  if (note.trim().length > 1000) return ExpenseError.noteTooLong;
  if (reference.trim().length > 100) return ExpenseError.referenceTooLong;
  return null;
}

/// The body for a new expense, or only the changed fields of [before] (GST is left alone: the server keeps the rate
/// and recomputes the GST from the new amount).
ExpenseInput expenseInput({
  Expense? before,
  required int amount,
  required String date,
  required String categoryId,
  required String paymentMethod,
  String note = '',
  String reference = '',
}) {
  if (before == null) {
    return ExpenseInput(amount: amount, date: date, categoryId: categoryId, paymentMethod: paymentMethod, note: note.trim().isEmpty ? null : note, reference: reference.trim().isEmpty ? null : reference);
  }
  return ExpenseInput(
    amount: amount == before.amount ? null : amount,
    date: date == before.date ? null : date,
    categoryId: categoryId == before.categoryId ? null : categoryId,
    paymentMethod: paymentMethod == before.paymentMethod ? null : paymentMethod,
    note: note.trim() == (before.note ?? '') ? null : note,
    reference: reference.trim() == (before.reference ?? '') ? null : reference,
  );
}

/// The default category for a new expense: the built-in "Other", else the first (expense-dialog.tsx).
String? defaultExpenseCategory(List<ExpenseCategory> cats) =>
    (cats.where((c) => c.builtin && c.name == 'Other').firstOrNull ?? cats.firstOrNull)?.id;

/// Built-in category names the app translates (packages/expenses `BUILTIN_CATEGORIES`).
const builtinExpenseCategories = ['Rent', 'Salaries', 'Electricity', 'Transport', 'Packaging', 'Marketing', 'Repairs', 'Other'];
