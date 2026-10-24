import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:srikit_business/src/counter/tender.dart';

/// Customers, credit book and expenses for the fake API, with the server rules the app depends on: receipts settle
/// the oldest open bills first and keep the rest as advance, the ledger's running balance, reminders refused when
/// nothing is due, expenses cancelled (kept, left out of totals), built-in categories not deletable, and
/// Idempotency-Key replays. [dropAfterCommit]: the write happens but the answer is lost (network error).
///
/// It shares its customer list with the counter fake (the counter's saved-customer bills read it).
class FakeBooks {
  FakeBooks(this.customers) {
    for (final c in customers) {
      _fill(c);
    }
    customers.add(_fill({
      'id': 'c2',
      'name': 'Lakshmi',
      'phone': '+919500012345',
      'creditLimit': 100000,
      'lastBillDate': '2026-10-01',
      'totalBilled': 150000,
    }));
    bills.addAll([
      {'id': 'inv-40', 'number': 'INV-0040', 'customerId': 'c2', 'date': '2026-09-01', 'dueDate': '2026-09-16', 'total': 100000, 'paid': 0, 'status': 'issued'},
      {'id': 'inv-41', 'number': 'INV-0041', 'customerId': 'c2', 'date': '2026-10-01', 'dueDate': null, 'total': 50000, 'paid': 0, 'status': 'issued'},
    ]);
    _recompute('c2');
    final today = todayIst();
    expenses['e1'] = _expense('e1', date: today, categoryId: 'cat-rent', amount: 1000000, method: 'bank', note: 'October rent');
  }

  final List<Map<String, Object?>> customers;
  final bills = <Map<String, Object?>>[];
  final receipts = <Map<String, Object?>>[];
  final expenses = <String, Map<String, Object?>>{};
  final categories = <Map<String, Object?>>[
    for (final (i, n) in const ['Rent', 'Salaries', 'Electricity', 'Transport', 'Packaging', 'Marketing', 'Repairs', 'Other'].indexed)
      _category('cat-${n.toLowerCase()}', n, (i + 1) * 10, builtin: true),
  ];
  final dropAfterCommit = <String>{};

  /// The next reminder fails like a shop without a WhatsApp provider.
  bool remindFails = false;
  int remindersSent = 0;
  final _stored = <String, String>{};

  static Map<String, Object?> _category(String id, String name, int sort, {bool builtin = false}) => {
        'id': id,
        'tenantId': 't1',
        'name': name,
        'sort': sort,
        'builtin': builtin,
        'createdAt': '2026-01-01T00:00:00.000Z',
        'updatedAt': '2026-01-01T00:00:00.000Z',
      };

  static Map<String, Object?> _fill(Map<String, Object?> c) {
    for (final e in {
      'email': null,
      'gstin': null,
      'address': null,
      'stateCode': '33',
      'openingBalance': 0,
      'creditLimit': null,
      'outstanding': 0,
      'advance': 0,
      'createdAt': '2026-01-01T00:00:00.000Z',
      'lastBillDate': null,
      'totalBilled': 0,
      'overdue': 0,
    }.entries) {
      c.putIfAbsent(e.key, () => e.value);
    }
    return c;
  }

  Map<String, Object?>? _customer(String id) => customers.where((c) => c['id'] == id).firstOrNull;

  int _billBalance(Map<String, Object?> b) => (b['total'] as int) - (b['paid'] as int);

  /// outstanding = opening + bills − receipts; advance = receipt money not settled against a bill.
  void _recompute(String id) {
    final c = _customer(id)!;
    final billed = bills.where((b) => b['customerId'] == id).fold<int>(0, (s, b) => s + (b['total'] as int));
    final received = receipts.where((r) => r['customerId'] == id).fold<int>(0, (s, r) => s + (r['amount'] as int));
    c['outstanding'] = (c['openingBalance'] as int) + billed - received;
    c['advance'] = receipts.where((r) => r['customerId'] == id).fold<int>(0, (s, r) => s + (r['advance'] as int));
    c['overdue'] = bills
        .where((b) => b['customerId'] == id && b['dueDate'] != null && (b['dueDate'] as String).compareTo('2026-10-21') < 0)
        .fold<int>(0, (s, b) => s + _billBalance(b));
  }

  Map<String, Object?> _customerJson(Map<String, Object?> c, {bool list = false}) => {
        for (final k in ['id', 'name', 'phone', 'email', 'gstin', 'address', 'stateCode', 'openingBalance', 'creditLimit', 'outstanding', 'advance', 'createdAt']) k: c[k],
        if (list) ...{'lastBillDate': c['lastBillDate'], 'totalBilled': c['totalBilled'], 'overdue': c['overdue']},
      };

  static String _kind(int balance) => balance > 0 ? 'due' : (balance < 0 ? 'advance' : 'settled');

  Map<String, Object?> _expense(String id, {required String date, required String categoryId, required int amount, String method = 'cash', String? note, String? reference}) => {
        'id': id,
        'tenantId': 't1',
        'date': date,
        'categoryId': categoryId,
        'amount': amount,
        'gstRate': 0,
        'gstAmount': 0,
        'vendorName': null,
        'vendorGstin': null,
        'paymentMethod': method,
        'reference': reference,
        'note': note,
        'receiptUrl': null,
        'status': 'recorded',
        'createdBy': 'u1',
        'createdAt': '2026-10-21T06:00:00.000Z',
        'updatedAt': '2026-10-21T06:00:00.000Z',
        'categoryName': categories.firstWhere((c) => c['id'] == categoryId)['name'],
        'taxable': amount,
        'itc': 0,
      };

  static http.Response _json(Object body, [int status = 200]) =>
      http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});
  static http.Response _error(int status, String code, String message) => _json({'error': {'code': code, 'message': message}}, status);

  /// `POST /v1/invoices/customers/:id/receipts`, … (ids replaced) for [dropAfterCommit].
  static String routeName(String method, String path) =>
      '$method ${path.replaceAllMapped(RegExp(r'/(c\d+|e\d+|cat-[a-z0-9-]+)(?=/|$)'), (_) => '/:id')}';

  Future<http.Response?> handle(http.Request r, Map<String, dynamic> body) async {
    final key = r.headers['idempotency-key'];
    final name = routeName(r.method, r.url.path);
    final id = '$name|$key';
    if (r.method != 'GET' && key != null && _stored.containsKey(id)) {
      return http.Response(_stored[id]!, 200, headers: {'content-type': 'application/json; charset=utf-8', 'idempotent-replayed': 'true'});
    }
    final res = _route(r, body);
    if (res != null && r.method != 'GET' && key != null && res.statusCode < 300) _stored[id] = res.body;
    if (res != null && dropAfterCommit.remove(name)) throw http.ClientException('Connection lost after the write');
    return res;
  }

  http.Response? _route(http.Request r, Map<String, dynamic> body) {
    final seg = r.url.pathSegments; // v1, invoices, customers, c2, receipts
    final q = r.url.queryParameters;
    final m = r.method;
    final path = '/${seg.join('/')}';

    // ---- customers
    if (path == '/v1/invoices/customers' && m == 'GET') {
      final term = (q['q'] ?? '').toLowerCase();
      final kinds = q['balance']?.split(',');
      final matching = customers.where((c) => '${c['name']} ${c['phone']} ${c['gstin']}'.toLowerCase().contains(term)).toList();
      final items = matching.where((c) => kinds == null || kinds.contains(_kind(c['outstanding'] as int))).toList()
        ..sort((a, b) => (a['name'] as String).compareTo(b['name'] as String));
      final facets = {for (final k in const ['due', 'advance', 'settled']) k: matching.where((c) => _kind(c['outstanding'] as int) == k).length};
      return _json({'items': [for (final c in items) _customerJson(c, list: true)], 'total': items.length, 'limit': 50, 'offset': 0, 'facets': {'balance': facets}});
    }
    if (path == '/v1/invoices/customers' && m == 'POST') {
      final c = _fill({
        'id': 'c${customers.length + 1}',
        ...body,
        'openingBalance': body['openingBalance'] ?? 0,
        'createdAt': '2026-10-21T06:00:00.000Z',
      });
      customers.add(c);
      _recompute(c['id'] as String);
      return _json(_customerJson(c));
    }
    if (seg.length >= 4 && seg[1] == 'invoices' && seg[2] == 'customers') {
      final c = _customer(seg[3]);
      if (c == null) return _error(404, 'not_found', 'Customer not found');
      final cid = c['id'] as String;
      final action = seg.length > 4 ? seg.sublist(4).join('/') : '';
      switch ((m, action)) {
        case ('GET', ''):
          return _json(_customerJson(c));
        case ('PATCH', ''):
          c.addAll(body);
          _recompute(cid);
          return _json(_customerJson(c));
        case ('GET', 'ledger'):
          return _json(_ledger(c, q['from'], q['to']));
        case ('POST', 'receipts'):
          return _receipt(c, body);
        case ('POST', 'statement/share'):
          return _json({'token': 'st-$cid', 'url': 'https://anna.srikit.test/s/st-$cid'});
        case ('POST', 'remind'):
          if (remindFails) return _error(400, 'bad_request', 'WhatsApp is not set up for this shop');
          if ((c['outstanding'] as int) <= 0) return _error(400, 'bad_request', 'Nothing is due from this customer');
          remindersSent++;
          return _json({'logId': 'log-$remindersSent', 'url': 'https://anna.srikit.test/s/st-$cid'});
      }
    }
    if (path == '/v1/invoices' && m == 'GET') {
      final list = bills.where((b) => q['customerId'] == null || b['customerId'] == q['customerId']).toList().reversed.toList();
      return _json({
        'items': [
          for (final b in list)
            {
              'id': b['id'],
              'number': b['number'],
              'branchId': null,
              'status': _billBalance(b) == 0 ? 'paid' : ((b['paid'] as int) > 0 ? 'partially_paid' : 'issued'),
              'date': b['date'],
              'dueDate': b['dueDate'],
              'customerName': _customer(b['customerId'] as String)?['name'] ?? '',
              'total': b['total'],
              'paid': b['paid'],
              'credited': 0,
              'balance': _billBalance(b),
              'isOverdue': b['dueDate'] != null && (b['dueDate'] as String).compareTo('2026-10-21') < 0 && _billBalance(b) > 0,
            },
        ],
        'total': list.length,
        'limit': 10,
        'offset': 0,
      });
    }

    // ---- credit book
    if (path == '/v1/invoices/credit-book' && m == 'GET') {
      final filter = q['filter'] ?? 'all';
      final term = (q['q'] ?? '').toLowerCase();
      var rows = customers
          .where((c) => '${c['name']} ${c['phone']}'.toLowerCase().contains(term))
          .where((c) => filter == 'all' || _kind(c['outstanding'] as int) == filter)
          .map(_creditRow)
          .toList();
      final ages = q['age']?.split(',');
      final ageCounts = <String, int>{};
      for (final row in rows) {
        final a = row['_age'] as String?;
        if (a != null) ageCounts[a] = (ageCounts[a] ?? 0) + 1;
      }
      if (ages != null) rows = rows.where((row) => ages.contains(row['_age'])).toList();
      rows.sort((a, b) => (b['balance'] as int).compareTo(a['balance'] as int)); // -due
      return _json({
        'items': [for (final row in rows) {...row}..remove('_age')],
        'total': rows.length,
        'limit': 50,
        'offset': 0,
        'totals': {
          'receivable': customers.fold<int>(0, (s, c) => s + ((c['outstanding'] as int) > 0 ? c['outstanding'] as int : 0)),
          'advance': customers.fold<int>(0, (s, c) => s + ((c['outstanding'] as int) < 0 ? -(c['outstanding'] as int) : 0)),
          'customersWithDues': customers.where((c) => (c['outstanding'] as int) > 0).length,
        },
        'facets': {'age': ageCounts},
      });
    }

    // ---- expenses
    if (seg.length >= 2 && seg[1] == 'expenses') return _expenses(r, seg, q, body);
    return null;
  }

  Map<String, Object?> _creditRow(Map<String, Object?> c) {
    final cid = c['id'] as String;
    final open = bills.where((b) => b['customerId'] == cid && _billBalance(b) > 0).toList();
    final oldest = open.isEmpty ? null : (open.first['dueDate'] ?? open.first['date']) as String;
    final days = oldest == null ? null : DateTime.parse('2026-10-21').difference(DateTime.parse(oldest)).inDays;
    final last = receipts.where((x) => x['customerId'] == cid).map((x) => x['date'] as String).fold<String?>(null, (a, d) => a == null || d.compareTo(a) > 0 ? d : a);
    return {
      'customer': _customerJson(c),
      'balance': c['outstanding'],
      'overdue': c['overdue'],
      'lastActivity': last ?? c['lastBillDate'],
      'oldestDue': oldest,
      'lastPayment': last,
      '_age': days == null ? null : (days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'),
    };
  }

  /// Oldest open bill first; the rest is advance.
  http.Response _receipt(Map<String, Object?> c, Map<String, dynamic> body) {
    final amount = body['amount'];
    if (amount is! int || amount < 1) return _error(400, 'invalid_input', 'Amount must be positive');
    var left = amount;
    final allocations = <Map<String, Object?>>[];
    for (final b in bills.where((b) => b['customerId'] == c['id'] && _billBalance(b) > 0)) {
      if (left == 0) break;
      final a = left < _billBalance(b) ? left : _billBalance(b);
      b['paid'] = (b['paid'] as int) + a;
      left -= a;
      allocations.add({'invoiceId': b['id'], 'number': b['number'], 'amount': a});
    }
    final receipt = {
      'id': 'rc${receipts.length + 1}',
      'customerId': c['id'],
      'amount': amount,
      'method': body['method'],
      'date': body['date'],
      'reference': body['reference'],
      'note': body['note'],
      'advance': left,
      'createdAt': '2026-10-21T06:00:00.000Z',
    };
    receipts.add(receipt);
    _recompute(c['id'] as String);
    return _json({'receipt': receipt, 'allocations': allocations, 'advance': left});
  }

  Map<String, Object?> _ledger(Map<String, Object?> c, String? from, String? to) {
    final cid = c['id'] as String;
    final all = <Map<String, Object?>>[
      for (final b in bills.where((b) => b['customerId'] == cid))
        {'date': b['date'], 'type': 'invoice', 'refId': b['id'], 'number': b['number'], 'description': 'Bill ${b['number']}', 'debit': b['total'], 'credit': 0},
      for (final x in receipts.where((x) => x['customerId'] == cid))
        {'date': x['date'], 'type': 'receipt', 'refId': x['id'], 'number': null, 'description': x['note'] ?? 'Receipt', 'debit': 0, 'credit': x['amount']},
    ]..sort((a, b) => (a['date'] as String).compareTo(b['date'] as String));
    var balance = c['openingBalance'] as int;
    final entries = <Map<String, Object?>>[];
    var opening = balance;
    for (final e in all) {
      final d = e['date'] as String;
      if (to != null && d.compareTo(to) > 0) continue;
      balance += (e['debit'] as int) - (e['credit'] as int);
      if (from != null && d.compareTo(from) < 0) {
        opening = balance;
        continue;
      }
      entries.add({...e, 'balance': balance});
    }
    return {'customer': _customerJson(c), 'openingBalance': opening, 'entries': entries, 'closingBalance': balance};
  }

  http.Response? _expenses(http.Request r, List<String> seg, Map<String, String> q, Map<String, dynamic> body) {
    final m = r.method;
    final rest = seg.sublist(2);
    if (rest.isEmpty && m == 'GET') {
      final statuses = (q['status'] ?? 'recorded').split(',');
      final cats = q['categoryId']?.split(',');
      final rows = expenses.values
          .where((e) => statuses.contains('all') || statuses.contains(e['status']))
          .where((e) => q['from'] == null || (e['date'] as String).compareTo(q['from']!) >= 0)
          .where((e) => q['to'] == null || (e['date'] as String).compareTo(q['to']!) <= 0)
          .where((e) => cats == null || cats.contains(e['categoryId']))
          .toList()
        ..sort((a, b) => (b['date'] as String).compareTo(a['date'] as String));
      final recorded = rows.where((e) => e['status'] == 'recorded');
      return _json({
        'items': rows,
        'total': rows.length,
        'limit': 50,
        'offset': 0,
        'totals': {'amount': recorded.fold<int>(0, (s, e) => s + (e['amount'] as int)), 'gst': 0, 'itc': 0},
        'facets': {'category': <String, int>{}, 'paymentMethod': <String, int>{}, 'status': <String, int>{}},
      });
    }
    if (rest.isEmpty && m == 'POST') {
      final amount = body['amount'];
      if (amount is! int || amount <= 0) return _error(400, 'invalid_input', 'Amount must be positive');
      final id = 'e${expenses.length + 1}';
      expenses[id] = _expense(id,
          date: body['date'] as String? ?? todayIst(),
          categoryId: body['categoryId'] as String? ?? 'cat-other',
          amount: amount,
          method: body['paymentMethod'] as String? ?? 'cash',
          note: body['note'] as String?,
          reference: body['reference'] as String?);
      return _json(expenses[id]!);
    }
    if (rest.length == 1 && rest[0] == 'summary' && m == 'GET') {
      final rows = expenses.values
          .where((e) => e['status'] == 'recorded')
          .where((e) => q['from'] == null || (e['date'] as String).compareTo(q['from']!) >= 0)
          .where((e) => q['to'] == null || (e['date'] as String).compareTo(q['to']!) <= 0)
          .toList();
      final byCat = <String, List<Map<String, Object?>>>{};
      for (final e in rows) {
        (byCat[e['categoryId'] as String] ??= []).add(e);
      }
      final total = rows.fold<int>(0, (s, e) => s + (e['amount'] as int));
      return _json({
        'from': q['from'] ?? '',
        'to': q['to'] ?? '',
        'total': total,
        'gst': 0,
        'itc': 0,
        'count': rows.length,
        'byCategory': [
          for (final e in byCat.entries)
            {
              'categoryId': e.key,
              'name': categories.firstWhere((c) => c['id'] == e.key)['name'],
              'total': e.value.fold<int>(0, (s, x) => s + (x['amount'] as int)),
              'gst': 0,
              'itc': 0,
              'count': e.value.length,
            },
        ]..sort((a, b) => (b['total'] as int).compareTo(a['total'] as int)),
        'byMonth': <Object>[],
      });
    }
    if (rest.isNotEmpty && rest[0] == 'categories') {
      if (rest.length == 1 && m == 'GET') return _json({'items': categories});
      if (rest.length == 1 && m == 'POST') {
        final name = (body['name'] as String).trim();
        if (categories.any((c) => (c['name'] as String).toLowerCase() == name.toLowerCase())) return _error(409, 'conflict', 'A category with that name exists');
        final c = _category('cat-new${categories.length}', name, 100 + categories.length);
        categories.add(c);
        return _json(c);
      }
      final c = categories.where((c) => c['id'] == rest[1]).firstOrNull;
      if (c == null) return _error(404, 'not_found', 'Category not found');
      if (m == 'PATCH') {
        c.addAll(body);
        return _json(c);
      }
      if (m == 'DELETE') {
        if (c['builtin'] == true) return _error(400, 'bad_request', "Built-in categories can't be deleted");
        if (expenses.values.any((e) => e['categoryId'] == c['id'])) return _error(409, 'conflict', 'This category has expenses; move them first');
        categories.remove(c);
        return _json({'ok': true});
      }
    }
    if (rest.length == 1) {
      final e = expenses[rest[0]];
      if (e == null) return _error(404, 'not_found', 'Expense not found');
      if (m == 'GET') return _json(e);
      if (m == 'PATCH') {
        e.addAll(body);
        if (body['categoryId'] != null) e['categoryName'] = categories.firstWhere((c) => c['id'] == body['categoryId'])['name'];
        if (body['amount'] != null) e['taxable'] = body['amount'];
        return _json(e);
      }
      if (m == 'DELETE') {
        e['status'] = 'cancelled';
        return _json(e);
      }
    }
    return null;
  }
}
