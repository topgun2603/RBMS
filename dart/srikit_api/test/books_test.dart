import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:test/test.dart';

void main() {
  test('credit book page: rows with the customer, totals, age counts', () {
    final p = CreditBookPage.fromJson({
      'items': [
        {
          'customer': {'id': 'c2', 'name': 'Lakshmi', 'phone': '+919500012345', 'creditLimit': 100000, 'outstanding': 150000},
          'balance': 150000,
          'overdue': 100000,
          'lastActivity': '2026-10-01',
          'oldestDue': '2026-09-16',
          'lastPayment': null,
        },
      ],
      'total': 1,
      'limit': 50,
      'offset': 0,
      'totals': {'receivable': 150000, 'advance': 0, 'customersWithDues': 1},
      'facets': {
        'age': {'31-60': 1},
      },
    });
    final r = p.items.single;
    expect(r.customer.creditLimit, 100000);
    expect((r.balance, r.overdue, r.oldestDue, r.lastPayment), (150000, 100000, '2026-09-16', null));
    expect(p.totals.customersWithDues, 1);
    expect(p.ageCounts, {'31-60': 1});
  });

  test('ledger, receipt result, remind result', () {
    final l = Ledger.fromJson({
      'customer': {'id': 'c2', 'name': 'Lakshmi'},
      'openingBalance': 0,
      'entries': [
        {'date': '2026-09-01', 'type': 'invoice', 'refId': 'i', 'number': 'INV-1', 'description': 'INV-1', 'debit': 100, 'credit': 0, 'balance': 100},
      ],
      'closingBalance': 100,
    });
    expect(l.entries.single.type, 'invoice');
    expect(l.closingBalance, 100);
    final rr = ReceiptResult.fromJson({
      'receipt': {'id': 'r', 'customerId': 'c2', 'amount': 150, 'method': 'upi', 'date': '2026-10-21', 'reference': null, 'note': null, 'advance': 50, 'createdAt': '2026-10-21T06:00:00.000Z'},
      'allocations': [
        {'invoiceId': 'i', 'number': 'INV-1', 'amount': 100},
      ],
      'advance': 50,
    });
    expect(rr.receipt.method, 'upi');
    expect(rr.allocations.single.number, 'INV-1');
    expect(rr.advance, 50);
    expect(RemindResult.fromJson({'logId': 'l', 'url': 'https://x/s/1'}).url, 'https://x/s/1');
  });

  test('expenses: page totals, summary, input body', () {
    final p = ExpensePage.fromJson({
      'items': [
        {'id': 'e', 'date': '2026-10-21', 'categoryId': 'c', 'amount': 1500, 'gstRate': 18, 'gstAmount': 229, 'paymentMethod': 'upi', 'status': 'cancelled', 'categoryName': 'Rent', 'taxable': 1271, 'itc': 0},
      ],
      'total': 1,
      'totals': {'amount': 0, 'gst': 0, 'itc': 0},
      'facets': {'status': {'cancelled': 1}},
    });
    expect(p.items.single.cancelled, isTrue);
    expect(p.items.single.gstRate, 18);
    expect(p.totals.amount, 0);
    final s = ExpenseSummary.fromJson({
      'from': '2026-10-01',
      'to': '2026-10-21',
      'total': 1500,
      'gst': 0,
      'itc': 0,
      'count': 1,
      'byCategory': [
        {'categoryId': 'c', 'name': 'Rent', 'total': 1500, 'gst': 0, 'itc': 0, 'count': 1},
      ],
      'byMonth': [
        {'month': '2026-10', 'total': 1500, 'gst': 0, 'itc': 0, 'count': 1},
      ],
    });
    expect(s.byCategory.single.name, 'Rent');
    expect(s.byMonth.single.month, '2026-10');
    expect(const ExpenseInput(amount: 100, note: '  ', reference: ' R1 ').toJson(), {'amount': 100, 'note': null, 'reference': 'R1'});
  });

  test('requests: credit book query, receipt body, customer patch, expense list / cancel, keys', () async {
    final seen = <http.Request>[];
    final api = SrikitApi(ApiClient(
      baseUrl: 'http://api.test',
      client: const ClientInfo(app: 'business', version: '0.1.0'),
      httpClient: MockClient((r) async {
        seen.add(r);
        final path = r.url.path;
        final Object body = switch ((r.method, path)) {
          ('GET', '/v1/invoices/credit-book') => {'items': <Object>[], 'total': 0, 'totals': <String, Object>{}, 'facets': {'age': <String, Object>{}}},
          ('POST', '/v1/invoices/customers/c2/receipts') => {'receipt': {'id': 'r', 'amount': 100}, 'allocations': <Object>[], 'advance': 100},
          ('GET', '/v1/expenses') => {'items': <Object>[], 'total': 0, 'totals': <String, Object>{}, 'facets': <String, Object>{}},
          ('GET', '/v1/expenses/categories') => {
              'items': [
                {'id': 'c', 'name': 'Rent', 'sort': 10, 'builtin': true},
              ],
            },
          _ => {'id': 'x', 'name': 'X', 'date': '2026-10-21', 'categoryId': 'c', 'amount': 1, 'status': 'cancelled'},
        };
        return http.Response(jsonEncode(body), 200,
            headers: {'content-type': 'application/json', if (r.method != 'GET') 'idempotent-replayed': 'true'});
      }),
    ));

    await api.creditBook(filter: 'due', age: ['31-60', '90+'], sort: '-due');
    expect(seen.last.url.queryParameters, {'filter': 'due', 'age': '31-60,90+', 'sort': '-due', 'limit': '50', 'offset': '0'});

    final w = await api.receivePayment('c2', amount: 100, method: 'cash', date: '2026-10-21', reference: ' ', note: 'paid', idempotencyKey: 'dev1:abcdefgh');
    expect(w.replayed, isTrue);
    expect(jsonDecode(seen.last.body), {'amount': 100, 'method': 'cash', 'date': '2026-10-21', 'note': 'paid'});
    expect(seen.last.headers['idempotency-key'], 'dev1:abcdefgh');

    await api.updateCustomer('c2', {'creditLimit': null});
    expect((seen.last.method, seen.last.url.path), ('PATCH', '/v1/invoices/customers/c2'));
    expect(jsonDecode(seen.last.body), {'creditLimit': null});

    await api.customers(balance: ['due'], overLimit: true);
    expect(seen.last.url.queryParameters, {'balance': 'due', 'overLimit': 'true', 'limit': '50', 'offset': '0'});

    await api.expenses(from: '2026-10-01', to: '2026-10-21', categoryIds: ['c'], statuses: ['all']);
    expect(seen.last.url.queryParameters,
        {'from': '2026-10-01', 'to': '2026-10-21', 'categoryId': 'c', 'status': 'all', 'sort': '-date', 'limit': '50', 'offset': '0'});

    final cancelled = await api.cancelExpense('e1', idempotencyKey: 'dev1:cancel-e1');
    expect((seen.last.method, seen.last.url.path), ('DELETE', '/v1/expenses/e1'));
    expect(cancelled.value.cancelled, isTrue);

    expect((await api.expenseCategories()).single.builtin, isTrue);

    await api.remindCustomer('c2', locale: 'ta');
    expect(jsonDecode(seen.last.body), {'channel': 'whatsapp', 'locale': 'ta'});
    await api.invoices(customerId: 'c2', limit: 10);
    expect(seen.last.url.queryParameters, {'customerId': 'c2', 'limit': '10', 'offset': '0'});
  });
}
