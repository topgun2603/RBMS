import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:test/test.dart';

http.Response json(Object body, [int status = 200, Map<String, String> headers = const {}]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8', ...headers});

void main() {
  test('InvoiceInput: walk-in or saved customer, issue, till, lines', () {
    const line = InvoiceLineInput(description: 'Rice', qty: 2, rate: 30476, gstRate: 5, itemId: 'v1', inclusiveTotal: 64000, unit: 'kg');
    expect(const InvoiceInput(date: '2026-10-21', lines: [line], walkInName: 'Kumar', walkInPhone: '+919876543210', tillSessionId: 't1').toJson(), {
      'date': '2026-10-21',
      'lines': [
        {'description': 'Rice', 'qty': 2, 'rate': 30476, 'gstRate': 5, 'unit': 'kg', 'itemId': 'v1', 'inclusiveTotal': 64000},
      ],
      'issue': true,
      'customer': {'name': 'Kumar', 'phone': '+919876543210'},
      'tillSessionId': 't1',
    });
    final saved = const InvoiceInput(date: '2026-10-21', lines: [line], customerId: 'c1', walkInName: 'ignored').toJson();
    expect(saved['customerId'], 'c1');
    expect(saved.containsKey('customer'), isFalse);
    expect(const InvoiceLineInput(description: 'Dal', qty: 1.25, rate: 100, gstRate: 0.25).toJson()['qty'], 1.25);
  });

  test('writes report replays; paths and keys', () async {
    final seen = <http.Request>[];
    final api = SrikitApi(ApiClient(
      baseUrl: 'http://api.test',
      client: const ClientInfo(app: 'business', version: '0.1.0'),
      httpClient: MockClient((r) async {
        seen.add(r);
        if (r.url.path.endsWith('/share')) return json({'token': 't', 'url': 'https://x/b/t'}, 200, {'idempotent-replayed': 'true'});
        if (r.url.path.endsWith('/x')) {
          return json({
            'session': {'id': 'till-1', 'register': 'Counter 1', 'status': 'open', 'date': '2026-10-21', 'openingCash': 50000, 'cashEntries': []},
            'report': {
              'bills': {'count': 3, 'total': 120000, 'cancelled': 0},
              'payments': [
                {'method': 'cash', 'amount': 70000, 'count': 2},
                {'method': 'upi', 'amount': 50000, 'count': 1},
              ],
              'refunds': [],
              'creditNotes': {'count': 0, 'total': 0},
              'onCredit': 0,
              'collected': 120000,
              'refunded': 0,
              'cash': {'opening': 50000, 'sales': 70000, 'refunds': 0, 'cashIn': 0, 'cashOut': 10000, 'expected': 110000},
            },
          });
        }
        return json({'session': null});
      }),
    ));
    final share = await api.shareInvoice('inv/1', idempotencyKey: 'dev:abcdefgh');
    expect(share.replayed, isTrue);
    expect(share.value.url, 'https://x/b/t');
    expect(seen.last.url.path, '/v1/invoices/inv%2F1/share');
    expect(seen.last.headers['idempotency-key'], 'dev:abcdefgh');

    expect((await api.tillCurrent('Counter 1')).session, isNull);
    expect(seen.last.url.queryParameters['register'], 'Counter 1');

    final x = await api.tillX('till-1');
    expect(x.session.isOpen, isTrue);
    expect(x.report.payments.map((p) => p.method), ['cash', 'upi']);
    expect(x.report.cashExpected, 110000);
  });

  test('counter resolve and variants', () {
    final r = CounterResolve.fromJson({
      'variant': {'id': 'v', 'productId': 'p', 'name': '1 kg', 'title': 'Toor Dal 1 kg', 'unit': 'kg', 'rate': 13333, 'price': 14000, 'taxInclusive': true, 'gstRate': 5, 'mrp': null},
      'qty': 1.25,
    });
    expect(r.qty, 1.25);
    expect(r.serial, isNull);
    expect(r.variant!.title, 'Toor Dal 1 kg');
    expect(r.variant!.mrp, isNull);
    expect(CounterResolve.fromJson({'variant': {'id': 'v'}, 'serial': 'IMEI1'}).serial, 'IMEI1');
  });

  test('Invoice keeps the server totals', () {
    final inv = Invoice.fromJson({
      'id': 'i1',
      'number': 'INV-0042',
      'status': 'issued',
      'date': '2026-10-21',
      'customerName': 'Walk-in Customer',
      'total': 64000,
      'paid': 0,
      'credited': 0,
      'balance': 64000,
      'customer': {'name': 'Walk-in Customer', 'phone': null},
      'seller': {'legalName': 'Anna Stores', 'gstin': '33ABCDE1234F1Z5', 'reminderDays': [3, 7]},
      'lines': [
        {'description': 'Rice', 'qty': 2, 'rate': 30476, 'gstRate': 5, 'amount': 60952, 'taxable': 60952, 'cgst': 1524, 'sgst': 1524, 'igst': 0, 'total': 64000},
      ],
      'totals': {
        'subtotal': 60952,
        'discount': 0,
        'taxable': 60952,
        'cgst': 1524,
        'sgst': 1524,
        'igst': 0,
        'roundOff': 0,
        'total': 64000,
        'taxBreakup': [
          {'gstRate': 5, 'taxable': 60952, 'cgst': 1524, 'sgst': 1524, 'igst': 0},
        ],
        'loyalty': {'points': 10, 'discount': 1000},
      },
      'payments': [],
      'warnings': ['credit_limit_exceeded'],
      'createdAt': '2026-10-21T08:35:00.000Z',
    });
    expect(inv.number, 'INV-0042');
    expect(inv.totals.total, 64000);
    expect(inv.totals.taxBreakup.single.cgst, 1524);
    expect(inv.totals.loyaltyDiscount, 1000);
    expect(inv.lines.single.qty, 2);
    expect(inv.seller.reminderDays, [3, 7]);
    expect(inv.warnings, ['credit_limit_exceeded']);
  });

  test('Branding reads css; Page fields are optional', () {
    expect(Branding.fromJson({'tokens': {}, 'css': ':root{}'}).css, ':root{}');
    final p = Page.fromJson({'items': []}, (j) => j);
    expect(p.total, isNull);
    expect(p.limit, isNull);
    expect(Page.fromJson({'items': [], 'total': 3, 'limit': 6, 'offset': 0, 'facets': {'balance': {}}}, (j) => j).facets, isNotNull);
  });
}
