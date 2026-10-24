import 'dart:convert';

import 'package:http/http.dart' as http;

/// The `/v1/pos` part of the fake API, following docs/pos-terminals.md: pairing codes, device tokens
/// (`x-device-token`), PIN sessions (valid only with their terminal's device token), PIN lockout, the catalogue
/// (paging, `since` deltas, `removed`, `full`, ETag / 304) and weigh tickets (server-priced, used once).
///
/// Writes with an Idempotency-Key are stored and replayed (`idempotent-replayed: true`). [dropAfterCommit] makes a
/// route do its write and then lose the answer (a network error), once per entry.
class FakePos {
  FakePos();

  static const shop = {'id': 'shop-1', 'slug': 'anna-stores', 'name': 'Anna Stores', 'appId': 'shop'};

  final terminals = <String, Map<String, Object?>>{
    'term-pos': _terminal('term-pos', 'Counter 1', 'pos'),
    'term-w': _terminal('term-w', 'Weighing 1', 'weighing'),
  };

  /// Pairing code (no dash) → terminal id.
  final codes = <String, String>{'ABCD2345': 'term-pos', 'WXYZ6789': 'term-w'};

  /// Device token → terminal id.
  final devices = <String, String>{};

  /// PIN → member.
  final pins = <String, Map<String, Object?>>{
    '8023': {'id': 'u1', 'name': 'Anna', 'roles': ['owner'], 'permissions': ['*']},
    '4682': {'id': 'u2', 'name': null, 'roles': ['staff'], 'permissions': ['invoices.view']},
  };

  /// PIN session token → (terminal id, member).
  final sessions = <String, (String, Map<String, Object?>)>{};
  final failures = <String, int>{};
  List<String> features = const ['invoices', 'catalogue', 'pos.terminals', 'pos.weighing', 'scales'];

  final items = <Map<String, Object?>>[
    item('i-tomato', 'Tomato', price: 4000, unit: 'kg', soldBy: 'weight', plu: '42', barcodes: const [], category: 'cat-veg'),
    item('i-onion', 'Onion', price: 3000, unit: 'kg', soldBy: 'weight', plu: '43', barcodes: const [], category: 'cat-veg'),
    item('i-rice', 'Ponni Rice 5 kg', price: 32000, sku: 'RICE5', barcodes: const ['8901000000011'], category: 'cat-grain', gst: 5),
    item('i-soap', 'Soap', price: 4000, sku: 'SOAP', barcodes: const ['8901000000042', '8901000000059'], category: null, gst: 18),
    item('i-coconut', 'Coconut', price: 3500, barcodes: const [], category: 'cat-veg'),
  ];
  final categories = [
    {'id': 'cat-veg', 'name': 'Vegetables', 'parentId': null, 'position': 0},
    {'id': 'cat-grain', 'name': 'Grains', 'parentId': null, 'position': 1},
  ];
  final removedIds = <String>[];

  /// Bumped on every catalogue change; the cursor is `c<rev>`.
  int rev = 1;
  int pageLimit = 1000;

  final tickets = <String, Map<String, Object?>>{};
  int _ticketSeq = 16;
  int ticketsIssued = 0;
  int useCommits = 0;
  final _stored = <String, String>{};
  final dropAfterCommit = <String>{};
  final requests = <http.Request>[];

  static Map<String, Object?> _terminal(String id, String name, String role) => {
        'id': id,
        'name': name,
        'role': role,
        'branchId': null,
        'locationId': null,
        'settings': {'printerWidth': 58, 'autoPrint': false, 'lockAfterMinutes': 5},
        'paired': false,
        'device': null,
        'pairedAt': null,
        'lastSeenAt': null,
        'pairingPending': true,
        'createdAt': '2026-10-22T03:00:00.000Z',
      };

  static Map<String, Object?> item(String id, String name,
          {required int price,
          String unit = 'pcs',
          String soldBy = 'unit',
          String? plu,
          String? sku,
          List<String> barcodes = const [],
          String? category,
          double gst = 0,
          bool active = true}) =>
      {
        'itemId': id,
        'productId': 'p-$id',
        'name': name,
        'variantTitle': '',
        'sku': sku,
        'barcodes': barcodes,
        'categoryId': category,
        'price': price,
        'mrp': null,
        'taxInclusive': true,
        'gstRate': gst,
        'hsn': null,
        'unit': unit,
        'soldBy': soldBy,
        'plu': plu,
        'image': null,
        'stock': null,
        'active': active,
        'updatedAt': '2026-10-22T04:00:00.000Z',
        '_rev': 1,
      };

  /// Changes an item (or adds one) in a later catalogue revision.
  void touch(Map<String, Object?> it) {
    rev++;
    it['_rev'] = rev;
    final i = items.indexWhere((x) => x['itemId'] == it['itemId']);
    if (i < 0) {
      items.add(it);
    } else {
      items[i] = it;
    }
  }

  void remove(String id) {
    rev++;
    items.removeWhere((x) => x['itemId'] == id);
    removedIds.add('$id@$rev');
  }

  static http.Response _json(Object? body, [int status = 200, Map<String, String> headers = const {}]) =>
      http.Response(body == null ? '' : jsonEncode(body), status,
          headers: {if (body != null) 'content-type': 'application/json; charset=utf-8', ...headers});
  static http.Response _error(int status, String code, String message, [Object? details]) =>
      _json({'error': {'code': code, 'message': message, if (details != null) 'details': details}}, status);

  String? terminalOf(http.Request r) => devices[r.headers['x-device-token']];

  /// A PIN session sent together with its terminal's device token.
  (String, Map<String, Object?>)? pinSession(http.Request r) {
    final auth = r.headers['authorization'];
    if (auth == null || !auth.startsWith('Bearer ')) return null;
    final s = sessions[auth.substring(7)];
    if (s == null || s.$1 != terminalOf(r)) return null;
    return s;
  }

  static String routeName(String method, String path) => '$method ${path.replaceAllMapped(RegExp(r'/weigh-tickets/(t-[^/]+)'), (_) => '/weigh-tickets/:id')}';

  Future<http.Response?> handle(http.Request r, Map<String, dynamic> body) async {
    if (!r.url.path.startsWith('/v1/pos/')) return null;
    requests.add(r);
    final name = routeName(r.method, r.url.path);
    final key = r.headers['idempotency-key'];
    final write = r.method != 'GET';
    if (write && key != null && _stored.containsKey('$name|$key')) {
      return http.Response(_stored['$name|$key']!, 200,
          headers: {'content-type': 'application/json; charset=utf-8', 'idempotent-replayed': 'true'});
    }
    final res = _route(r, name, body);
    if (write && key != null && res.statusCode < 300) _stored['$name|$key'] = res.body;
    if (dropAfterCommit.remove(name)) throw http.ClientException('Connection lost after the write');
    return res;
  }

  http.Response _route(http.Request r, String name, Map<String, dynamic> body) {
    if (name == 'POST /v1/pos/pair') {
      final code = (body['code'] as String? ?? '').toUpperCase().replaceAll('-', '');
      final id = codes.remove(code);
      if (id == null) return _error(400, 'pairing_code_invalid', 'This pairing code is wrong or has expired');
      devices.removeWhere((_, t) => t == id); // a new device replaces the old one
      final token = 'dev-$id-${devices.length + 1}';
      devices[token] = id;
      terminals[id] = {...terminals[id]!, 'paired': true, 'device': body['device'], 'pairingPending': false};
      return _json({'deviceToken': token, 'terminal': terminals[id], 'shop': shop});
    }
    final tid = terminalOf(r);
    final pin = pinSession(r);
    switch (name) {
      case 'GET /v1/pos/device':
        if (tid == null) return _error(401, 'device_not_paired', 'Pair this device again');
        return _json({'terminal': terminals[tid], 'shop': shop, 'features': features});
      case 'POST /v1/pos/device/unpair':
        if (tid == null) return _error(401, 'device_not_paired', 'Pair this device again');
        devices.removeWhere((_, t) => t == tid);
        return _json({'ok': true});
      case 'GET /v1/pos/staff':
        if (tid == null) return _error(401, 'device_not_paired', 'Pair this device again');
        return _json({
          'items': [
            {'userId': 'u1', 'name': 'Anna', 'hasPin': true},
            {'userId': 'u2', 'name': null, 'hasPin': true},
            {'userId': 'u3', 'name': 'Ravi', 'hasPin': false},
          ],
        });
      case 'POST /v1/pos/session':
        if (tid == null) return _error(401, 'device_not_paired', 'Pair this device again');
        final n = failures[tid] ?? 0;
        if (n >= 5) return _error(429, 'pin_locked', 'Too many wrong PINs', {'retryAfterSeconds': 300});
        final who = pins[body['pin']];
        if (who == null) {
          failures[tid] = n + 1;
          if (n + 1 >= 5) return _error(429, 'pin_locked', 'Too many wrong PINs', {'retryAfterSeconds': 300});
          return _error(401, 'pin_invalid', 'Wrong PIN', {'remaining': 5 - (n + 1)});
        }
        failures[tid] = 0;
        final perms = (who['permissions'] as List).cast<String>();
        final weighing = terminals[tid]!['role'] == 'weighing';
        final allowed = perms.contains('*') || perms.contains(weighing ? 'pos.weigh' : 'invoices.create');
        if (!allowed) return _error(403, 'pin_not_allowed', 'You cannot use this terminal');
        final token = 'pin-$tid-${sessions.length + 1}';
        sessions[token] = (tid, who);
        return _json({
          'token': token,
          'expiresAt': DateTime.now().toUtc().add(const Duration(hours: 12)).toIso8601String(),
          'user': {'id': who['id'], 'name': who['name']},
          'permissions': perms,
          'tenantRoles': who['roles'],
        });
      case 'POST /v1/pos/session/lock':
        if (pin == null) return _error(400, 'not_a_pin_session', 'Not a PIN session');
        sessions.remove(r.headers['authorization']!.substring(7));
        return _json({'ok': true});
    }
    if (tid == null) return _error(401, 'device_not_paired', 'Pair this device again');
    if (pin == null) return _error(401, 'unauthorized', 'Sign in required');
    switch (name) {
      case 'GET /v1/pos/catalog':
        return _catalog(r);
      case 'GET /v1/pos/catalog/categories':
        return _json({'items': categories});
      case 'POST /v1/pos/weigh-tickets':
        if (terminals[tid]!['role'] != 'weighing') return _error(403, 'weighing_terminal_required', 'Use a weighing terminal');
        return _createTicket(tid, body);
      case 'GET /v1/pos/weigh-tickets':
        final mine = tickets.values.where((t) => t['terminalId'] == tid).toList().reversed.toList();
        return _json({'items': mine, 'total': mine.length});
    }
    final seg = r.url.pathSegments; // v1 pos weigh-tickets <id|by-code> [<code>|use|cancel]
    if (r.method == 'GET' && seg.length == 5 && seg[3] == 'by-code') {
      final t = tickets.values.where((t) => t['code'] == seg[4].toUpperCase()).firstOrNull;
      if (t == null) return _error(404, 'ticket_not_found', 'No such ticket');
      if (t['status'] == 'used') return _error(409, 'ticket_used', 'Already billed');
      if (t['status'] == 'cancelled') return _error(409, 'ticket_cancelled', 'Cancelled');
      if (t['expired'] == true) return _error(410, 'ticket_expired', 'Expired');
      return _json(_public(t));
    }
    if (r.method == 'POST' && seg.length == 5 && seg[2] == 'weigh-tickets') {
      final t = tickets[seg[3]];
      if (t == null) return _error(404, 'ticket_not_found', 'No such ticket');
      if (seg[4] == 'use') {
        final inv = body['invoiceId'];
        if (t['status'] == 'used' && t['usedInvoiceId'] != inv) return _error(409, 'ticket_used', 'Already billed');
        if (t['status'] == 'cancelled') return _error(409, 'ticket_cancelled', 'Cancelled');
        if (t['status'] != 'used') useCommits++;
        t['status'] = 'used';
        t['usedInvoiceId'] = inv;
        return _json(_public(t));
      }
      if (seg[4] == 'cancel') {
        t['status'] = 'cancelled';
        return _json(_public(t));
      }
    }
    return _error(404, 'not_found', 'Route not found');
  }

  http.Response _catalog(http.Request r) {
    final q = r.url.queryParameters;
    int since;
    var full = false;
    var offset = 0;
    if (q['after'] != null) {
      final parts = q['after']!.split(':'); // <since>:<offset>
      since = int.parse(parts[0]);
      offset = int.parse(parts[1]);
      full = since == 0;
    } else if (q['since'] != null && q['since']!.startsWith('c')) {
      since = int.parse(q['since']!.substring(1));
    } else {
      since = 0;
      full = true;
    }
    final limit = int.tryParse(q['limit'] ?? '') ?? 1000;
    final eff = limit < pageLimit ? limit : pageLimit;
    final changed = items.where((i) => full || (i['_rev'] as int) > since).toList();
    final page = changed.skip(offset).take(eff).map((i) => {...i}..remove('_rev')).toList();
    final removed = full
        ? <String>[]
        : [for (final x in removedIds) if (int.parse(x.split('@')[1]) > since) x.split('@')[0]];
    final more = offset + eff < changed.length;
    final answer = {
      'items': page,
      'removed': offset == 0 ? removed : <String>[],
      'cursor': 'c$rev',
      'next': more ? '$since:${offset + eff}' : null,
      'full': full,
    };
    final etag = '"${base64Url.encode(utf8.encode(jsonEncode(answer))).hashCode}"';
    if (r.headers['if-none-match'] == etag) return _json(null, 304, {'etag': etag});
    return _json(answer, 200, {'etag': etag});
  }

  http.Response _createTicket(String tid, Map<String, dynamic> body) {
    final lines = <Map<String, Object?>>[];
    var i = 0;
    for (final l in (body['lines'] as List).cast<Map<String, dynamic>>()) {
      final it = items.where((x) => x['itemId'] == l['itemId']).firstOrNull;
      if (it == null) return _error(400, 'invalid_line', 'Not sold at the counter', {'index': i, 'reason': 'item_not_found'});
      if (l.containsKey('price')) {
        // Unknown fields (prices) are ignored by the server.
      }
      final byWeight = it['soldBy'] == 'weight';
      final double qty;
      if (byWeight) {
        final w = (l['weightKg'] as num?)?.toDouble();
        if (w == null) return _error(400, 'invalid_line', 'Weight required', {'index': i, 'reason': 'weight_required'});
        final tare = (l['tareKg'] as num?)?.toDouble() ?? 0;
        qty = ((w - tare) * 1000).round() / 1000;
        if (qty <= 0 || qty > 999.999) return _error(400, 'invalid_line', 'Bad weight', {'index': i, 'reason': 'invalid_weight'});
      } else {
        qty = (l['qty'] as num?)?.toDouble() ?? 1;
      }
      final price = it['price'] as int;
      lines.add({
        'itemId': it['itemId'],
        'name': it['name'],
        'unit': it['unit'],
        'qty': qty,
        'unitPrice': price,
        'amount': ((qty * 1000).round() * price / 1000).round(),
        'taxInclusive': it['taxInclusive'],
        'gstRate': it['gstRate'],
        'hsn': it['hsn'],
        if (l['tareKg'] != null) 'tareKg': l['tareKg'],
      });
      i++;
    }
    ticketsIssued++;
    final id = 't-${++_ticketSeq}';
    final t = {
      'id': id,
      'code': 'W261022${_ticketSeq.toString().padLeft(5, '0')}',
      'terminalId': tid,
      'status': 'open',
      'lines': lines,
      'total': lines.fold<int>(0, (s, l) => s + (l['amount'] as int)),
      'note': body['note'],
      'createdAt': '2026-10-22T05:00:00.000Z',
      'expiresAt': DateTime.now().toUtc().add(const Duration(hours: 8)).toIso8601String(),
      'usedInvoiceId': null,
    };
    tickets[id] = t;
    return _json(_public(t));
  }

  Map<String, Object?> _public(Map<String, Object?> t) => {...t}..remove('expired');

  /// Issues a ticket directly (as if a weighing station had), for counter tests.
  Map<String, Object?> issue(List<Map<String, Object?>> lines) {
    final res = _createTicket('term-w', {'lines': lines});
    return jsonDecode(res.body) as Map<String, Object?>;
  }
}
