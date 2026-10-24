import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:test/test.dart';

const info = ClientInfo(app: 'business', version: '1.0.0', platform: 'android');

ApiClient clientWith(Future<http.Response> Function(http.Request) handler) =>
    ApiClient(baseUrl: 'http://10.0.2.2:4000/', client: info, httpClient: MockClient(handler));

http.Response json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

void main() {
  group('headers', () {
    test('sends bearer token, tenant, language and client id', () async {
      late http.Request seen;
      final c = clientWith((r) async {
        seen = r;
        return json({'ok': true});
      })
        ..token = 'tok123'
        ..tenant = 'anna-stores'
        ..locale = 'ta';
      await c.post('/notify/push-tokens', {'token': 'x', 'platform': 'android'});
      expect(seen.url.toString(), 'http://10.0.2.2:4000/v1/notify/push-tokens');
      expect(seen.method, 'POST');
      expect(seen.headers['authorization'], 'Bearer tok123');
      expect(seen.headers['x-tenant'], 'anna-stores');
      expect(seen.headers['accept-language'], 'ta');
      expect(seen.headers['x-client'], 'srikit-business/1.0.0 (android)');
      expect(seen.headers['content-type'], startsWith('application/json'));
      expect(jsonDecode(seen.body), {'token': 'x', 'platform': 'android'});
    });

    test('omits authorization and x-tenant when not set', () async {
      late http.Request seen;
      final c = clientWith((r) async {
        seen = r;
        return json({});
      });
      await c.get('/auth/config', query: {'a': '1'});
      expect(seen.url.toString(), 'http://10.0.2.2:4000/v1/auth/config?a=1');
      expect(seen.headers.containsKey('authorization'), isFalse);
      expect(seen.headers.containsKey('x-tenant'), isFalse);
      expect(seen.headers.containsKey('content-type'), isFalse);
    });

    test('x-client matches the API pattern (packages/auth parseClient)', () {
      final re = RegExp(r'^srikit-[a-z]+/\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.]+)?(?: \((?:android|ios)\))?$');
      expect(re.hasMatch(info.header), isTrue);
      expect(re.hasMatch(const ClientInfo(app: 'business', version: '1.2.3+4').header), isTrue);
    });
  });

  group('errors', () {
    test('maps { error: { code, message, details } } to ApiException', () async {
      final c = clientWith((r) async => json({
            'error': {'code': 'invalid_code', 'message': 'That code is wrong', 'details': {'left': 2}}
          }, 400));
      await expectLater(
        c.post('/auth/otp/verify', {'target': '+919999000001', 'code': '1'}),
        throwsA(isA<ApiException>()
            .having((e) => e.status, 'status', 400)
            .having((e) => e.code, 'code', 'invalid_code')
            .having((e) => e.message, 'message', 'That code is wrong')
            .having((e) => e.details, 'details', {'left': 2})),
      );
    });

    test('401 is flagged as unauthorized', () async {
      final c = clientWith((r) async => json({'error': {'code': 'unauthorized', 'message': 'Sign in required'}}, 401));
      try {
        await c.get('/auth/me');
        fail('should throw');
      } on ApiException catch (e) {
        expect(e.isUnauthorized, isTrue);
      }
    });

    test('non-JSON error bodies become http_<status>', () async {
      final c = clientWith((r) async => http.Response('<html>Bad gateway</html>', 502));
      await expectLater(c.get('/x'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'http_502')));
    });

    test('transport failures become status 0 network errors', () async {
      final c = clientWith((r) async => throw http.ClientException('Connection refused'));
      await expectLater(
        c.get('/x'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 0).having((e) => e.code, 'code', 'network')),
      );
    });
  });

  group('SrikitApi models', () {
    test('parses sign-in, shops, features and the dashboard summary', () async {
      final api = SrikitApi(clientWith((r) async {
        switch (r.url.path) {
          case '/v1/auth/otp/verify':
            return json({
              'token': 't',
              'expiresAt': '2026-12-01T00:00:00.000Z',
              'isNewUser': true,
              'user': {'id': 'u1', 'phone': '+919999000001', 'locale': 'ta', 'platformRoles': [], 'status': 'active'},
            });
          case '/v1/tenancy/mine':
            return json({
              'items': [
                {
                  'tenant': {'id': 't1', 'slug': 'anna', 'name': 'Anna Stores', 'appId': 'shop', 'status': 'active'},
                  'roles': ['owner'],
                }
              ]
            });
          case '/v1/features':
            return json({
              'appId': 'shop',
              'planId': null,
              'enabled': ['invoices'],
              'features': [
                {
                  'key': 'invoices', 'module': 'invoices', 'label': 'GST bills', 'description': '', 'dependsOn': [],
                  'shopToggle': false, 'enabled': true, 'reason': null, 'available': true, 'shopEnabled': null,
                }
              ],
            });
          case '/v1/invoices/summary':
            return json({
              'month': {'invoiced': 12345678, 'collected': 100, 'count': 3},
              'prevMonth': {'invoiced': 0, 'collected': 0, 'count': 0},
              'outstanding': 500,
              'overdueCount': 1,
              'recent': [],
              'trend': [{'date': '2026-10-20', 'invoiced': 100}],
            });
        }
        return json({'error': {'code': 'not_found', 'message': 'nope'}}, 404);
      }));
      final r = await api.verifyOtp('+919999000001', '123456');
      expect(r.token, 't');
      expect(r.isNewUser, isTrue);
      expect(r.user.locale, 'ta');
      final shops = await api.myShops();
      expect(shops.single.tenant.slug, 'anna');
      expect(shops.single.roles, ['owner']);
      final f = await api.features();
      expect(f.enabled, ['invoices']);
      expect(f.features.single.label, 'GST bills');
      final s = await api.invoiceSummary();
      expect(s.month.invoiced, 12345678);
      expect(s.trend.single.invoiced, 100);
    });

    test('auth config test targets use * wildcards', () {
      final c = AuthClientConfig.fromJson({
        'phone': {'method': 'otp', 'firebaseProjectId': null, 'smsOtp': true},
        'google': false,
        'testTargets': ['+9199990*'],
      });
      expect(c.usesFirebase, isFalse);
      expect(c.isTestTarget('+919999000001'), isTrue);
      expect(c.isTestTarget('+919876543210'), isFalse);
    });
  });
}
