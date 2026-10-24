import 'dart:convert';

import 'package:http/http.dart' as http;

/// The counter-billing part of the fake API: catalogue, counter resolve, customers, bills, payments, till.
///
/// It keeps answers by Idempotency-Key like packages/idempotency: a repeated key gets the stored answer with
/// `idempotent-replayed: true`. Failures can be injected per route:
/// - [failBefore]: the next request never reaches the server (network error, nothing done);
/// - [dropAfterCommit]: the server does the write, but the answer is lost on the way back (network error).
class FakeCounter {
  final variants = <Map<String, Object?>>[
    _variant('v-rice', 'Ponni Rice 5 kg', sku: 'RICE5', barcode: '8901000000011', price: 32000, gst: 5, inclusive: true),
    _variant('v-dal', 'Toor Dal 1 kg', sku: 'DAL1', barcode: '8901000000028', price: 14000, gst: 5, inclusive: true, unit: 'kg'),
    _variant('v-phone', 'Redmi 13C', sku: 'R13C', barcode: '8901000000035', price: 1199900, gst: 18, inclusive: true),
    _variant('v-soap', 'Soap (excl. GST)', sku: 'SOAP', barcode: '8901000000042', price: 4000, gst: 18, inclusive: false),
  ];

  /// Codes the counter resolver knows: scale labels and IMEIs.
  final resolve = <String, Map<String, Object?>>{
    '2100001012504': {'variantId': 'v-dal', 'qty': 1.25},
    '861234567890123': {'variantId': 'v-phone', 'serial': '861234567890123'},
  };

  Map<String, Object?>? till;
  final invoices = <String, Map<String, Object?>>{};
  final customers = <Map<String, Object?>>[
    {'id': 'c1', 'name': 'Murugan', 'phone': '+919876543210', 'outstanding': 0, 'creditLimit': null},
  ];
  final _stored = <String, String>{};
  final failBefore = <String>{};
  final dropAfterCommit = <String>{};
  int billsMade = 0;
  int paymentsMade = 0;
  int _seq = 41;

  static Map<String, Object?> _variant(String id, String title,
          {required String sku, required String barcode, required int price, required double gst, required bool inclusive, String unit = 'pcs'}) =>
      {
        'id': id,
        'productId': 'p-$id',
        'name': title,
        'sku': sku,
        'barcode': barcode,
        'hsn': '1006',
        'unit': unit,
        'rate': inclusive ? (price * 100 / (100 + gst)).round() : price,
        'price': price,
        'taxInclusive': inclusive,
        'gstRate': gst,
        'image': null,
        'createdAt': '2026-01-01T00:00:00.000Z',
        'productName': title,
        'title': title,
        'optionValues': <String, Object?>{},
        'mrp': null,
        'cost': null,
        'weightGrams': null,
        'position': 0,
        'isDefault': true,
        'status': 'active',
        'channels': ['pos'],
      };

  static http.Response _json(Object body, [int status = 200, Map<String, String> headers = const {}]) =>
      http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8', ...headers});
  static http.Response _error(int status, String code, String message) =>
      _json({'error': {'code': code, 'message': message}}, status);

  /// A route name for failure injection: `POST /v1/invoices`, `POST /v1/invoices/:id/payments`, ...
  static String routeName(String method, String path) =>
      '$method ${path.replaceAllMapped(RegExp(r'/(inv-[^/]+|till-[^/]+)'), (_) => '/:id')}';

  Future<http.Response?> handle(http.Request r, Map<String, dynamic> body) async {
    final name = routeName(r.method, r.url.path);
    final key = r.headers['idempotency-key'];
    final write = r.method != 'GET';
    if (failBefore.remove(name)) throw http.ClientException('Connection reset');
    if (write && key != null && _stored.containsKey('$name|$key')) {
      return http.Response(_stored['$name|$key']!, 200,
          headers: {'content-type': 'application/json; charset=utf-8', 'idempotent-replayed': 'true'});
    }
    final res = _route(r, name, body);
    if (res == null) return null;
    if (write && key != null && res.statusCode < 300) _stored['$name|$key'] = res.body;
    if (dropAfterCommit.remove(name)) throw http.ClientException('Connection lost after the write');
    return res;
  }

  http.Response? _route(http.Request r, String name, Map<String, dynamic> body) {
    final q = r.url.queryParameters;
    final seg = r.url.pathSegments; // v1, invoices, inv-1, payments
    switch (name) {
      case 'GET /v1/catalog/variants/search':
        final term = (q['q'] ?? '').toLowerCase();
        final items = variants.where((v) => (v['title'] as String).toLowerCase().contains(term)).toList();
        return _json({'items': items, 'total': items.length});
      case 'GET /v1/catalog/variants/lookup':
        final v = variants.where((v) => v['barcode'] == q['code'] || v['sku'] == q['code']).firstOrNull;
        return v == null ? _error(404, 'not_found', 'Item not found') : _json(v);
      case 'GET /v1/counter/resolve':
        final hit = resolve[q['code']];
        if (hit == null) return _error(404, 'not_found', 'Code not found');
        final v = variants.firstWhere((x) => x['id'] == hit['variantId']);
        return _json({'variant': v, if (hit['qty'] != null) 'qty': hit['qty'], if (hit['serial'] != null) 'serial': hit['serial']});
      case 'GET /v1/invoices/customers':
        final term = (q['q'] ?? '').toLowerCase();
        final items = customers.where((c) => '${c['name']} ${c['phone']}'.toLowerCase().contains(term)).map(_customer).toList();
        return _json({'items': items, 'total': items.length, 'limit': 6, 'offset': 0});
      case 'POST /v1/invoices/customers':
        final c = {'id': 'c${customers.length + 1}', 'name': body['name'], 'phone': body['phone'], 'outstanding': 0, 'creditLimit': null};
        customers.add(c);
        return _json(_customer(c));
      case 'GET /v1/invoices/till/current':
        return _json({'session': till});
      case 'POST /v1/invoices/till/open':
        till = _session(body['register'] as String, body['openingCash'] as int? ?? 0);
        return _json(till!);
      case 'POST /v1/invoices/till/:id/cash':
        (till!['cashEntries'] as List).add({
          'id': 'e${(till!['cashEntries'] as List).length}',
          'amount': body['amount'],
          'reason': body['reason'],
          'by': 'u1',
          'byName': body['actorName'],
          'at': '2026-10-21T05:00:00.000Z',
        });
        return _json(till!);
      case 'GET /v1/invoices/till/:id/x':
        return _json({'session': till, 'report': _report()});
      case 'POST /v1/invoices/till/:id/close':
        final report = _report();
        final expected = (report['cash'] as Map)['expected'] as int;
        till = {
          ...till!,
          'status': 'closed',
          'countedCash': body['countedCash'],
          'expectedCash': expected,
          'difference': (body['countedCash'] as int) - expected,
          'summary': report,
        };
        return _json({'session': till, 'report': report});
      case 'POST /v1/invoices':
        billsMade++;
        final inv = _invoice(body);
        invoices[inv['id'] as String] = inv;
        return _json(inv);
      case 'POST /v1/invoices/:id/payments':
        final inv = invoices[seg[2]];
        if (inv == null) return _error(404, 'not_found', 'Invoice not found');
        final amount = body['amount'] as int;
        if (amount > (inv['balance'] as int)) return _error(400, 'bad_request', 'Payment is more than the balance');
        paymentsMade++;
        (inv['payments'] as List).add({
          'id': 'pay$paymentsMade',
          'amount': amount,
          'method': body['method'],
          'date': body['date'],
          'reference': body['reference'],
          'source': 'manual',
          'creditNoteId': null,
          'createdAt': '2026-10-21T08:35:00.000Z',
        });
        inv['paid'] = (inv['paid'] as int) + amount;
        inv['balance'] = (inv['total'] as int) - (inv['paid'] as int);
        inv['status'] = inv['balance'] == 0 ? 'paid' : 'partially_paid';
        return _json(inv);
      case 'POST /v1/invoices/:id/cancel':
        final inv = invoices[seg[2]]!;
        inv['status'] = 'cancelled';
        return _json(inv);
      case 'POST /v1/invoices/:id/share':
        return _json({'token': 'tok-${seg[2]}', 'url': 'https://anna.srikit.test/b/tok-${seg[2]}'});
    }
    return null;
  }

  Map<String, Object?> _customer(Map<String, Object?> c) => {
        'id': c['id'],
        'name': c['name'],
        'phone': c['phone'],
        'email': null,
        'gstin': null,
        'address': null,
        'stateCode': '33',
        'openingBalance': 0,
        'creditLimit': c['creditLimit'],
        'outstanding': c['outstanding'],
        'advance': 0,
        'createdAt': '2026-01-01T00:00:00.000Z',
        'lastBillDate': null,
        'totalBilled': 0,
        'overdue': 0,
      };

  Map<String, Object?> _session(String register, int opening) => {
        'id': 'till-1',
        'branchId': null,
        'register': register,
        'status': 'open',
        'date': '2026-10-21',
        'openingCash': opening,
        'openingCount': null,
        'openedBy': 'u1',
        'openedByName': 'Anna',
        'openedAt': '2026-10-21T03:30:00.000Z',
        'cashEntries': <Object>[],
        'closingCount': null,
        'expectedCash': null,
        'countedCash': null,
        'difference': null,
        'note': null,
        'closedBy': null,
        'closedByName': null,
        'closedAt': null,
        'summary': null,
      };

  Map<String, Object?> _report() {
    final paid = invoices.values.where((i) => i['tillSessionId'] == till?['id'] && i['status'] != 'cancelled').toList();
    final cash = paid.expand((i) => i['payments'] as List).where((p) => (p as Map)['method'] == 'cash').fold<int>(0, (s, p) => s + ((p as Map)['amount'] as int));
    final entries = (till?['cashEntries'] as List? ?? const []).cast<Map>();
    final cashIn = entries.where((e) => (e['amount'] as int) > 0).fold<int>(0, (s, e) => s + (e['amount'] as int));
    final cashOut = entries.where((e) => (e['amount'] as int) < 0).fold<int>(0, (s, e) => s - (e['amount'] as int));
    final opening = till?['openingCash'] as int? ?? 0;
    return {
      'bills': {'count': paid.length, 'total': paid.fold<int>(0, (s, i) => s + (i['total'] as int)), 'cancelled': 0},
      'payments': [if (cash > 0) {'method': 'cash', 'amount': cash, 'count': paid.length}],
      'refunds': <Object>[],
      'creditNotes': {'count': 0, 'total': 0},
      'onCredit': 0,
      'collected': cash,
      'refunded': 0,
      'cash': {'opening': opening, 'sales': cash, 'refunds': 0, 'cashIn': cashIn, 'cashOut': cashOut, 'expected': opening + cash + cashIn - cashOut},
    };
  }

  /// A simplified server bill: per line GST from the exclusive amount (or out of `inclusiveTotal`), CGST/SGST split,
  /// total rounded to the rupee. Good enough to prove the app shows the server's numbers.
  Map<String, Object?> _invoice(Map<String, dynamic> input) {
    final lines = <Map<String, Object?>>[];
    var subtotal = 0, discount = 0, taxable = 0, cgst = 0, sgst = 0;
    final breakup = <double, List<int>>{};
    for (final l in (input['lines'] as List).cast<Map<String, dynamic>>()) {
      final qty = (l['qty'] as num).toDouble();
      final rate = l['rate'] as int;
      final g = (l['gstRate'] as num).toDouble();
      final amount = (qty * rate).round();
      final d = l['discount'] as int? ?? 0;
      final int tx;
      final int total;
      if (l['inclusiveTotal'] != null) {
        total = l['inclusiveTotal'] as int;
        tx = (total * 100 / (100 + g)).round();
      } else {
        tx = amount - d;
        total = tx + (tx * g / 100).round();
      }
      final tax = total - tx;
      final c = (tax / 2).ceil();
      subtotal += amount;
      discount += d;
      taxable += tx;
      cgst += c;
      sgst += tax - c;
      final b = breakup.putIfAbsent(g, () => [0, 0, 0]);
      b[0] += tx;
      b[1] += c;
      b[2] += tax - c;
      lines.add({...l, 'hsn': l['hsn'], 'unit': l['unit'], 'amount': amount, 'taxable': tx, 'cgst': c, 'sgst': tax - c, 'igst': 0, 'total': total});
    }
    final exact = taxable + cgst + sgst;
    final total = (exact / 100).round() * 100;
    final id = 'inv-${++_seq}';
    final customer = input['customer'] as Map<String, dynamic>?;
    final saved = customers.where((c) => c['id'] == input['customerId']).firstOrNull;
    return {
      'id': id,
      'number': 'INV-${_seq.toString().padLeft(4, '0')}',
      'branchId': null,
      'status': 'issued',
      'date': input['date'],
      'dueDate': null,
      'customerName': saved?['name'] ?? customer?['name'] ?? '',
      'total': total,
      'paid': 0,
      'credited': 0,
      'balance': total,
      'isOverdue': false,
      'customerId': input['customerId'],
      'customer': {'name': saved?['name'] ?? customer?['name'] ?? '', 'phone': saved?['phone'] ?? customer?['phone'], 'email': null, 'gstin': null, 'address': null, 'stateCode': null},
      'seller': {
        'legalName': 'Anna Stores',
        'gstin': '33ABCDE1234F1Z5',
        'address': '12 Car Street',
        'city': 'Chennai',
        'pincode': '600004',
        'stateCode': '33',
        'phone': '+919876500000',
        'email': null,
        'invoicePrefix': 'INV-',
        'terms': null,
        'bankName': null,
        'accountNumber': null,
        'ifsc': null,
        'upiId': 'anna@upi',
        'autoReminders': false,
        'reminderDays': <int>[],
        'sendPaymentReceipts': false,
      },
      'placeOfSupply': '33',
      'interState': false,
      'lines': lines,
      'totals': {
        'subtotal': subtotal,
        'discount': discount,
        'taxable': taxable,
        'cgst': cgst,
        'sgst': sgst,
        'igst': 0,
        'roundOff': total - exact,
        'total': total,
        'taxBreakup': [for (final e in breakup.entries) {'gstRate': e.key, 'taxable': e.value[0], 'cgst': e.value[1], 'sgst': e.value[2], 'igst': 0}],
      },
      'amountInWords': 'Rupees only',
      'notes': null,
      'payments': <Object>[],
      'shareToken': null,
      'cancelledAt': null,
      'cancelReason': null,
      'warnings': <String>[],
      'messages': <Object>[],
      'creditNotes': <Object>[],
      'tillSessionId': input['tillSessionId'],
      'createdAt': '2026-10-21T08:35:00.000Z',
      'updatedAt': '2026-10-21T08:35:00.000Z',
    };
  }
}
