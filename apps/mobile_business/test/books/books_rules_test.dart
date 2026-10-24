import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/l10n/app_localizations.dart';
import 'package:srikit_business/src/books/books_rules.dart';
import 'package:srikit_business/src/books/books_text.dart';
import 'package:srikit_kit/srikit_kit.dart';

void main() {
  final en = lookupAppLocalizations(const Locale('en'));
  final ta = lookupAppLocalizations(const Locale('ta'));

  group('receipt allocation display', () {
    ReceiptResult result(Map<String, Object?> j) => ReceiptResult.fromJson(j);

    test('bills settled oldest first, then the advance kept', () {
      final v = receiptView(
        result({
          'receipt': {'id': 'r1', 'customerId': 'c2', 'amount': 200000, 'method': 'cash', 'date': '2026-10-20', 'advance': 50000},
          'allocations': [
            {'invoiceId': 'inv-40', 'number': 'INV-0040', 'amount': 100000},
            {'invoiceId': 'inv-41', 'number': 'INV-0041', 'amount': 50000},
          ],
          'advance': 50000,
        }),
        typedAmount: 200000,
        typedDate: '2026-10-20',
      );
      expect(v.lines.map((l) => (l.number, l.amount)), [('INV-0040', 100000), ('INV-0041', 50000)]);
      expect(v.settled, 150000);
      expect(v.hasAdvance, isTrue);
      expect(v.advance, 50000);
      expect(v.noBills, isFalse);
      expect(v.amount, 200000);
    });

    test('no open bills: everything is advance; an unnumbered bill shows a dash', () {
      final allAdvance = receiptView(
        result({'receipt': {'amount': 30000, 'date': '2026-10-21'}, 'allocations': <Object>[], 'advance': 30000}),
        typedAmount: 30000,
        typedDate: '2026-10-21',
      );
      expect(allAdvance.noBills, isTrue);
      expect(allAdvance.lines, isEmpty);

      final partial = receiptView(
        result({
          'receipt': {'amount': 0, 'date': ''},
          'allocations': [
            {'invoiceId': 'd1', 'number': null, 'amount': 1000},
          ],
          'advance': 0,
        }),
        typedAmount: 1000,
        typedDate: '2026-10-19',
      );
      expect(partial.lines.single.number, '—');
      expect(partial.hasAdvance, isFalse);
      expect(partial.noBills, isFalse);
      // The receipt's own numbers win; the typed ones fill gaps.
      expect(partial.amount, 1000);
      expect(partial.date, '2026-10-19');
    });

    test('receipt validation: amount above zero, date not after today, lengths', () {
      const today = '2026-10-21';
      expect(validateReceipt(amount: '1200', date: today, today: today), isNull);
      expect(validateReceipt(amount: '0', date: today, today: today), ReceiptError.amount);
      expect(validateReceipt(amount: '', date: today, today: today), ReceiptError.amount);
      expect(validateReceipt(amount: '12.345', date: today, today: today), ReceiptError.amount);
      expect(validateReceipt(amount: '10', date: '2026-10-22', today: today), ReceiptError.dateInFuture);
      expect(validateReceipt(amount: '10', date: '2026-02-30', today: today), ReceiptError.dateInvalid);
      expect(validateReceipt(amount: '10', date: today, reference: 'x' * 101, today: today), ReceiptError.referenceTooLong);
      expect(validateReceipt(amount: '10', date: today, note: 'x' * 501, today: today), ReceiptError.noteTooLong);
    });
  });

  group('ledger running balance display', () {
    final ledger = Ledger.fromJson({
      'customer': {'id': 'c2', 'name': 'Lakshmi'},
      'openingBalance': 20000,
      'entries': [
        {'date': '2026-09-01', 'type': 'invoice', 'refId': 'inv-40', 'number': 'INV-0040', 'description': 'INV-0040', 'debit': 100000, 'credit': 0, 'balance': 120000},
        {'date': '2026-09-10', 'type': 'receipt', 'refId': 'r1', 'number': null, 'description': 'Cash at shop', 'debit': 0, 'credit': 150000, 'balance': -30000},
        {'date': '2026-10-01', 'type': 'invoice', 'refId': 'inv-41', 'number': 'INV-0041', 'description': 'INV-0041', 'debit': 30000, 'credit': 0, 'balance': 0},
      ],
      'closingBalance': 0,
    });

    test('brought forward first, then each entry with its running balance and side', () {
      final rows = ledgerRows(ledger, from: '2026-04-01');
      expect(rows, hasLength(4));
      expect(rows.first.broughtForward, isTrue);
      expect(rows.first.date, '2026-04-01');
      expect(rows.first.balance, 20000);
      expect(rows.map((r) => r.side), [BalanceSide.due, BalanceSide.due, BalanceSide.advance, BalanceSide.settled]);
      expect(rows[1].detail, isNull); // the description only repeats the number
      expect(rows[2].detail, 'Cash at shop');
      expect(rows[2].credit, 150000);
      expect(rows[2].balanceAmount, '₹300.00'); // never a bare minus sign
      expect(ledgerRows(ledger), hasLength(3)); // no range start: no brought-forward line
    });

    test('running balance text: amount + due / adv., in English and Tamil', () {
      expect(runningBalanceText(en, 120000), '₹1,200.00 due');
      expect(runningBalanceText(en, -30000), '₹300.00 adv.');
      expect(runningBalanceText(en, 0), '₹0.00');
      expect(runningBalanceText(ta, 120000), '₹1,200.00 நிலுவை');
      expect(runningBalanceText(ta, -30000), '₹300.00 முன்.');
    });

    test('period totals', () {
      final t = ledgerTotals(ledger);
      expect(t.debit, 130000);
      expect(t.credit, 150000);
    });

    test('ranges in IST: this month, last month, the financial year from 1 April', () {
      expect(thisMonth('2026-10-21'), (from: '2026-10-01', to: '2026-10-21'));
      expect(lastMonth('2026-01-15'), (from: '2025-12-01', to: '2025-12-31'));
      expect(lastMonth('2026-03-31'), (from: '2026-02-01', to: '2026-02-28'));
      expect(thisFinancialYear('2026-10-21'), (from: '2026-04-01', to: '2026-10-21'));
      expect(thisFinancialYear('2027-02-01'), (from: '2026-04-01', to: '2027-02-01'));
    });
  });

  group('expense validation', () {
    const today = '2026-10-21';
    ExpenseError? v({String amount = '1500', String date = today, String? cat = 'cat-rent', String note = '', String reference = ''}) =>
        validateExpense(amount: amount, date: date, categoryId: cat, note: note, reference: reference, today: today);

    test('a valid expense', () => expect(v(), isNull));
    test('amount: above zero, rupees with at most 2 decimals, at most ₹2 crore', () {
      expect(v(amount: ''), ExpenseError.amount);
      expect(v(amount: '0'), ExpenseError.amount);
      expect(v(amount: '-5'), ExpenseError.amount);
      expect(v(amount: '10.555'), ExpenseError.amount);
      expect(v(amount: '1,500.50'), isNull);
      expect(v(amount: '20000001'), ExpenseError.amountTooLarge);
    });
    test('date: a real YYYY-MM-DD, not after today (IST)', () {
      expect(v(date: '2026-13-01'), ExpenseError.date);
      expect(v(date: '21-10-2026'), ExpenseError.date);
      expect(v(date: '2026-10-22'), ExpenseError.dateInFuture);
      expect(v(date: '2026-04-01'), isNull);
    });
    test('category, note ≤ 1000, reference ≤ 100', () {
      expect(v(cat: null), ExpenseError.category);
      expect(v(cat: ''), ExpenseError.category);
      expect(v(note: 'x' * 1001), ExpenseError.noteTooLong);
      expect(v(note: 'x' * 1000), isNull);
      expect(v(reference: 'x' * 101), ExpenseError.referenceTooLong);
    });

    test('new expense body; an edit sends only what changed (an emptied note clears it)', () {
      final created = expenseInput(amount: 150000, date: today, categoryId: 'cat-rent', paymentMethod: 'upi', note: ' Shop rent ');
      expect(created.toJson(), {'date': today, 'categoryId': 'cat-rent', 'amount': 150000, 'paymentMethod': 'upi', 'note': 'Shop rent'});
      final before = Expense.fromJson({'id': 'e1', 'date': today, 'categoryId': 'cat-rent', 'amount': 150000, 'paymentMethod': 'upi', 'note': 'Shop rent'});
      expect(expenseInput(before: before, amount: 150000, date: today, categoryId: 'cat-rent', paymentMethod: 'upi', note: 'Shop rent').toJson(), isEmpty);
      expect(
        expenseInput(before: before, amount: 160000, date: today, categoryId: 'cat-rent', paymentMethod: 'cash', note: '').toJson(),
        {'amount': 160000, 'paymentMethod': 'cash', 'note': null},
      );
    });

    test('default category: the built-in Other, else the first', () {
      final cats = [
        ExpenseCategory.fromJson({'id': 'a', 'name': 'Rent', 'builtin': true}),
        ExpenseCategory.fromJson({'id': 'b', 'name': 'Other', 'builtin': true}),
      ];
      expect(defaultExpenseCategory(cats), 'b');
      expect(defaultExpenseCategory(cats.take(1).toList()), 'a');
      expect(defaultExpenseCategory(const []), isNull);
      expect(categoryName(ta, 'Rent'), 'வாடகை');
      expect(categoryName(ta, 'Rent', builtin: false), 'Rent');
      expect(categoryName(en, 'Tea'), 'Tea');
    });
  });

  group('customers', () {
    test('form validation mirrors the web dialog', () {
      expect(validateCustomer(name: 'Lakshmi'), isEmpty);
      expect(validateCustomer(name: '  '), {CustomerField.name});
      expect(validateCustomer(name: 'A', phone: '98765 43210', email: 'a@b.in', gstin: '33aaaaa0000a1z5'), isNot(contains(CustomerField.phone)));
      expect(validateCustomer(name: 'A', phone: '12'), {CustomerField.phone});
      expect(validateCustomer(name: 'A', email: 'nope'), {CustomerField.email});
      expect(validateCustomer(name: 'A', gstin: '33ABCDE1234F1Z0'), {CustomerField.gstin});
      expect(validateCustomer(name: 'A', creditLimit: '1.234'), {CustomerField.creditLimit});
    });

    test('GSTIN check character (packages/gst)', () {
      expect(isValidGstin('27AAPFU0939F1ZV'), isTrue);
      expect(isValidGstin('27aapfu0939f1zv'), isTrue);
      expect(isValidGstin('27AAPFU0939F1ZW'), isFalse);
      expect(isValidGstin('27AAPFU0939F1Z'), isFalse);
    });

    test('body: new customers send what was typed; edits only the changed fields', () {
      expect(customerBody(name: ' Ravi ', phone: '98400 11111', opening: '500', openingAdvance: true, creditLimit: '2000', creditFields: true),
          {'name': 'Ravi', 'phone': '98400 11111', 'openingBalance': -50000, 'creditLimit': 200000});
      expect(customerBody(name: 'Ravi', opening: '500', creditFields: false), {'name': 'Ravi'});
      final before = Customer.fromJson({'id': 'c', 'name': 'Ravi', 'phone': '98400 11111', 'creditLimit': 200000, 'openingBalance': 0});
      expect(customerBody(before: before, name: 'Ravi', phone: '98400 11111', creditLimit: '2000', creditFields: true), isEmpty);
      expect(customerBody(before: before, name: 'Ravi K', phone: '', creditLimit: '', creditFields: true), {'name': 'Ravi K', 'phone': null, 'creditLimit': null});
    });

    test('credit limit usage (dues only; no meter without a positive limit)', () {
      expect(creditUsage(Customer.fromJson({'id': 'c', 'name': 'x', 'outstanding': 5000})), isNull);
      expect(creditUsage(Customer.fromJson({'id': 'c', 'name': 'x', 'outstanding': 5000, 'creditLimit': 0})), isNull);
      final over = creditUsage(Customer.fromJson({'id': 'c', 'name': 'x', 'outstanding': 150000, 'creditLimit': 100000}))!;
      expect((over.over, over.overBy, over.available, over.fraction), (true, 50000, 0, 1.0));
      final near = creditUsage(Customer.fromJson({'id': 'c', 'name': 'x', 'outstanding': 85000, 'creditLimit': 100000}))!;
      expect((near.near, near.available), (true, 15000));
      expect(creditUsage(Customer.fromJson({'id': 'c', 'name': 'x', 'outstanding': -5000, 'creditLimit': 100000}))!.used, 0);
    });

    test('WhatsApp numbers and links (format.ts whatsappNumber)', () {
      expect(whatsappNumber('+91 95000 12345'), '919500012345');
      expect(whatsappNumber('9500012345'), '919500012345');
      expect(whatsappNumber('09500012345'), '919500012345');
      expect(whatsappNumber('123'), isNull);
      expect(whatsappNumber(null), isNull);
      expect(waLink(null, 'hi there').toString(), 'https://wa.me/?text=hi%20there');
      expect(statementMessage(en, name: 'Lakshmi', shop: 'Anna Stores', balance: 150000, url: 'https://x/s/1'),
          'Hello Lakshmi, your balance with Anna Stores is ₹1,500.00. See your statement: https://x/s/1');
      expect(statementMessage(en, name: 'L', shop: 'A', balance: -100, url: 'u'), contains('advance of ₹1.00'));
      expect(statementMessage(en, name: 'L', shop: 'A', balance: 0, url: 'u'), contains('fully settled'));
    });

    test('access follows the server: role, feature, permission', () {
      const all = Gates(
        enabled: {'invoices', 'invoices.credit-book', 'invoices.whatsapp', 'expenses'},
        roles: ['owner'],
      );
      final a = BooksAccess(all);
      expect([a.customers, a.editCustomers, a.creditBook, a.receive, a.remind, a.expenses], everyElement(isTrue));

      const staff = Gates(enabled: {'invoices', 'invoices.credit-book', 'expenses'}, roles: ['staff'], permissions: ['*.view', 'invoices.credit-book']);
      final s = BooksAccess(staff);
      expect(s.customers, isTrue);
      expect(s.editCustomers, isFalse); // no customers.create
      expect(s.creditBook, isTrue);
      expect(s.receive, isFalse); // receipts also need payments.receive
      expect(s.remind, isFalse); // no invoices.whatsapp feature
      expect(s.expenses, isFalse); // no expenses.manage

      const member = Gates(enabled: {'invoices', 'expenses'}, roles: ['member'], permissions: ['*']);
      expect(BooksAccess(member).customers, isFalse); // staff routes need owner / admin / staff
      expect(BooksAccess(member).expenses, isFalse);
      const noBook = Gates(enabled: {'invoices'}, roles: ['owner']);
      expect(BooksAccess(noBook).creditBook, isFalse);
      expect(BooksAccess(noBook).creditFields, isFalse);
    });
  });

  test('rupee text for fields', () {
    expect(paiseToInput(150000), '1500');
    expect(paiseToInput(150050), '1500.50');
    expect(paiseToInput(5), '0.05');
    expect(formatPaise(150000), '₹1,500.00');
  });
}
