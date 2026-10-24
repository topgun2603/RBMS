import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/src/app.dart';
import 'package:srikit_business/src/app_controller.dart';
import 'package:srikit_business/src/counter/bill_tab.dart';
import 'package:srikit_business/src/counter/done_screen.dart';
import 'package:srikit_business/src/counter/pay_screen.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../fake_api.dart';

Future<(AppController, FakeSrikitServer)> openBillTab(WidgetTester tester, {List<String>? enabled}) async {
  final server = FakeSrikitServer(enabled: enabled ?? const ['invoices', 'catalogue', 'orders'])..issuedToken = 'session-token';
  final c = AppController(
    api: SrikitApi(server.apiClient()),
    session: SessionStore(MemoryKeyValueStore({SessionStore.tokenKey: 'session-token'})),
  );
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.5;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(SrikitBusinessApp(controller: c));
  await c.start();
  await tester.pumpAndSettle();
  await tester.tap(find.text('Bill'));
  await tester.pumpAndSettle();
  return (c, server);
}

void main() {
  testWidgets('search → add → charge → pay cash → done with the server bill → print preview → new bill', (tester) async {
    final (_, server) = await openBillTab(tester);
    expect(find.textContaining('Day not opened'), findsOneWidget);
    expect(find.text('Search or scan to add items'), findsOneWidget);

    await tester.enterText(find.byKey(BillTab.searchField), 'rice');
    await tester.pump(const Duration(milliseconds: 200)); // debounce
    await tester.pumpAndSettle();
    expect(find.text('Ponni Rice 5 kg'), findsOneWidget);
    await tester.tap(find.byKey(const Key('counter.result.0')));
    await tester.pumpAndSettle();

    // In the cart; +1 makes two bags. The button shows an estimate only.
    await tester.tap(find.byKey(const Key('counter.line.0.plus')));
    await tester.pumpAndSettle();
    expect(find.text('Charge ≈ ₹640'), findsOneWidget);
    expect(find.text('The final total is worked out when the bill is made'), findsOneWidget);

    await tester.tap(find.byKey(BillTab.chargeButton));
    await tester.pumpAndSettle();

    // The bill was created and issued in one call, with an Idempotency-Key.
    final create = server.requests.singleWhere((r) => r.method == 'POST' && r.url.path == '/v1/invoices');
    final body = jsonDecode(create.body) as Map<String, dynamic>;
    expect(body['issue'], isTrue);
    expect(body['lines'], [
      {'description': 'Ponni Rice 5 kg', 'qty': 2, 'rate': 30476, 'gstRate': 5, 'hsn': '1006', 'unit': 'pcs', 'itemId': 'v-rice', 'inclusiveTotal': 64000},
    ]);
    expect(body.containsKey('customer'), isFalse); // no customer: nothing sent
    expect(create.headers['idempotency-key'], isNotNull);

    // The pay screen shows the server's numbers.
    expect(find.byType(PayScreen), findsOneWidget);
    expect(find.text('Bill INV-0042'), findsOneWidget);
    expect(find.text('To pay ₹640.00'), findsOneWidget);

    await tester.enterText(find.byKey(PayScreen.cashField), '700');
    await tester.pumpAndSettle();
    expect(find.text('Change ₹60.00'), findsOneWidget);
    await tester.tap(find.byKey(PayScreen.completeButton));
    await tester.pumpAndSettle();

    final pay = server.requests.singleWhere((r) => r.url.path.endsWith('/payments'));
    expect(jsonDecode(pay.body), containsPair('amount', 64000));
    expect(jsonDecode(pay.body), containsPair('method', 'cash'));
    expect(pay.headers['idempotency-key'], isNot(create.headers['idempotency-key']));

    expect(find.byType(DoneScreen), findsOneWidget);
    expect(find.text('INV-0042 · ₹640.00'), findsOneWidget);
    expect(find.text('₹60.00'), findsOneWidget); // give change

    await tester.tap(find.byKey(DoneScreen.printButton));
    await tester.pumpAndSettle();
    expect(find.text('Bluetooth printers come next. This is what will print.'), findsOneWidget);
    final receipt = tester.widget<Text>(find.byKey(const Key('done.receiptText'))).data!;
    expect(receipt, contains('Bill No: INV-0042'));
    expect(receipt, contains('Rs 640.00'));
    expect(receipt, contains('Paid (Cash)'));
    expect(receipt, contains('Change'));
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(DoneScreen.newBillButton));
    await tester.pumpAndSettle();
    expect(find.byType(BillTab), findsOneWidget);
    expect(find.text('Search or scan to add items'), findsOneWidget);
  });

  testWidgets('a walk-in customer goes on the bill; leaving the pay screen cancels the bill', (tester) async {
    final (_, server) = await openBillTab(tester);
    await tester.enterText(find.byKey(BillTab.searchField), 'soap');
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('counter.result.0')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(BillTab.customerButton));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('customer.name')), 'Kumar');
    await tester.enterText(find.byKey(const Key('customer.phone')), '98765 43210');
    await tester.tap(find.byKey(const Key('customer.walkIn')));
    await tester.pumpAndSettle();
    expect(find.text('Kumar'), findsOneWidget);

    await tester.tap(find.byKey(BillTab.chargeButton));
    await tester.pumpAndSettle();
    final create = server.requests.lastWhere((r) => r.url.path == '/v1/invoices');
    expect(jsonDecode(create.body)['customer'], {'name': 'Kumar', 'phone': '+919876543210'});
    expect(find.text('To pay ₹47.00'), findsOneWidget); // ₹40 + 18% = ₹47.20 → server rounds to ₹47

    final nav = tester.state<NavigatorState>(find.byType(Navigator).first);
    await nav.maybePop();
    await tester.pumpAndSettle();
    expect(find.text('Cancel this bill?'), findsOneWidget);
    await tester.tap(find.text('Cancel bill'));
    await tester.pumpAndSettle();
    expect(server.requests.where((r) => r.url.path.endsWith('/cancel')), hasLength(1));
    expect(find.byType(BillTab), findsOneWidget);
    expect(find.text('Charge ≈ ₹47'), findsOneWidget); // the cart is still there
  });

  testWidgets('the Bill tab needs the invoices feature and the invoices.create permission', (tester) async {
    final server = FakeSrikitServer(
      enabled: const ['invoices', 'catalogue'],
      tenantRoles: const ['staff'],
      permissions: const ['invoices.view'],
    )..issuedToken = 'session-token';
    final c = AppController(
      api: SrikitApi(server.apiClient()),
      session: SessionStore(MemoryKeyValueStore({SessionStore.tokenKey: 'session-token'})),
    );
    await tester.pumpWidget(SrikitBusinessApp(controller: c));
    await c.start();
    await tester.pumpAndSettle();
    expect(c.gates.feature('invoices'), isTrue);
    expect(find.text('Bill'), findsNothing);
    expect(find.text('Home'), findsOneWidget);
  });
}
