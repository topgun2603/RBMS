import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/src/counter/cart.dart';
import 'package:srikit_business/src/counter/counter_controller.dart';
import 'package:srikit_business/src/counter/tender.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../fake_api.dart';

const rice = CartProduct(itemId: 'v-rice', name: 'Ponni Rice 5 kg', price: 32000, taxInclusive: true, gstRate: 5);

/// A counter signed in to the fake server's shop (owner, catalogue on).
CounterController counterOn(FakeSrikitServer server) {
  final client = server.apiClient()
    ..token = 'session-token'
    ..tenant = 'anna-stores';
  server.issuedToken = 'session-token';
  return CounterController(
    api: SrikitApi(client),
    session: SessionStore(MemoryKeyValueStore()),
    gates: const Gates(enabled: {'invoices', 'catalogue'}, roles: ['owner']),
    actorName: 'Anna',
  );
}

List<String?> keysOf(FakeSrikitServer s, String method, String pathEnd) =>
    s.requests.where((r) => r.method == method && r.url.path.endsWith(pathEnd)).map((r) => r.headers['idempotency-key']).toList();

void main() {
  test('a bill retried after a network error reuses its key and is made once', () async {
    final server = FakeSrikitServer();
    final c = counterOn(server)..addProduct(rice, qty: 2);
    server.counter.failBefore.add('POST /v1/invoices');

    await expectLater(c.createBill(), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'network', isTrue)));
    expect(c.pendingKeys, hasLength(1));
    final bill = await c.createBill();

    final keys = keysOf(server, 'POST', '/v1/invoices');
    expect(keys, hasLength(2));
    expect(keys.first, isNotNull);
    expect(keys.first, keys.last);
    expect(isValidIdempotencyKey(keys.first!), isTrue);
    expect(server.counter.billsMade, 1);
    expect(bill.number, 'INV-0042');
    expect(c.pendingKeys, isEmpty);
  });

  test('an answer lost after the server made the bill: the retry is replayed and taken as success', () async {
    final server = FakeSrikitServer();
    final c = counterOn(server)..addProduct(rice, qty: 2);
    server.counter.dropAfterCommit.add('POST /v1/invoices');

    await expectLater(c.createBill(), throwsA(isA<ApiException>()));
    expect(server.counter.billsMade, 1); // the server did make it
    final bill = await c.createBill();
    expect(server.counter.billsMade, 1); // and not again
    expect(bill.total, 64000);
    final keys = keysOf(server, 'POST', '/v1/invoices');
    expect(keys.toSet(), hasLength(1));
  });

  test('a payment retried after a lost answer is recorded once, with the same key', () async {
    final server = FakeSrikitServer();
    final c = counterOn(server)..addProduct(rice, qty: 2);
    await c.createBill();
    server.counter.dropAfterCommit.add('POST /v1/invoices/:id/payments');

    const tenders = Tenders(cash: 70000);
    await expectLater(c.pay(tenders), throwsA(isA<ApiException>()));
    final outcome = await c.pay(tenders);

    final keys = keysOf(server, 'POST', '/payments');
    expect(keys, hasLength(2));
    expect(keys.first, keys.last);
    expect(server.counter.paymentsMade, 1);
    expect(outcome.bill.balance, 0);
    expect(outcome.change, 6000);
    expect(outcome.unrecorded, 0);
  });

  test('changing the cart after a failure makes a new key (a different action)', () async {
    final server = FakeSrikitServer();
    final c = counterOn(server)..addProduct(rice);
    server.counter.failBefore.add('POST /v1/invoices');
    await expectLater(c.createBill(), throwsA(isA<ApiException>()));
    c.addProduct(rice);
    await c.createBill();
    final keys = keysOf(server, 'POST', '/v1/invoices');
    expect(keys.first, isNot(keys.last));
  });

  test('split payments go UPI → card → cash with one key each; finishing without a failed one reports it', () async {
    final server = FakeSrikitServer();
    final c = counterOn(server)..addProduct(rice, qty: 2); // ₹640
    await c.createBill();
    server.counter.failBefore.add('POST /v1/invoices/:id/payments');
    const t = Tenders(upi: 20000, card: 10000, cash: 40000);
    await expectLater(c.pay(t, upiRef: 'UTR9'), throwsA(isA<ApiException>()));
    // Second try records all three; the first (UPI) carries the key of the failed attempt.
    final o = await c.pay(t, upiRef: 'UTR9');
    final pays = server.requests.where((r) => r.url.path.endsWith('/payments')).toList();
    expect(pays.map((r) => r.body.contains('"method":"upi"')), [true, true, false, false]);
    expect(pays[0].headers['idempotency-key'], pays[1].headers['idempotency-key']);
    expect(pays.skip(1).map((r) => r.headers['idempotency-key']).toSet(), hasLength(3));
    expect(o.bill.balance, 0);
    expect(o.change, 6000); // ₹400 cash for ₹340 due

    final c2 = counterOn(server)..addProduct(rice);
    await c2.createBill();
    server.counter.failBefore.add('POST /v1/invoices/:id/payments');
    await expectLater(c2.pay(const Tenders(cash: 32000)), throwsA(isA<ApiException>()));
    final skipped = c2.finishWithout();
    expect(skipped.unrecorded, 32000);
    expect(skipped.change, 0);
  });

  test('scanned codes: lookup, then counter resolve for scale labels and IMEIs', () async {
    final server = FakeSrikitServer();
    final c = counterOn(server);
    expect(await c.addByCode('8901000000011'), isTrue); // barcode
    expect(await c.addByCode('2100001012504'), isTrue); // scale label: 1.25 kg of dal
    expect(await c.addByCode('861234567890123'), isTrue); // IMEI
    expect(await c.addByCode('861234567890123'), isTrue); // same unit again: not added twice
    expect(await c.addByCode('0000000000'), isFalse);
    expect(c.cart.lines.map((l) => '${l.product.itemId}:${l.qty}:${l.serials.join()}'),
        ['v-rice:1.0:', 'v-dal:1.25:', 'v-phone:1.0:861234567890123']);
    final resolveCalls = server.requests.where((r) => r.url.path == '/v1/counter/resolve').length;
    expect(resolveCalls, 4); // only after a lookup 404
  });

  test('till: open, cash out, close with the counted cash', () async {
    final server = FakeSrikitServer();
    final c = counterOn(server);
    await c.init();
    expect(c.dayOpen, isFalse);
    await c.openTill('  Counter   2 ', 50000);
    expect(c.register, 'Counter 2');
    expect(c.dayOpen, isTrue);
    await c.cashInOut(-10000, 'Tea and snacks');
    c.addProduct(rice);
    await c.createBill();
    expect(server.requests.last.body, contains('"tillSessionId":"till-1"'));
    await c.pay(const Tenders(cash: 32000));
    final x = await c.xReport();
    expect(x.report.cashExpected, 50000 - 10000 + 32000);
    final z = await c.closeTill(71000, 'ok');
    expect(z.session.difference, -1000);
    expect(c.dayOpen, isFalse);
    final writes = server.requests.where((r) => r.method == 'POST' && r.url.path.contains('/till/'));
    expect(writes.every((r) => r.headers['idempotency-key'] != null), isTrue);
  });
}
