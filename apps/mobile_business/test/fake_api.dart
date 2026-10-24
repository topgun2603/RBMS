import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:srikit_api/srikit_api.dart';

import 'fake_books.dart';
import 'fake_counter.dart';
import 'fake_pos.dart';
import 'fake_shop.dart';

/// An in-memory srikit API for widget tests, answering the endpoints this slice uses with the real shapes.
class FakeSrikitServer {
  FakeSrikitServer({
    this.shops = const [
      {
        'tenant': {'id': 't1', 'slug': 'anna-stores', 'name': 'Anna Stores', 'appId': 'shop', 'status': 'active'},
        'roles': ['owner'],
      },
    ],
    this.enabled = const ['invoices', 'orders'],
    this.testOtp = '123456',
    this.updateRequired = false,
    this.updateAvailable = false,
    this.tenantRoles = const ['owner'],
    this.permissions = const ['*'],
  });

  /// Roles and permissions /auth/me reports in the shop.
  final List<String> tenantRoles;
  final List<String> permissions;

  final List<Map<String, Object?>> shops;
  final List<String> enabled;
  final String testOtp;

  /// GET /v1/mobile/config says this version is too old.
  bool updateRequired;
  bool updateAvailable;

  /// Every call except /mobile/config answers 426 app_update_required (the API's updateGuard).
  bool guard426 = false;
  final requests = <http.Request>[];

  /// Counter billing endpoints (catalogue, bills, payments, till).
  final counter = FakeCounter();

  /// Products, stock and orders.
  final shop = FakeShop();

  /// Customers (shared with the counter), credit book, expenses.
  late final books = FakeBooks(counter.customers);
  /// POS terminals: pairing, PIN sessions, the catalogue, weigh tickets.
  final pos = FakePos();
  String? issuedToken;

  static const user = {
    'id': 'u1',
    'phone': '+919999000001',
    'email': null,
    'name': 'Anna',
    'avatarUrl': null,
    'locale': 'en',
    'platformRoles': <String>[],
    'status': 'active',
    'createdAt': '2026-01-01T00:00:00.000Z',
  };

  late final http.Client client = MockClient((r) async {
    requests.add(r);
    final body = r.body.isEmpty ? const <String, dynamic>{} : jsonDecode(r.body) as Map<String, dynamic>;
    final signedIn = (issuedToken != null && r.headers['authorization'] == 'Bearer $issuedToken') || pos.pinSession(r) != null;
    final route = '${r.method} ${r.url.path}';
    if (route == 'GET /v1/mobile/config') {
      return _json({
        'apps': {
          'business': {'minVersion': updateRequired ? '0.2.0' : '0.1.0', 'latestVersion': updateAvailable ? '0.3.0' : '0.1.0'},
        },
        'client': {'app': 'business', 'version': '0.1.0', 'platform': null},
        'updateRequired': updateRequired,
        'updateAvailable': updateAvailable,
      });
    }
    if (guard426) {
      return _json({
        'error': {'code': 'app_update_required', 'message': 'Please update the app to keep using it', 'details': {'minVersion': '0.4.0'}},
      }, 426);
    }
    switch (route) {
      case 'GET /v1/auth/config':
        return _json({
          'phone': {'method': 'otp', 'firebaseProjectId': null, 'smsOtp': true},
          'google': false,
          'testTargets': ['+9199990*'],
        });
      case 'POST /v1/auth/otp/request':
        return _json({'sent': true});
      case 'POST /v1/auth/otp/verify':
        if (body['code'] != testOtp) return _error(400, 'invalid_code', 'That code is not right. Check the SMS and try again.');
        issuedToken = 'session-token';
        return _json({'token': issuedToken, 'expiresAt': '2027-01-01T00:00:00.000Z', 'user': user, 'isNewUser': false});
    }
    final posRes = await pos.handle(r, body);
    if (posRes != null) return posRes;
    if (!signedIn) return _error(401, 'unauthorized', 'Sign in required');
    final tenant = r.headers['x-tenant'];
    switch (route) {
      case 'GET /v1/auth/me':
        return _json({
          'user': user,
          'tenantRoles': tenant == null ? <String>[] : tenantRoles,
          'permissions': tenant == null ? <String>[] : permissions,
        });
      case 'POST /v1/auth/logout':
        return _json({'ok': true});
      case 'GET /v1/tenancy/mine':
        return _json({'items': shops});
      case 'GET /v1/features':
        return _json({'appId': 'shop', 'planId': 'free', 'features': <Object>[], 'enabled': enabled});
      case 'GET /v1/branding':
        return _json({
          'appName': null,
          'logoUrl': null,
          'logoDarkUrl': null,
          'faviconUrl': null,
          'tokens': {'colors': {'primary': '#b91c1c'}, 'radius': 0.5, 'fontSans': 'Inter', 'mode': 'light'},
          'css': '',
        });
      case 'GET /v1/invoices/summary':
        return _json({
          'month': {'invoiced': 12345678, 'collected': 5000000, 'count': 42},
          'prevMonth': {'invoiced': 10000000, 'collected': 9000000, 'count': 40},
          'outstanding': 7345678,
          'overdueCount': 2,
          'recent': <Object>[],
          'trend': <Object>[],
        });
    }
    final booksRes = await books.handle(r, body);
    if (booksRes != null) return booksRes;
    final billing = await counter.handle(r, body);
    if (billing != null) return billing;
    final shopRes = await shop.handle(r, body);
    if (shopRes != null) return shopRes;
    return _error(404, 'not_found', 'Route not found');
  });

  ApiClient apiClient() =>
      ApiClient(baseUrl: 'http://api.test', client: const ClientInfo(app: 'business', version: '0.1.0'), httpClient: client);

  static http.Response _json(Object body, [int status = 200]) =>
      http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

  static http.Response _error(int status, String code, String message) =>
      _json({'error': {'code': code, 'message': message}}, status);
}
