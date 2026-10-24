import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:test/test.dart';

void main() {
  test('product rows: stock absent (not tracked by the shop), null (no tracked variant) or a badge', () {
    final none = ProductRow.fromJson({'id': 'a', 'name': 'A', 'priceMin': 1, 'priceMax': 1});
    expect(none.stockTracked, isFalse);
    final untracked = ProductRow.fromJson({'id': 'b', 'name': 'B', 'stock': null});
    expect(untracked.stockTracked, isTrue);
    expect(untracked.stock, isNull);
    final low = ProductRow.fromJson({'id': 'c', 'name': 'C', 'stock': {'qty': 2.5, 'status': 'low'}});
    expect(low.stock?.qty, 2.5);
    expect(low.stock?.status, 'low');
  });

  test('order: counts, nextStatuses, payments from events, fulfilment', () {
    final page = OrderPage.fromJson({
      'items': [
        {'id': 'o', 'number': 'ORD/1', 'status': 'placed', 'paymentStatus': 'cod', 'paymentMethod': 'cod', 'customerName': 'L', 'itemCount': 2, 'total': 100, 'paid': 0, 'placedAt': '2026-10-21T04:30:00.000Z'},
      ],
      'total': 1,
      'counts': {'placed': 1, 'confirmed': 0},
    });
    expect(page.counts['placed'], 1);
    expect(page.items.single.paymentStatus, 'cod');
    final o = Order.fromJson({
      'id': 'o',
      'number': 'ORD/1',
      'status': 'shipped',
      'paymentMethod': 'cod',
      'customer': {'name': 'L'},
      'totals': {'total': 100, 'shipping': 40},
      'total': 100,
      'paid': 0,
      'balance': 100,
      'fulfillment': {'carrier': 'DTDC', 'trackingNumber': 'T1'},
      'events': [
        {'id': 'e', 'type': 'payment', 'data': {'amount': 50, 'method': 'upi', 'source': 'manual'}},
      ],
      'nextStatuses': ['delivered'],
    });
    expect(o.nextStatuses, ['delivered']);
    expect(o.isCod, isTrue);
    expect(o.payments.single.method, 'upi');
    expect(o.fulfillment.carrier, 'DTDC');
    expect(o.fulfillment.isEmpty, isFalse);
    expect(o.totals.shipping, 40);
    expect(OrderSummary.fromJson({'pending': {'placed': 4}}).newOrders, 4);
  });

  test('order status, payment and stock adjust bodies', () async {
    final seen = <http.Request>[];
    final api = SrikitApi(ApiClient(
      baseUrl: 'http://api.test',
      client: const ClientInfo(app: 'business', version: '0.1.0'),
      httpClient: MockClient((r) async {
        seen.add(r);
        final body = r.url.path.contains('/inventory/') ? {'itemId': 'v', 'name': 'Dal', 'unit': 'kg', 'qty': 3.75} : {'id': 'o', 'number': 'ORD/1', 'status': 'shipped'};
        return http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json'});
      }),
    ));
    await api.setOrderStatus('o', 'shipped', fulfillment: const Fulfillment(carrier: 'DTDC'), idempotencyKey: 'dev:aaaaaaaa');
    expect(jsonDecode(seen.last.body), {'status': 'shipped', 'fulfillment': {'carrier': 'DTDC'}});
    await api.setOrderStatus('o', 'cancelled', note: ' Out of stock ');
    expect(jsonDecode(seen.last.body), {'status': 'cancelled', 'note': 'Out of stock'});
    await api.recordOrderPayment('o', amount: 500, method: 'upi', reference: ' ', date: '2026-10-21');
    expect(jsonDecode(seen.last.body), {'amount': 500, 'method': 'upi', 'date': '2026-10-21'});
    final s = await api.adjustStock('v', mode: 'add', qty: 1.25, note: 'sack', idempotencyKey: 'dev:bbbbbbbb');
    expect(jsonDecode(seen.last.body), {'mode': 'add', 'qty': 1.25, 'note': 'sack'});
    expect(seen.last.headers['idempotency-key'], 'dev:bbbbbbbb');
    expect(s.value.qty, 3.75);
    await api.adjustStock('v', mode: 'set', qty: 10);
    expect(jsonDecode(seen.last.body), {'mode': 'set', 'qty': 10});
    await api.stock(statuses: const ['low', 'out'], locationId: 'all');
    expect(seen.last.url.queryParameters, containsPair('status', 'low,out'));
    expect(seen.last.url.queryParameters, containsPair('locationId', 'all'));
  });
}
