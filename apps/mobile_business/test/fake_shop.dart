import 'dart:convert';

import 'package:http/http.dart' as http;

/// Products, stock and orders for the fake API, with the server's rules where the app depends on them: order
/// transitions (409 invalid_transition), COD collected on delivery, payments refused once paid, stock adjust modes,
/// and Idempotency-Key replays.
class FakeShop {
  final categories = <Map<String, Object?>>[
    {'id': 'cat-grocery', 'name': 'Grocery'},
    {'id': 'cat-mobiles', 'name': 'Mobiles'},
  ];

  final products = <String, Map<String, Object?>>{
    'p-rice': _product('p-rice', 'Ponni Rice 5 kg', 'cat-grocery', variantId: 'v-rice', price: 32000, mrp: 35000, barcode: '8901000000011', sku: 'RICE5'),
    'p-dal': _product('p-dal', 'Toor Dal', 'cat-grocery', variantId: 'v-dal', price: 14000, unit: 'kg', sku: 'DAL1'),
  };

  final stock = <String, Map<String, Object?>>{
    'v-rice': _stock('v-rice', 'Ponni Rice 5 kg', 'pcs', 12, reorder: 5),
    'v-dal': _stock('v-dal', 'Toor Dal', 'kg', 2.5, reorder: 5),
  };
  final movements = <String, List<Map<String, Object?>>>{};

  final locations = <Map<String, Object?>>[
    {'id': 'loc-main', 'name': 'Main', 'code': 'MAIN', 'type': 'store', 'address': null, 'isDefault': true, 'active': true},
  ];

  final orders = <String, Map<String, Object?>>{};
  int newOrderCount = 1;
  int summaryCalls = 0;
  final _stored = <String, String>{};

  FakeShop() {
    orders['ord-1'] = _order('ord-1', 'ORD/26-27/0001', cod: true);
  }

  static Map<String, Object?> _product(String id, String name, String cat,
          {required String variantId, required int price, int? mrp, String? barcode, String? sku, String unit = 'pcs'}) =>
      {
        'id': id,
        'name': name,
        'slug': id,
        'description': null,
        'brand': null,
        'categoryId': cat,
        'hsn': '1006',
        'gstRate': 5,
        'unit': unit,
        'taxInclusive': true,
        'status': 'active',
        'channels': ['store', 'billing'],
        'tags': <String>[],
        'attributes': <String, Object?>{},
        'options': <Object>[],
        'images': <Object>[],
        'seo': null,
        'vendorId': null,
        'variants': [
          {
            'id': variantId,
            'productId': id,
            'sku': sku,
            'barcode': barcode,
            'title': '',
            'optionValues': <String, Object?>{},
            'price': price,
            'mrp': mrp,
            'cost': null,
            'weightGrams': null,
            'position': 0,
            'isDefault': true,
          },
        ],
        'createdAt': '2026-01-01T00:00:00.000Z',
        'updatedAt': '2026-01-01T00:00:00.000Z',
      };

  static Map<String, Object?> _stock(String id, String name, String unit, num qty, {num reorder = 0}) => {
        'itemId': id,
        'name': name,
        'unit': unit,
        'hsn': '1006',
        'qty': qty,
        'reorderLevel': reorder,
        'track': true,
        'avgCost': 10000,
        'value': (qty * 10000).round(),
        'status': _status(qty, reorder),
        'updatedAt': '2026-10-21T05:00:00.000Z',
        'reserved': 0,
        'available': qty,
        'locationId': null,
        'categoryId': 'cat-grocery',
        'categoryName': 'Grocery',
      };

  static String _status(num qty, num reorder) => qty <= 0 ? 'out' : (reorder > 0 && qty <= reorder ? 'low' : 'ok');

  Map<String, Object?> _row(Map<String, Object?> p) {
    final v = (p['variants'] as List).cast<Map<String, Object?>>();
    final prices = v.map((x) => x['price'] as int).toList()..sort();
    final s = stock[v.first['id']];
    return {
      'id': p['id'],
      'name': p['name'],
      'slug': p['slug'],
      'status': p['status'],
      'categoryId': p['categoryId'],
      'categoryName': categories.where((c) => c['id'] == p['categoryId']).firstOrNull?['name'],
      'image': null,
      'priceMin': prices.first,
      'priceMax': prices.last,
      'variantCount': v.length,
      'channels': p['channels'],
      'vendorId': null,
      'updatedAt': p['updatedAt'],
      'stock': s == null ? null : {'qty': s['qty'], 'status': s['status']},
    };
  }

  // ---------------------------------------------------------------- orders

  static const _flow = ['placed', 'confirmed', 'packed', 'shipped', 'delivered'];

  static List<String> _next(String status) => [
        if (_flow.contains(status)) ..._flow.sublist(_flow.indexOf(status) + 1),
        if (const ['placed', 'confirmed', 'packed'].contains(status)) 'cancelled',
      ];

  Map<String, Object?> _order(String id, String number, {bool cod = false}) => {
        'id': id,
        'number': number,
        'channel': 'store',
        'status': 'placed',
        'paymentStatus': cod ? 'cod' : 'unpaid',
        'paymentMethod': cod ? 'cod' : 'cash',
        'customer': {'name': 'Lakshmi', 'phone': '+919876543210', 'email': null},
        'shippingAddress': {
          'name': 'Lakshmi',
          'phone': '+919876543210',
          'line1': '4 Temple Street',
          'line2': null,
          'landmark': 'Near the tank',
          'city': 'Madurai',
          'district': null,
          'stateCode': '33',
          'pincode': '625001',
          'country': 'IN',
        },
        'billingAddress': null,
        'lines': [
          {
            'variantId': 'v-rice',
            'productId': 'p-rice',
            'name': 'Ponni Rice 5 kg',
            'sku': 'RICE5',
            'image': null,
            'qty': 2,
            'unit': 'pcs',
            'price': 32000,
            'rate': 30476,
            'gstRate': 5,
            'hsn': '1006',
            'taxInclusive': true,
            'discount': 0,
            'amount': 60952,
            'taxable': 60952,
            'cgst': 1524,
            'sgst': 1524,
            'igst': 0,
            'total': 64000,
          },
        ],
        'totals': {
          'subtotal': 60952,
          'discount': 0,
          'shipping': 4000,
          'shippingWaived': 0,
          'shippingLine': null,
          'taxable': 60952,
          'cgst': 1524,
          'sgst': 1524,
          'igst': 0,
          'roundOff': 0,
          'total': 68000,
          'taxBreakup': <Object>[],
          'sellerState': '33',
          'placeOfSupply': '33',
          'interState': false,
        },
        'total': 68000,
        'paid': 0,
        'refunded': 0,
        'balance': 68000,
        'currency': 'INR',
        'fulfillment': <String, Object?>{},
        'stockState': 'reserved',
        'couponCode': null,
        'invoiceId': null,
        'invoiceNumber': null,
        'locationId': null,
        'branchId': null,
        'notes': null,
        'customerNote': 'Ring the bell',
        'cancelReason': null,
        'accessToken': 'tok',
        'placedAt': '2026-10-21T04:30:00.000Z',
        'confirmedAt': null,
        'shippedAt': null,
        'deliveredAt': null,
        'cancelledAt': null,
        'createdAt': '2026-10-21T04:30:00.000Z',
        'updatedAt': '2026-10-21T04:30:00.000Z',
        'events': <Object>[
          {'id': 'e0', 'type': 'status', 'fromStatus': null, 'toStatus': 'placed', 'message': null, 'actorUserId': null, 'data': <String, Object?>{}, 'createdAt': '2026-10-21T04:30:00.000Z'},
        ],
        'nextStatuses': _next('placed'),
      };

  void _event(Map<String, Object?> o, Map<String, Object?> e) =>
      (o['events'] as List).add({'id': 'e${(o['events'] as List).length}', 'actorUserId': 'u1', 'createdAt': '2026-10-21T06:00:00.000Z', 'data': <String, Object?>{}, ...e});

  void _pay(Map<String, Object?> o, int amount, String method, String source) {
    o['paid'] = (o['paid'] as int) + amount;
    o['balance'] = (o['total'] as int) - (o['paid'] as int);
    if (o['balance'] == 0) o['paymentStatus'] = 'paid';
    _event(o, {'type': 'payment', 'message': null, 'data': {'amount': amount, 'method': method, 'reference': null, 'date': '2026-10-21', 'source': source}});
  }

  // ---------------------------------------------------------------- http

  static http.Response _json(Object body, [int status = 200]) =>
      http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});
  static http.Response _error(int status, String code, String message) =>
      _json({'error': {'code': code, 'message': message}}, status);

  Future<http.Response?> handle(http.Request r, Map<String, dynamic> body) async {
    final key = r.headers['idempotency-key'];
    final id = '${r.method} ${r.url.path}|$key';
    if (r.method != 'GET' && key != null && _stored.containsKey(id)) {
      return http.Response(_stored[id]!, 200, headers: {'content-type': 'application/json; charset=utf-8', 'idempotent-replayed': 'true'});
    }
    final res = _route(r, body);
    if (res != null && r.method != 'GET' && key != null && res.statusCode < 300) _stored[id] = res.body;
    return res;
  }

  http.Response? _route(http.Request r, Map<String, dynamic> body) {
    final seg = r.url.pathSegments; // v1, catalog, products, p-rice
    final q = r.url.queryParameters;
    final path = '/${seg.join('/')}';
    final m = r.method;

    if (m == 'GET' && path == '/v1/catalog/categories') {
      return _json({'items': [for (final c in categories) {...c, 'parentId': null, 'slug': c['id'], 'description': null, 'imageUrl': null, 'sort': 0, 'active': true, 'seo': null, 'productCount': 1, 'createdAt': '2026-01-01T00:00:00.000Z', 'updatedAt': '2026-01-01T00:00:00.000Z'}], 'total': categories.length});
    }
    if (m == 'GET' && path == '/v1/catalog/products') {
      final term = (q['q'] ?? '').toLowerCase();
      final statuses = (q['status'] ?? 'active,draft').split(',');
      final rows = products.values
          .where((p) => (p['name'] as String).toLowerCase().contains(term))
          .where((p) => statuses.contains(p['status']))
          .where((p) => q['categoryId'] == null || p['categoryId'] == q['categoryId'])
          .map(_row)
          .toList();
      return _json({'items': rows, 'total': rows.length, 'limit': 30, 'offset': 0, 'facets': <String, Object?>{}});
    }
    if (m == 'POST' && path == '/v1/catalog/products') {
      final pid = 'p-new${products.length}';
      final v = (body['variants'] as List).first as Map<String, dynamic>;
      final p = _product(pid, body['name'] as String, body['categoryId'] as String? ?? 'cat-grocery',
          variantId: 'v-new${products.length}', price: v['price'] as int, mrp: v['mrp'] as int?, barcode: v['barcode'] as String?, sku: v['sku'] as String?, unit: body['unit'] as String? ?? 'pcs');
      p['taxInclusive'] = body['taxInclusive'];
      p['gstRate'] = body['gstRate'];
      products[pid] = p;
      return _json(p);
    }
    if (seg.length == 4 && seg[1] == 'catalog' && seg[2] == 'products') {
      final p = products[seg[3]];
      if (p == null) return _error(404, 'not_found', 'Product not found');
      if (m == 'GET') return _json(p);
      if (m == 'PATCH') {
        p.addAll(body);
        return _json(p);
      }
    }
    if (m == 'PATCH' && seg.length == 4 && seg[1] == 'catalog' && seg[2] == 'variants') {
      for (final p in products.values) {
        for (final v in (p['variants'] as List).cast<Map<String, Object?>>()) {
          if (v['id'] != seg[3]) continue;
          final barcode = body['barcode'];
          if (barcode != null && products.values.any((o) => (o['variants'] as List).any((x) => x['id'] != v['id'] && x['barcode'] == barcode))) {
            return _error(409, 'conflict', 'This barcode is already used by another variant');
          }
          v.addAll(body);
          return _json(v);
        }
      }
      return _error(404, 'not_found', 'Variant not found');
    }

    if (m == 'GET' && path == '/v1/inventory/locations') return _json({'items': locations, 'total': locations.length});
    if (m == 'GET' && path == '/v1/inventory/stock') {
      final want = q['status']?.split(',');
      final term = (q['q'] ?? '').toLowerCase();
      final rows = stock.values.where((s) => want == null || want.contains(s['status'])).where((s) => (s['name'] as String).toLowerCase().contains(term)).toList();
      return _json({
        'items': rows,
        'total': rows.length,
        'limit': 50,
        'offset': 0,
        'totals': {'stockValue': stock.values.fold<int>(0, (a, s) => a + (s['value'] as int)), 'lowCount': stock.values.where((s) => s['status'] == 'low').length, 'outCount': stock.values.where((s) => s['status'] == 'out').length},
        'facets': <String, Object?>{},
        'categories': [for (final c in categories) {'id': c['id'], 'name': c['name']}],
      });
    }
    if (seg.length >= 4 && seg[1] == 'inventory' && seg[2] == 'stock') {
      final s = stock[seg[3]];
      if (s == null) return _error(404, 'not_found', 'Not tracked');
      if (m == 'GET' && seg.length == 4) return _json(s);
      if (m == 'GET' && seg.length == 5 && seg[4] == 'movements') {
        final list = movements[seg[3]] ?? const [];
        return _json({'items': list.reversed.toList(), 'total': list.length});
      }
      if (m == 'POST' && seg.length == 5 && seg[4] == 'adjust') {
        final mode = body['mode'] as String;
        final qty = (body['qty'] as num).toDouble();
        if (qty < 0 || (qty == 0 && mode != 'set')) return _error(400, 'invalid_input', 'Quantity must be more than 0');
        final before = (s['qty'] as num).toDouble();
        final after = switch (mode) { 'add' => before + qty, 'remove' => before - qty, _ => qty };
        s['qty'] = after;
        s['available'] = after;
        s['status'] = _status(after, s['reorderLevel'] as num);
        (movements[seg[3]] ??= []).add({
          'id': 'm${movements[seg[3]]!.length}',
          'date': '2026-10-21T06:00:00.000Z',
          'reason': 'adjustment',
          'delta': after - before,
          'qtyAfter': after,
          'refType': null,
          'refId': null,
          'refNumber': null,
          'note': body['note'],
          'createdBy': 'u1',
          'locationId': body['locationId'],
        });
        return _json(s);
      }
    }

    if (m == 'GET' && path == '/v1/orders/summary') {
      summaryCalls++;
      return _json({
        'today': {'count': orders.length, 'total': 68000},
        'pending': {'placed': newOrderCount, 'confirmed': 0, 'packed': 0},
        'month': {'count': orders.length, 'total': 68000},
      });
    }
    if (m == 'GET' && path == '/v1/orders') {
      final want = q['status']?.split(',');
      final rows = orders.values.where((o) => want == null || want.contains(o['status'])).map((o) => {
            for (final k in ['id', 'number', 'channel', 'status', 'paymentStatus', 'paymentMethod', 'total', 'paid', 'branchId', 'placedAt']) k: o[k],
            'customerName': (o['customer'] as Map)['name'],
            'customerPhone': (o['customer'] as Map)['phone'],
            'itemCount': (o['lines'] as List).length,
          }).toList();
      final counts = {for (final s in const ['placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned']) s: orders.values.where((o) => o['status'] == s).length};
      return _json({'items': rows, 'total': rows.length, 'limit': 30, 'offset': 0, 'counts': counts, 'facets': {'status': counts}});
    }
    if (seg.length >= 3 && seg[1] == 'orders') {
      final o = orders[seg[2]];
      if (o == null) return _error(404, 'not_found', 'Order not found');
      if (m == 'GET' && seg.length == 3) return _json(o);
      final action = seg.length == 4 ? seg[3] : '';
      switch (action) {
        case 'status':
          final to = body['status'] as String;
          final from = o['status'] as String;
          if (!_next(from).contains(to)) {
            return _json({'error': {'code': 'invalid_transition', 'message': "Can't move from $from to $to", 'details': {'from': from, 'to': to, 'allowed': _next(from)}}}, 409);
          }
          o['status'] = to;
          if (to == 'cancelled') o['cancelReason'] = body['note'];
          if (body['fulfillment'] != null) o['fulfillment'] = body['fulfillment'];
          _event(o, {'type': 'status', 'fromStatus': from, 'toStatus': to, 'message': body['note']});
          if (to == 'delivered' && o['paymentMethod'] == 'cod' && (o['balance'] as int) > 0) {
            _pay(o, o['balance'] as int, 'cod', 'cod'); // COD collected on delivery
          }
          if (to == 'delivered') {
            o['invoiceId'] = 'inv-1';
            o['invoiceNumber'] = 'INV-0042';
          }
          o['nextStatuses'] = _next(to);
          return _json(o);
        case 'payments':
          if ((o['balance'] as int) <= 0) return _error(400, 'bad_request', 'This order is already paid');
          _pay(o, body['amount'] as int, body['method'] as String, 'manual');
          return _json(o);
        case 'invoice':
          o['invoiceId'] ??= 'inv-1';
          o['invoiceNumber'] ??= 'INV-0042';
          return _json(o);
      }
    }
    return null;
  }
}
