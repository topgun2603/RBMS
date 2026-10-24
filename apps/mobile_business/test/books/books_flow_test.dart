import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/src/app.dart';
import 'package:srikit_business/src/app_controller.dart';
import 'package:srikit_business/src/books/credit_book_screen.dart';
import 'package:srikit_business/src/books/credit_flows.dart';
import 'package:srikit_business/src/books/customers_screen.dart';
import 'package:srikit_business/src/books/expenses_screen.dart';
import 'package:srikit_business/src/counter/tender.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../fake_api.dart';

const bookFeatures = ['invoices', 'orders', 'invoices.credit-book', 'invoices.whatsapp', 'expenses'];

Future<(AppController, FakeSrikitServer, List<Uri>)> launch(
  WidgetTester tester, {
  List<String> enabled = bookFeatures,
  List<String> roles = const ['owner'],
  List<String> permissions = const ['*'],
}) async {
  final server = FakeSrikitServer(enabled: enabled, tenantRoles: roles, permissions: permissions)..issuedToken = 'session-token';
  final c = AppController(
    api: SrikitApi(server.apiClient()),
    session: SessionStore(MemoryKeyValueStore({SessionStore.tokenKey: 'session-token'})),
  );
  final opened = <Uri>[];
  c.openUrl = (u) async {
    opened.add(u);
    return true;
  };
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.5;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(SrikitBusinessApp(controller: c));
  await c.start();
  await tester.pumpAndSettle();
  return (c, server, opened);
}

Future<void> openMore(WidgetTester tester, [Key? entry]) async {
  await tester.tap(find.text('More'));
  await tester.pumpAndSettle();
  if (entry != null) {
    await tester.tap(find.byKey(entry));
    await tester.pumpAndSettle();
  }
}

Iterable<http.Request> _writes(FakeSrikitServer s, String path) => s.requests.where((r) => r.method != 'GET' && r.url.path == path);

String? textOf(WidgetTester tester, String key) => tester.widget<Text>(find.byKey(Key(key))).data;

void main() {
  testWidgets('credit book: receive a payment → the bills it settled and the advance; one receipt after a lost answer', (tester) async {
    final (_, server, _) = await launch(tester);
    await openMore(tester, const Key('more.creditBook'));
    expect(find.byType(CreditBookScreen), findsOneWidget);
    expect(textOf(tester, 'creditBook.receivable'), '₹1,500');
    expect(find.text('Lakshmi'), findsOneWidget);
    expect(find.text('₹1,500.00'), findsOneWidget);
    expect(find.text('₹1,000.00 overdue'), findsOneWidget); // INV-0040 was due on 16 Sep

    await tester.tap(find.byKey(const Key('creditBook.receive.0')));
    await tester.pumpAndSettle();
    expect(find.byType(ReceiveSheet), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(ReceiveSheet.amountField)).controller!.text, '1500'); // the balance
    await tester.enterText(find.byKey(ReceiveSheet.amountField), '2000');
    await tester.tap(find.byKey(const Key('receive.method.upi')));

    // The server records it, but the answer is lost on the way back.
    server.books.dropAfterCommit.add('POST /v1/invoices/customers/:id/receipts');
    await tester.tap(find.byKey(ReceiveSheet.saveButton));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('receive.title')), findsNothing);
    await tester.tap(find.byKey(ReceiveSheet.saveButton)); // retry: same action, same key → the stored answer
    await tester.pumpAndSettle();

    final posts = _writes(server, '/v1/invoices/customers/c2/receipts').toList();
    expect(posts, hasLength(2));
    expect(posts.map((r) => r.headers['idempotency-key']).toSet(), hasLength(1));
    expect(posts.first.headers['idempotency-key'], isNotNull);
    expect(jsonDecode(posts.first.body), {'amount': 200000, 'method': 'upi', 'date': todayIst()});
    expect(server.books.receipts, hasLength(1)); // recorded once

    expect(find.text('₹2,000.00 received'), findsOneWidget);
    expect(find.text('Settled against'), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('receive.allocation.inv-40')), matching: find.text('Bill INV-0040')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('receive.allocation.inv-40')), matching: find.text('₹1,000.00')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('receive.allocation.inv-41')), matching: find.text('₹500.00')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('receive.advance')), matching: find.text('₹500.00')), findsOneWidget);
    expect(find.text('Kept as advance'), findsOneWidget);

    await tester.tap(find.byKey(ReceiveSheet.doneButton));
    await tester.pumpAndSettle();
    // The list reloads: Lakshmi now has ₹500 advance.
    expect(textOf(tester, 'creditBook.advance'), '₹500');
    expect(find.byKey(const Key('creditBook.remind.0')), findsNothing); // nothing due: no reminder
  });

  testWidgets('customer: share statement opens wa.me with the link; reminder sent, or WhatsApp when it fails', (tester) async {
    final (_, server, opened) = await launch(tester);
    await openMore(tester, const Key('more.customers'));
    expect(find.byType(CustomersScreen), findsOneWidget);
    expect(find.text('Over credit limit'), findsOneWidget); // Lakshmi: ₹1,500 on a ₹1,000 limit
    await tester.tap(find.text('Lakshmi'));
    await tester.pumpAndSettle();

    expect(find.byType(CustomerDetailScreen), findsOneWidget);
    expect(find.byKey(const Key('customer.balance')), findsOneWidget);
    expect(find.text('Over the limit by ₹500.00'), findsOneWidget);
    expect(find.text('INV-0041'), findsOneWidget); // recent bills

    await tester.tap(find.byKey(CustomerDetailScreen.shareButton));
    await tester.pumpAndSettle();
    final wa = opened.single;
    expect(wa.host, 'wa.me');
    expect(wa.path, '/919500012345');
    expect(wa.queryParameters['text'],
        'Hello Lakshmi, your balance with Anna Stores is ₹1,500.00. See your statement: https://anna.srikit.test/s/st-c2');
    expect(_writes(server, '/v1/invoices/customers/c2/statement/share').single.headers['idempotency-key'], isNotNull);

    await tester.tap(find.byKey(CustomerDetailScreen.remindButton));
    await tester.pumpAndSettle();
    expect(find.text('Reminder sent to Lakshmi'), findsOneWidget);
    expect(server.books.remindersSent, 1);
    final remind = _writes(server, '/v1/invoices/customers/c2/remind').single;
    expect(jsonDecode(remind.body), {'channel': 'whatsapp', 'locale': 'en'});
    expect(remind.headers['idempotency-key'], isNotNull);
    ScaffoldMessenger.of(tester.element(find.byType(CustomerDetailScreen))).clearSnackBars();
    await tester.pumpAndSettle();

    server.books.remindFails = true;
    await tester.tap(find.byKey(CustomerDetailScreen.remindButton));
    await tester.pumpAndSettle();
    expect(find.text("Couldn't send the reminder: WhatsApp is not set up for this shop"), findsOneWidget);
    await tester.tap(find.text('Use WhatsApp'));
    await tester.pumpAndSettle();
    expect(opened, hasLength(2));
    expect(opened.last.toString(), startsWith('https://wa.me/919500012345?text='));

    await tester.tap(find.byKey(CustomerDetailScreen.callButton));
    await tester.pumpAndSettle();
    expect(opened.last.toString(), 'tel:+919500012345');
  });

  testWidgets('customer: add with a credit limit, then edit sends only the change', (tester) async {
    final (_, server, _) = await launch(tester);
    await openMore(tester, const Key('more.customers'));
    await tester.tap(find.byKey(CustomersScreen.addButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(CustomerFormScreen.saveButton));
    await tester.pumpAndSettle();
    expect(find.text('Required'), findsOneWidget);
    await tester.enterText(find.byKey(CustomerFormScreen.nameField), 'Ravi');
    await tester.enterText(find.byKey(CustomerFormScreen.phoneField), '98400 11111');
    await tester.enterText(find.byKey(CustomerFormScreen.limitField), '2000');
    await tester.tap(find.byKey(CustomerFormScreen.saveButton));
    await tester.pumpAndSettle();
    final post = _writes(server, '/v1/invoices/customers').single;
    expect(jsonDecode(post.body), {'name': 'Ravi', 'phone': '98400 11111', 'creditLimit': 200000});
    expect(post.headers['idempotency-key'], isNotNull);
    expect(find.byType(CustomerDetailScreen), findsOneWidget);
    expect(find.text('₹2,000.00 still available'), findsOneWidget);

    await tester.tap(find.byKey(CustomerDetailScreen.editButton));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(CustomerFormScreen.emailField), 'ravi@example.in');
    await tester.tap(find.byKey(CustomerFormScreen.saveButton));
    await tester.pumpAndSettle();
    final patch = server.requests.singleWhere((r) => r.method == 'PATCH');
    expect(patch.url.path, '/v1/invoices/customers/c3');
    expect(jsonDecode(patch.body), {'email': 'ravi@example.in'});
    expect(find.text('ravi@example.in'), findsOneWidget);
  });

  testWidgets('expenses: add → in the list and the summary; cancel → struck out, out of the totals', (tester) async {
    final (_, server, _) = await launch(tester);
    await openMore(tester, const Key('more.expenses'));
    expect(find.byType(ExpensesScreen), findsOneWidget);
    expect(textOf(tester, 'expenses.spent'), '₹10,000');
    expect(textOf(tester, 'expenses.count'), '1');

    await tester.tap(find.byKey(ExpensesScreen.addButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(ExpenseFormScreen.saveButton));
    await tester.pumpAndSettle();
    expect(find.text('Enter an amount'), findsOneWidget);
    await tester.enterText(find.byKey(ExpenseFormScreen.amountField), '1500');
    await tester.tap(find.byKey(const Key('expenseForm.method.upi')));
    await tester.enterText(find.byKey(ExpenseFormScreen.noteField), 'Tea and snacks');
    await tester.tap(find.byKey(ExpenseFormScreen.saveButton));
    await tester.pumpAndSettle();

    final post = _writes(server, '/v1/expenses').single;
    expect(jsonDecode(post.body), {'date': todayIst(), 'categoryId': 'cat-other', 'amount': 150000, 'paymentMethod': 'upi', 'note': 'Tea and snacks'});
    expect(post.headers['idempotency-key'], isNotNull);
    expect(find.textContaining('Tea and snacks'), findsOneWidget);
    expect(textOf(tester, 'expenses.spent'), '₹11,500');
    expect(textOf(tester, 'expenses.count'), '2');
    expect(textOf(tester, 'expenses.byCategory.cat-other'), '₹1,500.00');

    await tester.tap(find.textContaining('Tea and snacks'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(ExpenseFormScreen.cancelExpenseButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('expenseForm.confirmCancel')));
    await tester.pumpAndSettle();
    final del = server.requests.singleWhere((r) => r.method == 'DELETE');
    expect(del.url.path, '/v1/expenses/e2');
    expect(del.headers['idempotency-key'], isNotNull);
    expect(find.text('Cancelled'), findsOneWidget);
    expect(textOf(tester, 'expenses.spent'), '₹10,000');
  });

  testWidgets('expense categories: add one; built-ins cannot be deleted', (tester) async {
    final (_, server, _) = await launch(tester);
    await openMore(tester, const Key('more.expenses'));
    await tester.tap(find.byKey(ExpensesScreen.categoriesButton));
    await tester.pumpAndSettle();
    expect(tester.widget<IconButton>(find.byKey(const Key('categories.delete.cat-rent'))).onPressed, isNull);
    await tester.enterText(find.byKey(ExpenseCategoriesScreen.nameField), 'Tea');
    await tester.tap(find.byKey(ExpenseCategoriesScreen.addButton));
    await tester.pumpAndSettle();
    expect(find.text('Tea'), findsOneWidget);
    expect(_writes(server, '/v1/expenses/categories').single.headers['idempotency-key'], isNotNull);
    await tester.enterText(find.byKey(ExpenseCategoriesScreen.nameField), 'Rent');
    await tester.tap(find.byKey(ExpenseCategoriesScreen.addButton));
    await tester.pumpAndSettle();
    expect(find.text('A category with that name exists'), findsOneWidget);
  });

  group('hidden without the feature or permission', () {
    testWidgets('no credit book / expenses features: customers only, without credit actions', (tester) async {
      await launch(tester, enabled: const ['invoices', 'orders']);
      await openMore(tester);
      expect(find.byKey(const Key('more.customers')), findsOneWidget);
      expect(find.byKey(const Key('more.creditBook')), findsNothing);
      expect(find.byKey(const Key('more.expenses')), findsNothing);
      await tester.tap(find.byKey(const Key('more.customers')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('customers.creditBook')), findsNothing);
      await tester.tap(find.text('Lakshmi'));
      await tester.pumpAndSettle();
      for (final k in [
        CustomerDetailScreen.receiveButton,
        CustomerDetailScreen.shareButton,
        CustomerDetailScreen.remindButton,
        CustomerDetailScreen.ledgerButton,
      ]) {
        expect(find.byKey(k), findsNothing);
      }
      expect(find.byKey(const Key('customer.creditLimit')), findsNothing);
      expect(find.byKey(CustomerDetailScreen.editButton), findsOneWidget); // owner
    });

    testWidgets('staff viewing only: customers without add / edit; no credit book, no expenses', (tester) async {
      await launch(tester, roles: const ['staff'], permissions: const ['*.view']);
      await openMore(tester);
      expect(find.byKey(const Key('more.customers')), findsOneWidget);
      expect(find.byKey(const Key('more.creditBook')), findsNothing); // needs the invoices.credit-book permission
      expect(find.byKey(const Key('more.expenses')), findsNothing); // needs expenses.manage
      await tester.tap(find.byKey(const Key('more.customers')));
      await tester.pumpAndSettle();
      expect(find.byKey(CustomersScreen.addButton), findsNothing);
      await tester.tap(find.text('Lakshmi'));
      await tester.pumpAndSettle();
      expect(find.byKey(CustomerDetailScreen.editButton), findsNothing);
      expect(find.byKey(CustomerDetailScreen.receiveButton), findsNothing);
    });

    testWidgets('staff with the credit book but not payments.receive: statement yes, receive no', (tester) async {
      await launch(tester, roles: const ['staff'], permissions: const ['invoices.credit-book', 'expenses.manage']);
      await openMore(tester);
      expect(find.byKey(const Key('more.expenses')), findsOneWidget);
      await tester.tap(find.byKey(const Key('more.creditBook')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('creditBook.receive.0')), findsNothing);
      expect(find.byKey(const Key('creditBook.remind.0')), findsOneWidget);
      await tester.tap(find.text('Lakshmi'));
      await tester.pumpAndSettle();
      expect(find.byKey(CustomerDetailScreen.shareButton), findsOneWidget);
      expect(find.byKey(CustomerDetailScreen.receiveButton), findsNothing);
    });

    testWidgets('a member (not staff) sees none of it', (tester) async {
      await launch(tester, roles: const ['member']);
      await openMore(tester);
      expect(find.byKey(const Key('more.customers')), findsNothing);
      expect(find.byKey(const Key('more.creditBook')), findsNothing);
      expect(find.byKey(const Key('more.expenses')), findsNothing);
    });
  });
}
