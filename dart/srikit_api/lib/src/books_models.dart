// Credit book (packages/invoices/src/routes.ts: credit-book, ledger, receipts, statement, remind) and expenses
// (packages/expenses/src/routes.ts). Money is paise; dates are IST `YYYY-MM-DD` strings.
import 'billing_models.dart';
import 'models.dart';

Json _map(Object? v) => v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};
List<Json> _list(Object? v) => v is List ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList() : const [];
int _int(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? 0 : 0);
double _num(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) ?? 0 : 0);
String? _str(Object? v) => v is String ? v : null;
DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;
Map<String, int> _counts(Object? v) => _map(v).map((k, x) => MapEntry(k, _int(x)));

// ---------------------------------------------------------------- credit book

/// `creditBookRowSchema`: a customer with their ledger balance.
class CreditBookRow {
  const CreditBookRow({
    required this.customer,
    required this.balance,
    this.overdue = 0,
    this.lastActivity,
    this.oldestDue,
    this.lastPayment,
  });

  final Customer customer;

  /// = `customer.outstanding`; negative = advance.
  final int balance;

  /// Open bills past their due date (paise).
  final int overdue;

  /// Latest bill, payment or receipt date.
  final String? lastActivity;

  /// Due date (or bill date) of the oldest open bill with money left on it.
  final String? oldestDue;
  final String? lastPayment;

  factory CreditBookRow.fromJson(Json j) => CreditBookRow(
        customer: Customer.fromJson(_map(j['customer'])),
        balance: _int(j['balance']),
        overdue: _int(j['overdue']),
        lastActivity: _str(j['lastActivity']),
        oldestDue: _str(j['oldestDue']),
        lastPayment: _str(j['lastPayment']),
      );
}

/// Over every customer of the shop (not just this page or filter).
class CreditBookTotals {
  const CreditBookTotals({this.receivable = 0, this.advance = 0, this.customersWithDues = 0});
  final int receivable;
  final int advance;
  final int customersWithDues;

  factory CreditBookTotals.fromJson(Json j) => CreditBookTotals(
        receivable: _int(j['receivable']),
        advance: _int(j['advance']),
        customersWithDues: _int(j['customersWithDues']),
      );
}

/// GET /v1/invoices/credit-book.
class CreditBookPage {
  const CreditBookPage({
    required this.items,
    required this.total,
    this.limit,
    this.offset,
    this.totals = const CreditBookTotals(),
    this.ageCounts = const {},
  });

  final List<CreditBookRow> items;
  final int total;
  final int? limit;
  final int? offset;
  final CreditBookTotals totals;

  /// `facets.age`: customers per overdue bucket (`current`, `1-30`, `31-60`, `61-90`, `90+`) under the other filters.
  final Map<String, int> ageCounts;

  factory CreditBookPage.fromJson(Json j) {
    final items = _list(j['items']).map(CreditBookRow.fromJson).toList();
    return CreditBookPage(
      items: items,
      total: j['total'] is num ? _int(j['total']) : items.length,
      limit: j['limit'] is num ? _int(j['limit']) : null,
      offset: j['offset'] is num ? _int(j['offset']) : null,
      totals: CreditBookTotals.fromJson(_map(j['totals'])),
      ageCounts: _counts(_map(j['facets'])['age']),
    );
  }
}

/// `ledgerEntrySchema`: one line of a customer's running-balance statement.
class LedgerEntry {
  const LedgerEntry({
    required this.date,
    required this.type,
    this.refId,
    this.number,
    this.description = '',
    this.debit = 0,
    this.credit = 0,
    required this.balance,
  });

  final String date;

  /// `opening`, `invoice`, `payment`, `receipt`, `cancel`, `credit_note`, `refund`.
  final String type;
  final String? refId;
  final String? number;
  final String description;
  final int debit;
  final int credit;

  /// Running balance after this line (+ due, − advance).
  final int balance;

  factory LedgerEntry.fromJson(Json j) => LedgerEntry(
        date: _str(j['date']) ?? '',
        type: _str(j['type']) ?? 'opening',
        refId: _str(j['refId']),
        number: _str(j['number']),
        description: _str(j['description']) ?? '',
        debit: _int(j['debit']),
        credit: _int(j['credit']),
        balance: _int(j['balance']),
      );
}

/// GET /v1/invoices/customers/:id/ledger.
class Ledger {
  const Ledger({required this.customer, required this.openingBalance, required this.entries, required this.closingBalance});
  final Customer customer;

  /// Balance brought forward to `from`.
  final int openingBalance;
  final List<LedgerEntry> entries;
  final int closingBalance;

  factory Ledger.fromJson(Json j) => Ledger(
        customer: Customer.fromJson(_map(j['customer'])),
        openingBalance: _int(j['openingBalance']),
        entries: _list(j['entries']).map(LedgerEntry.fromJson).toList(),
        closingBalance: _int(j['closingBalance']),
      );
}

/// `receiptSchema`: money received on account.
class CustomerReceipt {
  const CustomerReceipt({
    required this.id,
    required this.customerId,
    required this.amount,
    required this.method,
    required this.date,
    this.reference,
    this.note,
    this.advance = 0,
    this.createdAt,
  });

  final String id;
  final String customerId;
  final int amount;
  final String method;
  final String date;
  final String? reference;
  final String? note;

  /// Paise left unallocated (customer advance).
  final int advance;
  final DateTime? createdAt;

  factory CustomerReceipt.fromJson(Json j) => CustomerReceipt(
        id: _str(j['id']) ?? '',
        customerId: _str(j['customerId']) ?? '',
        amount: _int(j['amount']),
        method: _str(j['method']) ?? 'cash',
        date: _str(j['date']) ?? '',
        reference: _str(j['reference']),
        note: _str(j['note']),
        advance: _int(j['advance']),
        createdAt: _date(j['createdAt']),
      );
}

/// The part of a receipt that went to one bill.
class ReceiptAllocation {
  const ReceiptAllocation({required this.invoiceId, this.number, required this.amount});
  final String invoiceId;
  final String? number;
  final int amount;

  factory ReceiptAllocation.fromJson(Json j) =>
      ReceiptAllocation(invoiceId: _str(j['invoiceId']) ?? '', number: _str(j['number']), amount: _int(j['amount']));
}

/// POST /v1/invoices/customers/:id/receipts: the receipt, spread oldest-first over open bills, and what was kept as
/// advance.
class ReceiptResult {
  const ReceiptResult({required this.receipt, this.allocations = const [], this.advance = 0});
  final CustomerReceipt receipt;
  final List<ReceiptAllocation> allocations;
  final int advance;

  factory ReceiptResult.fromJson(Json j) => ReceiptResult(
        receipt: CustomerReceipt.fromJson(_map(j['receipt'])),
        allocations: _list(j['allocations']).map(ReceiptAllocation.fromJson).toList(),
        advance: _int(j['advance']),
      );
}

/// POST /v1/invoices/customers/:id/remind: sent from the shop's WhatsApp / SMS. [url] is the statement link.
class RemindResult {
  const RemindResult({required this.logId, required this.url});
  final String logId;
  final String url;

  factory RemindResult.fromJson(Json j) => RemindResult(logId: _str(j['logId']) ?? '', url: _str(j['url']) ?? '');
}

// ---------------------------------------------------------------- expenses

/// `expenseCategorySchema`. Built-ins (Rent, Salaries, …, Other) can be renamed but not deleted.
class ExpenseCategory {
  const ExpenseCategory({required this.id, required this.name, this.sort = 0, this.builtin = false, this.tenantId, this.createdAt, this.updatedAt});
  final String id;
  final String name;
  final int sort;
  final bool builtin;
  final String? tenantId;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory ExpenseCategory.fromJson(Json j) => ExpenseCategory(
        id: _str(j['id']) ?? '',
        name: _str(j['name']) ?? '',
        sort: _int(j['sort']),
        builtin: j['builtin'] == true,
        tenantId: _str(j['tenantId']),
        createdAt: _date(j['createdAt']),
        updatedAt: _date(j['updatedAt']),
      );
}

/// `expenseSchema` (`ExpenseView`): the stored row plus its category name, taxable value and claimable ITC.
class Expense {
  const Expense({
    required this.id,
    required this.date,
    required this.categoryId,
    required this.amount,
    this.gstRate = 0,
    this.gstAmount = 0,
    this.vendorName,
    this.vendorGstin,
    this.paymentMethod = 'cash',
    this.reference,
    this.note,
    this.receiptUrl,
    this.status = 'recorded',
    this.categoryName = '',
    this.taxable = 0,
    this.itc = 0,
    this.tenantId,
    this.createdBy,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String date;
  final String categoryId;

  /// Including GST.
  final int amount;
  final double gstRate;

  /// GST inside [amount].
  final int gstAmount;
  final String? vendorName;
  final String? vendorGstin;
  final String paymentMethod;
  final String? reference;
  final String? note;
  final String? receiptUrl;

  /// `recorded` or `cancelled` (kept for the record, left out of totals).
  final String status;
  final String categoryName;
  final int taxable;
  final int itc;
  final String? tenantId;
  final String? createdBy;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  bool get cancelled => status == 'cancelled';

  factory Expense.fromJson(Json j) => Expense(
        id: _str(j['id']) ?? '',
        date: _str(j['date']) ?? '',
        categoryId: _str(j['categoryId']) ?? '',
        amount: _int(j['amount']),
        gstRate: _num(j['gstRate']),
        gstAmount: _int(j['gstAmount']),
        vendorName: _str(j['vendorName']),
        vendorGstin: _str(j['vendorGstin']),
        paymentMethod: _str(j['paymentMethod']) ?? 'cash',
        reference: _str(j['reference']),
        note: _str(j['note']),
        receiptUrl: _str(j['receiptUrl']),
        status: _str(j['status']) ?? 'recorded',
        categoryName: _str(j['categoryName']) ?? '',
        taxable: _int(j['taxable']),
        itc: _int(j['itc']),
        tenantId: _str(j['tenantId']),
        createdBy: _str(j['createdBy']),
        createdAt: _date(j['createdAt']),
        updatedAt: _date(j['updatedAt']),
      );
}

/// Over every matching recorded expense (not just this page).
class ExpenseTotals {
  const ExpenseTotals({this.amount = 0, this.gst = 0, this.itc = 0});
  final int amount;
  final int gst;
  final int itc;

  factory ExpenseTotals.fromJson(Json j) => ExpenseTotals(amount: _int(j['amount']), gst: _int(j['gst']), itc: _int(j['itc']));
}

/// GET /v1/expenses.
class ExpensePage {
  const ExpensePage({required this.items, required this.total, this.limit, this.offset, this.totals = const ExpenseTotals(), this.facets = const {}});
  final List<Expense> items;
  final int total;
  final int? limit;
  final int? offset;
  final ExpenseTotals totals;

  /// `category` (ids), `paymentMethod` and `status` counts under the other filters (raw).
  final Json facets;

  factory ExpensePage.fromJson(Json j) {
    final items = _list(j['items']).map(Expense.fromJson).toList();
    return ExpensePage(
      items: items,
      total: j['total'] is num ? _int(j['total']) : items.length,
      limit: j['limit'] is num ? _int(j['limit']) : null,
      offset: j['offset'] is num ? _int(j['offset']) : null,
      totals: ExpenseTotals.fromJson(_map(j['totals'])),
      facets: _map(j['facets']),
    );
  }
}

/// One category of an expense summary.
class ExpenseCategoryTotal {
  const ExpenseCategoryTotal({required this.categoryId, required this.name, this.total = 0, this.gst = 0, this.itc = 0, this.count = 0});
  final String categoryId;
  final String name;
  final int total;
  final int gst;
  final int itc;
  final int count;

  factory ExpenseCategoryTotal.fromJson(Json j) => ExpenseCategoryTotal(
        categoryId: _str(j['categoryId']) ?? '',
        name: _str(j['name']) ?? '',
        total: _int(j['total']),
        gst: _int(j['gst']),
        itc: _int(j['itc']),
        count: _int(j['count']),
      );
}

/// One month (`YYYY-MM`) of an expense summary.
class ExpenseMonthTotal {
  const ExpenseMonthTotal({required this.month, this.total = 0, this.gst = 0, this.itc = 0, this.count = 0});
  final String month;
  final int total;
  final int gst;
  final int itc;
  final int count;

  factory ExpenseMonthTotal.fromJson(Json j) => ExpenseMonthTotal(
        month: _str(j['month']) ?? '',
        total: _int(j['total']),
        gst: _int(j['gst']),
        itc: _int(j['itc']),
        count: _int(j['count']),
      );
}

/// GET /v1/expenses/summary: recorded expenses of a period (default: this month) by category (largest first) and by
/// month (oldest first).
class ExpenseSummary {
  const ExpenseSummary({
    required this.from,
    required this.to,
    this.total = 0,
    this.gst = 0,
    this.itc = 0,
    this.count = 0,
    this.byCategory = const [],
    this.byMonth = const [],
  });

  final String from;
  final String to;
  final int total;
  final int gst;
  final int itc;
  final int count;
  final List<ExpenseCategoryTotal> byCategory;
  final List<ExpenseMonthTotal> byMonth;

  factory ExpenseSummary.fromJson(Json j) => ExpenseSummary(
        from: _str(j['from']) ?? '',
        to: _str(j['to']) ?? '',
        total: _int(j['total']),
        gst: _int(j['gst']),
        itc: _int(j['itc']),
        count: _int(j['count']),
        byCategory: _list(j['byCategory']).map(ExpenseCategoryTotal.fromJson).toList(),
        byMonth: _list(j['byMonth']).map(ExpenseMonthTotal.fromJson).toList(),
      );
}

/// The body of POST / PATCH /v1/expenses (the fields the phone edits). For a PATCH, null fields are left out; a
/// non-null [note] / [reference] of `''` clears it.
class ExpenseInput {
  const ExpenseInput({this.date, this.categoryId, this.amount, this.paymentMethod, this.note, this.reference});
  final String? date;
  final String? categoryId;
  final int? amount;
  final String? paymentMethod;
  final String? note;
  final String? reference;

  Json toJson() => {
        if (date != null) 'date': date,
        if (categoryId != null) 'categoryId': categoryId,
        if (amount != null) 'amount': amount,
        if (paymentMethod != null) 'paymentMethod': paymentMethod,
        if (note != null) 'note': note!.trim().isEmpty ? null : note!.trim(),
        if (reference != null) 'reference': reference!.trim().isEmpty ? null : reference!.trim(),
      };
}
