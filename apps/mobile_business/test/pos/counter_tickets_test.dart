import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/src/counter/cart.dart';
import 'package:srikit_business/src/counter/counter_controller.dart';
import 'package:srikit_business/src/counter/tender.dart';
import 'package:srikit_business/src/pos/catalog.dart';
import 'package:srikit_business/src/pos/weigh.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../fake_api.dart';

const _gates = Gates(
  enabled: {'invoices', 'catalogue', 'pos.terminals', 'pos.weighing'},
  roles: ['owner'],
  permissions: ['*'],
);

Future<(CounterController, FakeSrikitServer)> counter() async {
  final server = FakeSrikitServer();
  final api = SrikitApi(server.apiClient());
  api.client.deviceToken = (await api.posPair('ABCD2345', const PosDeviceDescription(platform: 'android'))).value.deviceToken;
  api.client.token = (await api.posSession('8023')).token;
  final catalog = PosCatalog(api: api, store: MemoryCatalogStore());
  await catalog.sync(rethrowErrors: true);
  final session = SessionStore(MemoryKeyValueStore());
  final c = CounterController(api: api, session: session, gates: _gates, catalog: catalog, fixedRegister: 'Counter 1');
  await c.init();
  return (c, server);
}

void main() {
  test('a ticket code adds the ticket lines as fixed lines at the server prices; removable only as a group', () async {
    final (c, server) = await counter();
    expect(c.register, 'Counter 1');
    final t = server.pos.issue([
      {'itemId': 'i-tomato', 'weightKg': 1.284, 'tareKg': 0.05},
      {'itemId': 'i-coconut', 'qty': 2},
    ]);
    expect(await c.addByCode((t['code'] as String).toLowerCase()), isTrue);
    expect(c.cart.lines.map((l) => (l.product.name, l.qty, l.price, l.fixed)), [
      ('Tomato', 1.234, 4000, true),
      ('Coconut', 2.0, 3500, true),
    ]);
    // The bill line charges exactly the ticket's amount.
    expect(c.cart.lines.first.gross, 4936);
    expect(toLineInput(c.cart.lines.first).rate, 4000); // 0% GST: the rate is the price
    final key = c.cart.lines.first.key;
    c.step(key, 1);
    c.setQty(key, 5);
    expect(c.cart.lines.first.qty, 1.234); // fixed
    await expectLater(c.addByCode(t['code'] as String), throwsA(isA<TicketProblem>().having((p) => p.kind, 'kind', TicketProblemKind.duplicate)));
    c.remove(c.cart.lines.last.key);
    expect(c.cart.isEmpty, isTrue); // the whole ticket left
  });

  test('ticket errors: 404 not found, 409 used / cancelled, 410 expired', () async {
    final (c, server) = await counter();
    Future<TicketProblemKind> kind(String code) async {
      try {
        await c.lookupCode(code);
      } on TicketProblem catch (p) {
        return p.kind;
      }
      fail('no problem for $code');
    }

    expect(await kind('W00000000000'), TicketProblemKind.notFound);
    final used = server.pos.issue([{'itemId': 'i-onion', 'weightKg': 1}]);
    server.pos.tickets[used['id']]!['status'] = 'used';
    expect(await kind(used['code'] as String), TicketProblemKind.used);
    final gone = server.pos.issue([{'itemId': 'i-onion', 'weightKg': 1}]);
    server.pos.tickets[gone['id']]!['status'] = 'cancelled';
    expect(await kind(gone['code'] as String), TicketProblemKind.cancelled);
    final old = server.pos.issue([{'itemId': 'i-onion', 'weightKg': 1}]);
    server.pos.tickets[old['id']]!['expired'] = true;
    expect(await kind(old['code'] as String), TicketProblemKind.expired);
  });

  test('after the bill each ticket is marked used; a lost answer is retried with the same key and used once', () async {
    final (c, server) = await counter();
    final t = server.pos.issue([{'itemId': 'i-tomato', 'weightKg': 2}]);
    await c.addByCode(t['code'] as String);
    expect(await c.addByCode('8901000000011'), isTrue); // rice from the local cache
    expect(server.requests.where((r) => r.url.path.startsWith('/v1/catalog')), isEmpty);

    server.pos.dropAfterCommit.add('POST /v1/pos/weigh-tickets/:id/use');
    final bill = await c.createBill();
    expect(c.ticketUseFailures.single.code, t['code']);
    expect(c.ticketUseFailures.single.isFinal, isFalse);
    final first = server.pos.requests.lastWhere((r) => r.url.path.endsWith('/use'));
    expect(first.body, contains(bill.id));

    final outcome = await c.pay(Tenders(cash: bill.balance)); // retries the use first
    expect(outcome.bill.balance, 0);
    final uses = server.pos.requests.where((r) => r.url.path.endsWith('/use')).toList();
    expect(uses, hasLength(2));
    expect(uses[1].headers['idempotency-key'], uses[0].headers['idempotency-key']);
    expect(server.pos.useCommits, 1);
    expect(server.pos.tickets[t['id']]!['status'], 'used');
    expect(c.ticketUseFailures, isEmpty);
    expect(c.pendingKeys.keys.where((k) => k.startsWith('ticket.use')), isEmpty);
  });

  test('a ticket another bill already used is reported, not retried', () async {
    final (c, server) = await counter();
    final t = server.pos.issue([{'itemId': 'i-tomato', 'weightKg': 1}]);
    await c.addByCode(t['code'] as String);
    server.pos.tickets[t['id']]!
      ..['status'] = 'used'
      ..['usedInvoiceId'] = 'inv-other';
    await c.createBill();
    expect(c.ticketUseFailures.single.isFinal, isTrue);
    await c.useTickets();
    expect(server.pos.requests.where((r) => r.url.path.endsWith('/use')), hasLength(1));
  });

  test('search uses the device catalogue first, the API when nothing matches locally', () async {
    final (c, server) = await counter();
    expect((await c.search('toma')).map((p) => (p.name, p.byWeight)), [('Tomato', true)]);
    expect(server.requests.where((r) => r.url.path == '/v1/catalog/variants/search'), isEmpty);
    await c.search('redmi');
    expect(server.requests.where((r) => r.url.path == '/v1/catalog/variants/search'), hasLength(1));
  });
}
