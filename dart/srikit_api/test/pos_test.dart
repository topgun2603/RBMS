import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:test/test.dart';

const info = ClientInfo(app: 'business', version: '1.0.0', platform: 'android');

http.Response json(Object body, [int status = 200, Map<String, String> headers = const {}]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8', ...headers});

Map<String, Object?> terminal({String role = 'pos'}) => {
      'id': '00000000-0000-4000-8000-000000000001',
      'name': 'Counter 1',
      'role': role,
      'branchId': null,
      'locationId': null,
      'settings': {'printerWidth': 80, 'autoPrint': false, 'lockAfterMinutes': 3},
      'paired': true,
      'device': {'platform': 'android', 'model': 'Pixel', 'appVersion': '0.1.0', 'name': null},
      'pairedAt': '2026-10-22T04:00:00.000Z',
      'lastSeenAt': null,
      'pairingPending': false,
      'createdAt': '2026-10-22T03:00:00.000Z',
    };

Map<String, Object?> ticket({String status = 'open'}) => {
      'id': 't-1',
      'code': 'W26102200017',
      'terminalId': 'term-w',
      'status': status,
      'lines': [
        {
          'itemId': 'v-1',
          'name': 'Tomato',
          'unit': 'kg',
          'qty': 1.234,
          'unitPrice': 4000,
          'amount': 4936,
          'taxInclusive': true,
          'gstRate': 0,
          'hsn': null,
          'tareKg': 0.05,
        },
      ],
      'total': 4936,
      'note': null,
      'createdAt': '2026-10-22T05:00:00.000Z',
      'expiresAt': '2026-10-22T18:29:59.999Z',
      'usedInvoiceId': null,
    };

void main() {
  test('x-device-token goes on every request once set, next to the PIN session bearer', () async {
    final seen = <http.Request>[];
    final c = ApiClient(
      baseUrl: 'http://api.test',
      client: info,
      httpClient: MockClient((r) async {
        seen.add(r);
        return json({'ok': true});
      }),
    );
    await c.get('/pos/device');
    expect(seen.last.headers.containsKey('x-device-token'), isFalse);
    c
      ..deviceToken = 'dev-tok'
      ..token = 'pin-tok';
    await c.get('/pos/staff');
    await c.post('/invoices', {'a': 1});
    for (final r in seen.skip(1)) {
      expect(r.headers['x-device-token'], 'dev-tok');
      expect(r.headers['authorization'], 'Bearer pin-tok');
    }
  });

  test('setBaseUrl switches the origin (a pairing QR of another API)', () async {
    late Uri url;
    final c = ApiClient(baseUrl: 'http://10.0.2.2:4000', client: info, httpClient: MockClient((r) async {
      url = r.url;
      return json({'ok': true});
    }));
    c.setBaseUrl('https://api.srikit.in/');
    await c.get('/pos/device');
    expect(url.toString(), 'https://api.srikit.in/v1/pos/device');
  });

  test('onUnauthorized hears every 401 with its code', () async {
    final codes = <String>[];
    final c = ApiClient(baseUrl: 'http://api.test', client: info, httpClient: MockClient((r) async {
      return json({'error': {'code': 'device_not_paired', 'message': 'Pair again'}}, 401);
    }))
      ..onUnauthorized = (e) => codes.add(e.code);
    await expectLater(c.get('/pos/device'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'device_not_paired')));
    expect(codes, ['device_not_paired']);
  });

  group('SrikitApi pos', () {
    late List<http.Request> seen;
    late SrikitApi api;
    late http.Response Function(http.Request) answer;
    setUp(() {
      seen = [];
      api = SrikitApi(ApiClient(baseUrl: 'http://api.test', client: info, httpClient: MockClient((r) async {
        seen.add(r);
        return answer(r);
      })));
    });

    test('pair sends the code and the device; parses token, terminal and shop', () async {
      answer = (_) => json({
            'deviceToken': 'dt',
            'terminal': terminal(),
            'shop': {'id': 's', 'slug': 'murugan', 'name': 'Murugan Stores', 'appId': 'shop'},
          });
      final r = await api.posPair('ABCD-2345', const PosDeviceDescription(platform: 'android', model: ' Pixel 8 ', appVersion: '0.1.0'));
      expect(jsonDecode(seen.single.body), {
        'code': 'ABCD-2345',
        'device': {'platform': 'android', 'model': 'Pixel 8', 'appVersion': '0.1.0'},
      });
      expect(r.value.deviceToken, 'dt');
      expect(r.value.terminal.settings.lockAfterMinutes, 3);
      expect(r.value.terminal.settings.printerWidth, 80);
      expect(r.value.terminal.device!.model, 'Pixel');
      expect(r.value.shop.slug, 'murugan');
    });

    test('PIN session: user name may be null', () async {
      answer = (_) => json({
            'token': 'pin',
            'expiresAt': '2026-10-22T16:00:00.000Z',
            'user': {'id': 'u', 'name': null},
            'permissions': ['*'],
            'tenantRoles': ['owner'],
          });
      final s = await api.posSession('8023');
      expect(jsonDecode(seen.single.body), {'pin': '8023'});
      expect(s.userName, isNull);
      expect(s.permissions, ['*']);
      expect(s.expired(DateTime.utc(2026, 10, 22, 17)), isTrue);
      expect(s.expired(DateTime.utc(2026, 10, 22, 15)), isFalse);
    });

    test('catalog: since or after (never both), ETag kept, 304 is unchanged', () async {
      answer = (r) => r.headers['if-none-match'] == '"e1"'
          ? http.Response('', 304)
          : json({
              'items': [
                {
                  'itemId': 'v1',
                  'productId': null,
                  'name': 'Tomato',
                  'variantTitle': '',
                  'sku': null,
                  'barcodes': ['890'],
                  'categoryId': null,
                  'price': 4000,
                  'mrp': null,
                  'taxInclusive': true,
                  'gstRate': 0,
                  'hsn': null,
                  'unit': 'kg',
                  'soldBy': 'weight',
                  'plu': '42',
                  'image': null,
                  'stock': null,
                  'active': true,
                  'updatedAt': '2026-10-22T05:00:00.000Z',
                },
              ],
              'removed': ['old'],
              'cursor': 'c2',
              'next': 'p2',
              'full': false,
            }, 200, {'etag': '"e1"'});
      final p = await api.posCatalog(since: 'c1', limit: 1000);
      expect(seen.last.url.queryParameters, {'since': 'c1', 'limit': '1000'});
      expect(p.etag, '"e1"');
      expect(p.items.single.byWeight, isTrue);
      expect(p.items.single.toJson()['barcodes'], ['890']);
      expect(p.removed, ['old']);
      expect(p.next, 'p2');
      await api.posCatalog(since: 'c1', after: 'p2');
      expect(seen.last.url.queryParameters, {'after': 'p2'});
      final again = await api.posCatalog(since: 'c1', etag: '"e1"');
      expect(again.notModified, isTrue);
    });

    test('weigh tickets: create body without prices, by-code, use with invoiceId, resolve answers a ticket', () async {
      answer = (r) => r.url.path == '/v1/counter/resolve' ? json({'weighTicket': ticket(status: 'used')}) : json(ticket());
      final t = await api.createWeighTicket(
        const [WeighTicketLineInput(itemId: 'v-1', weightKg: 1.2840000001, tareKg: 0.05), WeighTicketLineInput(itemId: 'v-2', qty: 2)],
        idempotencyKey: 'dev:ticket-0001',
      );
      expect(jsonDecode(seen.last.body), {
        'lines': [
          {'itemId': 'v-1', 'weightKg': 1.284, 'tareKg': 0.05},
          {'itemId': 'v-2', 'qty': 2},
        ],
      });
      expect(seen.last.headers['idempotency-key'], 'dev:ticket-0001');
      expect(t.value.lines.single.qty, 1.234);
      expect(t.value.lines.single.tareKg, 0.05);
      await api.weighTicketByCode('W26102200017');
      expect(seen.last.url.path, '/v1/pos/weigh-tickets/by-code/W26102200017');
      await api.useWeighTicket('t-1', 'inv-1', idempotencyKey: 'dev:use-00001');
      expect(jsonDecode(seen.last.body), {'invoiceId': 'inv-1'});
      final hit = await api.counterResolve('W26102200017');
      expect(hit.variant, isNull);
      expect(hit.weighTicket!.status, 'used');
    });
  });
}
