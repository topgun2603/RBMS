import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

http.Response json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

const meJson = {
  'user': {'id': 'u1', 'phone': '+919999000001', 'name': 'Anna', 'locale': 'en', 'platformRoles': [], 'status': 'active'},
  'tenantRoles': <String>[],
  'permissions': <String>[],
};

SrikitApi apiWith(Future<http.Response> Function(http.Request) handler) => SrikitApi(ApiClient(
      baseUrl: 'http://api.test',
      client: const ClientInfo(app: 'business', version: '1.0.0'),
      httpClient: MockClient(handler),
    ));

class FakePush implements PushTokenSource {
  @override
  String get platform => 'android';
  @override
  Future<String?> token() async => 'fcm-token-1234567890';
}

void main() {
  group('formatPaise', () {
    test('Indian grouping with paise', () {
      expect(formatPaise(12345678), '₹1,23,456.78');
      expect(formatPaise(0), '₹0.00');
      expect(formatPaise(5), '₹0.05');
      expect(formatPaise(99999), '₹999.99');
      expect(formatPaise(100000), '₹1,000.00');
      expect(formatPaise(1000000000), '₹1,00,00,000.00');
      expect(formatPaise(-12345678), '-₹1,23,456.78');
      expect(formatPaise(12345678, symbol: false), '1,23,456.78');
    });

    test('whole rupees round half up', () {
      expect(formatPaise(12345678, decimals: false), '₹1,23,457');
      expect(formatPaise(12345649, decimals: false), '₹1,23,456');
      expect(formatPaise(-150, decimals: false), '-₹2');
    });
  });

  test('normalizePhone', () {
    expect(normalizePhone('98765 43210'), '+919876543210');
    expect(normalizePhone('09876543210'), '+919876543210');
    expect(normalizePhone('+91 98765-43210'), '+919876543210');
    expect(normalizePhone('919876543210'), '+919876543210');
    expect(normalizePhone('12345'), isNull);
    expect(normalizePhone('+91 12345 67890'), isNull);
    expect(normalizePhone('+1 415 555 0100'), '+14155550100');
  });

  group('AuthRepository', () {
    test('restore without a token returns null and makes no request', () async {
      var calls = 0;
      final api = apiWith((r) async {
        calls++;
        return json(meJson);
      });
      final repo = AuthRepository(api: api, session: SessionStore(MemoryKeyValueStore()));
      expect(await repo.restore(), isNull);
      expect(calls, 0);
    });

    test('restore with a saved token sends it and returns the user', () async {
      String? auth;
      final api = apiWith((r) async {
        auth = r.headers['authorization'];
        return json(meJson);
      });
      final repo = AuthRepository(api: api, session: SessionStore(MemoryKeyValueStore({SessionStore.tokenKey: 'saved'})));
      final me = await repo.restore();
      expect(me?.user.name, 'Anna');
      expect(auth, 'Bearer saved');
    });

    test('restore drops a token the server rejects (401)', () async {
      final store = MemoryKeyValueStore({SessionStore.tokenKey: 'old'});
      final api = apiWith((r) async => json({'error': {'code': 'unauthorized', 'message': 'Sign in required'}}, 401));
      final repo = AuthRepository(api: api, session: SessionStore(store));
      expect(await repo.restore(), isNull);
      expect(store.values.containsKey(SessionStore.tokenKey), isFalse);
      expect(api.client.token, isNull);
    });

    test('restore keeps the token when offline', () async {
      final store = MemoryKeyValueStore({SessionStore.tokenKey: 'keep'});
      final api = apiWith((r) async => throw http.ClientException('offline'));
      final repo = AuthRepository(api: api, session: SessionStore(store));
      await expectLater(repo.restore(), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'network', isTrue)));
      expect(store.values[SessionStore.tokenKey], 'keep');
    });

    test('sign-in saves the token; sign-out removes push token, logs out and forgets the session', () async {
      final store = MemoryKeyValueStore();
      final seen = <String>[];
      final api = apiWith((r) async {
        seen.add('${r.method} ${r.url.path} ${r.headers['authorization']}');
        return json({'ok': true});
      });
      final repo = AuthRepository(api: api, session: SessionStore(store), push: PushRegistrar(api, FakePush()));
      await repo.completeSignIn(SignInResult.fromJson({'token': 'new', 'user': meJson['user'], 'isNewUser': false}));
      expect(store.values[SessionStore.tokenKey], 'new');
      await store.write(SessionStore.shopKey, 'anna');
      await repo.signOut();
      expect(seen, ['DELETE /v1/notify/push-tokens Bearer new', 'POST /v1/auth/logout Bearer new']);
      expect(store.values, isEmpty);
      expect(api.client.token, isNull);
    });

    test('sign-out still clears the device when the server is unreachable', () async {
      final store = MemoryKeyValueStore({SessionStore.tokenKey: 't'});
      final api = apiWith((r) async => throw http.ClientException('offline'));
      final repo = AuthRepository(api: api, session: SessionStore(store));
      api.client.token = 't';
      await repo.signOut();
      expect(store.values, isEmpty);
    });
  });

  group('ShopRepository', () {
    Membership shop(String slug, [String status = 'active']) =>
        Membership.fromJson({'tenant': {'id': slug, 'slug': slug, 'name': slug, 'status': status}, 'roles': ['owner']});

    test('autoPick: the only shop, else the remembered one', () async {
      final store = MemoryKeyValueStore();
      final repo = ShopRepository(api: apiWith((r) async => json({})), session: SessionStore(store));
      expect((await repo.autoPick([shop('a')]))?.tenant.slug, 'a');
      expect(await repo.autoPick([shop('a'), shop('b')]), isNull);
      await store.write(SessionStore.shopKey, 'b');
      expect((await repo.autoPick([shop('a'), shop('b')]))?.tenant.slug, 'b');
      expect(await repo.autoPick([shop('a'), shop('c')]), isNull);
      expect((await repo.autoPick([shop('a'), shop('z', 'suspended')]))?.tenant.slug, 'a');
    });

    test('open sends x-tenant, loads features / me / branding and remembers the shop', () async {
      final store = MemoryKeyValueStore();
      final tenants = <String?>{};
      final api = apiWith((r) async {
        tenants.add(r.headers['x-tenant']);
        return switch (r.url.path) {
          '/v1/features' => json({'appId': 'shop', 'planId': 'free', 'features': [], 'enabled': ['invoices']}),
          '/v1/auth/me' => json({...meJson, 'tenantRoles': ['staff'], 'permissions': ['invoices.*']}),
          '/v1/branding' => json({'appName': 'Anna', 'tokens': {'colors': {'primary': '#b91c1c'}, 'radius': 1}}),
          _ => json({'error': {'code': 'not_found', 'message': 'x'}}, 404),
        };
      });
      final ctx = await ShopRepository(api: api, session: SessionStore(store)).open(shop('anna'));
      expect(tenants, {'anna'});
      expect(store.values[SessionStore.shopKey], 'anna');
      expect(ctx.tokens.colors.primary, '#b91c1c');
      expect(ctx.gates.feature('invoices'), isTrue);
      expect(ctx.gates.can('invoices.create'), isTrue);
      expect(ctx.gates.can('orders.view'), isFalse);
    });
  });

  group('gates', () {
    test('permissionMatches mirrors the server', () {
      expect(permissionMatches('*', 'anything.here'), isTrue);
      expect(permissionMatches('invoices.cancel', 'invoices.cancel'), isTrue);
      expect(permissionMatches('invoices.*', 'invoices.cancel'), isTrue);
      expect(permissionMatches('invoices.*', 'invoices.reports.view'), isTrue);
      expect(permissionMatches('invoices.*', 'invoices'), isTrue);
      expect(permissionMatches('*.view', 'reports.view'), isTrue);
      expect(permissionMatches('*.view', 'reports.gst.view'), isFalse);
      expect(permissionMatches('invoices.cancel', 'invoices.create'), isFalse);
      expect(permissionMatches('orders.*', 'invoices.create'), isFalse);
    });

    test('Gates: features and permissions, owners hold everything', () {
      const staff = Gates(enabled: {'invoices'}, roles: ['staff'], permissions: ['invoices.create']);
      expect(staff.allows(features: ['invoices']), isTrue);
      expect(staff.allows(features: ['orders']), isFalse);
      expect(staff.allows(features: ['invoices'], permissions: ['invoices.create']), isTrue);
      expect(staff.allows(permissions: ['invoices.cancel']), isFalse);
      const owner = Gates(enabled: {'invoices'}, roles: ['owner']);
      expect(owner.can('invoices.cancel'), isTrue);
      expect(owner.feature('orders'), isFalse); // owners still need the feature
      expect(Gates.none.allows(features: ['invoices']), isFalse);
      expect(Gates.none.allows(), isTrue);
    });

    testWidgets('Gate widget shows the child or the fallback', (tester) async {
      await tester.pumpWidget(Directionality(
        textDirection: TextDirection.ltr,
        child: GateScope(
          gates: const Gates(enabled: {'invoices'}),
          child: Column(children: [
            Gate.feature('invoices', child: const Text('bill')),
            Gate.feature('orders', fallback: const Text('no orders'), child: const Text('orders')),
          ]),
        ),
      ));
      expect(find.text('bill'), findsOneWidget);
      expect(find.text('orders'), findsNothing);
      expect(find.text('no orders'), findsOneWidget);
    });
  });
}
