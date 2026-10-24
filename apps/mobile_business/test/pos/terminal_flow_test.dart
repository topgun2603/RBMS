import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/src/app.dart';
import 'package:srikit_business/src/app_controller.dart';
import 'package:srikit_business/src/counter/bill_tab.dart';
import 'package:srikit_business/src/counter/done_screen.dart';
import 'package:srikit_business/src/counter/pay_screen.dart';
import 'package:srikit_business/src/pos/catalog.dart';
import 'package:srikit_business/src/pos/lock_screen.dart';
import 'package:srikit_business/src/pos/pair_screen.dart';
import 'package:srikit_business/src/pos/terminal_controller.dart';
import 'package:srikit_business/src/pos/ticket_view.dart';
import 'package:srikit_business/src/pos/weighing_screen.dart';
import 'package:srikit_business/src/screens/sign_in.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../fake_api.dart';

class Rig {
  Rig(this.app, this.server, this.store);
  final AppController app;
  final FakeSrikitServer server;
  final MemoryKeyValueStore store;
  DateTime now = DateTime.utc(2026, 10, 22, 10);
}

Future<Rig> openApp(WidgetTester tester, {MemoryKeyValueStore? store, FakeSrikitServer? server}) async {
  final srv = server ?? FakeSrikitServer();
  final kv = store ?? MemoryKeyValueStore();
  late Rig rig;
  final catalogs = <String, MemoryCatalogStore>{};
  final app = AppController(
    api: SrikitApi(srv.apiClient()),
    session: SessionStore(kv),
    catalogStoreFor: (id) async => catalogs[id] ??= MemoryCatalogStore(),
    now: () => rig.now,
  );
  rig = Rig(app, srv, kv);
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.5;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(SrikitBusinessApp(controller: app));
  await app.start();
  await tester.pumpAndSettle();
  return rig;
}

Future<void> pin(WidgetTester tester, String digits) async {
  for (final d in digits.split('')) {
    await tester.tap(find.byKey(LockScreen.digitKey(d)));
    await tester.pump();
  }
  await tester.tap(find.byKey(LockScreen.unlockButton));
  await tester.pumpAndSettle();
}

Future<void> pairAs(WidgetTester tester, String code) async {
  await tester.tap(find.byKey(SignInScreen.terminalButton));
  await tester.pumpAndSettle();
  expect(find.byType(PairScreen), findsOneWidget);
  await tester.enterText(find.byKey(PairScreen.codeField), code);
  await tester.tap(find.byKey(PairScreen.pairButton));
  await tester.pumpAndSettle();
}

/// Stops the terminal's timers (idle lock, session expiry, catalogue refresh) before the test ends.
Future<void> finish(WidgetTester tester, Rig rig) async {
  final t = rig.app.terminal;
  if (t != null) {
    t.idle.stop();
    t.catalog?.stopAutoSync();
    await t.lock(tellServer: false);
  }
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('pair → lock screen → PIN → counter → scan a weigh ticket → pay → ticket used once (same key on retry)', (tester) async {
    final rig = await openApp(tester);
    final server = rig.server;
    await pairAs(tester, 'abcd2345');

    // Paired: the token is in secure storage and goes on every request.
    expect(rig.store.values[SessionStore.posDeviceTokenKey], startsWith('dev-term-pos'));
    final pairReq = server.pos.requests.singleWhere((r) => r.url.path == '/v1/pos/pair');
    expect(pairReq.body, contains('"platform":"android"'));
    expect(find.byType(LockScreen), findsOneWidget);
    expect(find.text('Anna Stores · Counter 1'), findsOneWidget);
    expect(find.text('Team member'), findsOneWidget); // a member without a name
    expect(find.text('Ravi · No PIN yet'), findsOneWidget);

    await pin(tester, '8023');
    expect(find.byType(BillTab), findsOneWidget);
    expect(find.text('Counter 1 · Cashier: Anna'), findsOneWidget);
    expect(find.textContaining('· Counter 1'), findsOneWidget); // till register = terminal name
    final till = server.requests.lastWhere((r) => r.url.path == '/v1/invoices/till/current');
    expect(till.url.queryParameters['register'], 'Counter 1');
    expect(till.headers['x-device-token'], rig.store.values[SessionStore.posDeviceTokenKey]);
    expect(till.headers['authorization'], startsWith('Bearer pin-'));
    // The catalogue synced into the device store, with categories.
    expect(rig.app.terminal!.catalog!.count, 5);
    expect(find.text('Vegetables'), findsOneWidget);

    // A weigh ticket from the weighing station, typed as a scanner would.
    final t = server.pos.issue([
      {'itemId': 'i-tomato', 'weightKg': 1.284, 'tareKg': 0.05},
    ]);
    await tester.enterText(find.byKey(BillTab.searchField), t['code'] as String);
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text('Weigh ticket ${t['code']} added'), findsOneWidget);
    expect(find.textContaining('Ticket ${t['code']}'), findsOneWidget);
    expect(find.text('₹49.36'), findsOneWidget);

    server.pos.dropAfterCommit.add('POST /v1/pos/weigh-tickets/:id/use');
    await tester.pump(const Duration(seconds: 3)); // the "added" snack bar covers the Charge bar
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(BillTab.chargeButton));
    await tester.pumpAndSettle();
    expect(find.byType(PayScreen), findsOneWidget);
    final uses = server.pos.requests.where((r) => r.url.path.endsWith('/use'));
    expect(uses, hasLength(1)); // committed, answer lost

    await tester.tap(find.byKey(PayScreen.completeButton));
    await tester.pumpAndSettle();
    expect(find.byType(DoneScreen), findsOneWidget);
    expect(uses, hasLength(2));
    expect(uses.last.headers['idempotency-key'], uses.first.headers['idempotency-key']);
    expect(server.pos.useCommits, 1);
    expect(find.byKey(const Key('done.ticketUseFailed')), findsNothing);

    await tester.tap(find.byKey(DoneScreen.newBillButton));
    await tester.pumpAndSettle();
    // The same ticket again: already billed.
    await tester.enterText(find.byKey(BillTab.searchField), t['code'] as String);
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text('Ticket ${t['code']} is already billed.'), findsOneWidget);

    // Switch cashier → the lock screen; the PIN session is revoked on the server.
    await tester.tap(find.byKey(const Key('terminal.lock')));
    await tester.pumpAndSettle();
    expect(find.byType(LockScreen), findsOneWidget);
    expect(server.pos.requests.where((r) => r.url.path == '/v1/pos/session/lock'), hasLength(1));
    expect(server.pos.sessions, isEmpty);
    await finish(tester, rig);
  });

  testWidgets('weighing station: pick → weigh with tare → issue → the ticket with its barcode → print preview', (tester) async {
    final rig = await openApp(tester);
    await pairAs(tester, 'WXYZ-6789');
    expect(find.text('Anna Stores · Weighing 1'), findsOneWidget);
    await pin(tester, '8023');
    expect(find.byType(WeighingScreen), findsOneWidget);
    // By-weight items first.
    expect(tester.widget<ListTile>(find.byKey(const Key('weigh.item.0'))).title, isA<Text>().having((t) => t.data, 'text', 'Onion'));

    await tester.tap(find.text('Tomato'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(WeighSheet.grossField), '1.284');
    await tester.enterText(find.byKey(WeighSheet.tareField), '0.05');
    await tester.pumpAndSettle();
    expect(find.text('Net 1.234 kg'), findsOneWidget);
    await tester.tap(find.byKey(WeighSheet.addButton));
    await tester.pumpAndSettle();
    expect(find.text('Issue ticket · ≈ ₹49.36'), findsOneWidget);

    await tester.tap(find.text('Coconut'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(WeighSheet.qtyField), '2');
    await tester.tap(find.byKey(WeighSheet.addButton));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(WeighingScreen.issueButton));
    await tester.pumpAndSettle();
    final req = rig.server.pos.requests.singleWhere((r) => r.method == 'POST' && r.url.path == '/v1/pos/weigh-tickets');
    expect(req.body, '{"lines":[{"itemId":"i-tomato","weightKg":1.284,"tareKg":0.05},{"itemId":"i-coconut","qty":2}]}');
    expect(req.headers['idempotency-key'], isNotNull);
    expect(find.byType(TicketScreen), findsOneWidget);
    final code = rig.server.pos.tickets.values.single['code'] as String;
    expect(find.text(code), findsOneWidget);
    expect(find.byType(Code128Barcode), findsOneWidget);
    expect(find.text('₹119.36'), findsWidgets);

    await tester.tap(find.byKey(TicketScreen.printButton));
    await tester.pumpAndSettle();
    final text = tester.widget<Text>(find.byKey(const Key('ticket.printText'))).data!;
    expect(text, contains('WEIGH TICKET'));
    expect(text, contains('Terminal: Weighing 1'));
    expect(text, contains('1.234 kg x 40.00/kg'));
    expect(text, contains(code));
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(TicketScreen.nextButton));
    await tester.pumpAndSettle();
    expect(find.text('No lines yet'), findsOneWidget);

    // Today's tickets, with cancel.
    await tester.tap(find.byKey(WeighingScreen.todayButton));
    await tester.pumpAndSettle();
    expect(find.textContaining(code), findsOneWidget);
    await tester.tap(find.byIcon(Icons.cancel_outlined));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel ticket'));
    await tester.pumpAndSettle();
    expect(rig.server.pos.tickets.values.single['status'], 'cancelled');
    expect(find.textContaining('Cancelled'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await finish(tester, rig);
  });

  testWidgets('wrong PINs show the tries left, then a lockout countdown that closes the pad until it ends', (tester) async {
    final rig = await openApp(tester);
    await pairAs(tester, 'ABCD2345');
    await pin(tester, '1111');
    expect(find.text('Wrong PIN. 4 tries left.'), findsOneWidget);
    for (var i = 0; i < 4; i++) {
      await pin(tester, '1111');
    }
    expect(find.text('Too many wrong PINs. Try again in 5:00.'), findsOneWidget);
    await tester.tap(find.byKey(LockScreen.digitKey('8')));
    expect(tester.widget<FilledButton>(find.byKey(LockScreen.unlockButton)).onPressed, isNull);
    rig.now = rig.now.add(const Duration(minutes: 2));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Too many wrong PINs. Try again in 3:00.'), findsOneWidget);
    rig.now = rig.now.add(const Duration(minutes: 3));
    rig.server.pos.failures.clear(); // the server's lockout is over too
    await tester.pump(const Duration(seconds: 1));
    expect(find.byKey(LockScreen.problemText), findsNothing);
    await pin(tester, '8023');
    expect(find.byType(BillTab), findsOneWidget);
    await finish(tester, rig);
  });

  testWidgets('a member without invoices.create gets pin_not_allowed on a counter', (tester) async {
    final rig = await openApp(tester);
    await pairAs(tester, 'ABCD2345');
    await pin(tester, '4682');
    expect(find.text("You can't use this terminal. Ask the owner for access."), findsOneWidget);
    await finish(tester, rig);
  });

  testWidgets('idle for lockAfterMinutes locks the terminal; a paired phone opens on its lock screen next launch', (tester) async {
    final rig = await openApp(tester);
    await pairAs(tester, 'ABCD2345');
    await pin(tester, '8023');
    expect(find.byType(BillTab), findsOneWidget);
    await tester.pump(const Duration(minutes: 5, seconds: 1));
    await tester.pumpAndSettle();
    expect(find.byType(LockScreen), findsOneWidget);
    expect(find.text('Locked after a while without use.'), findsOneWidget);
    await finish(tester, rig);

    // Next launch: straight to the lock screen with the saved device token, no owner session.
    final again = await openApp(tester, store: rig.store, server: rig.server);
    expect(find.byType(LockScreen), findsOneWidget);
    expect(again.app.terminal!.phase, TerminalPhase.locked);
    await finish(tester, again);
  });

  testWidgets('device_not_paired from any request goes back to pairing; Unpair forgets the phone', (tester) async {
    final rig = await openApp(tester);
    await pairAs(tester, 'ABCD2345');
    await pin(tester, '8023');
    rig.server.pos.devices.clear(); // the manager unpaired it on the web
    await tester.tap(find.byKey(const Key('terminal.lock')));
    await tester.pumpAndSettle();
    expect(find.byType(PairScreen), findsOneWidget);
    expect(find.text('This phone was unpaired from its terminal. Pair it again.'), findsOneWidget);
    expect(rig.store.values.containsKey(SessionStore.posDeviceTokenKey), isFalse);

    // Pair again (a new code), then unpair from the terminal settings.
    rig.server.pos.codes['QRST6789'] = 'term-pos';
    // What a scanned QR does (the camera is not available in widget tests).
    await rig.app.terminal!.pair('srikit-pair:1:http://api.test:QRST-6789');
    await tester.pumpAndSettle();
    expect(rig.app.api.client.baseUri.toString(), 'http://api.test'); // the QR named the same API
    await pin(tester, '8023');
    await tester.tap(find.byKey(const Key('terminal.settings')));
    await tester.pumpAndSettle();
    expect(find.textContaining('5 items · synced'), findsOneWidget);
    await tester.tap(find.byKey(const Key('terminal.unpair')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('terminal.unpairConfirm')));
    await tester.pumpAndSettle();
    expect(rig.server.pos.requests.where((r) => r.url.path == '/v1/pos/device/unpair'), hasLength(1));
    expect(find.byType(PairScreen), findsOneWidget);
    expect(rig.store.values.containsKey(SessionStore.posDeviceTokenKey), isFalse);
    await tester.tap(find.byKey(PairScreen.backButton));
    await tester.pumpAndSettle();
    expect(find.byType(SignInScreen), findsOneWidget);
  });

  testWidgets('the pairing screen in Tamil', (tester) async {
    final rig = await openApp(tester, store: MemoryKeyValueStore({SessionStore.localeKey: 'ta'}));
    await tester.tap(find.byKey(SignInScreen.terminalButton));
    await tester.pumpAndSettle();
    expect(find.text('இந்த ஃபோனை ஒரு டெர்மினலுடன் இணைக்கவும்'), findsOneWidget);
    await tester.enterText(find.byKey(PairScreen.codeField), 'ZZZZ2222');
    await tester.tap(find.byKey(PairScreen.pairButton));
    await tester.pumpAndSettle();
    expect(find.text('இந்த இணைப்புக் குறியீடு தவறு அல்லது காலாவதியானது. புதியதைக் கேளுங்கள்.'), findsOneWidget);
    await finish(tester, rig);
  });
}
