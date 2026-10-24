import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:test/test.dart';

const info = ClientInfo(app: 'business', version: '0.1.0', platform: 'android');

ApiClient clientWith(Future<http.Response> Function(http.Request) handler) =>
    ApiClient(baseUrl: 'http://api.test', client: info, httpClient: MockClient(handler));

http.Response json(Object body, [int status = 200, Map<String, String> headers = const {}]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8', ...headers});

http.Response apiError(int status, String code, String message, [Object? details]) =>
    json({'error': {'code': code, 'message': message, 'details': details}}, status);

void main() {
  group('mobile config', () {
    test('parses GET /v1/mobile/config', () async {
      late http.Request seen;
      final api = SrikitApi(clientWith((r) async {
        seen = r;
        return json({
          'apps': {
            'business': {'minVersion': '0.2.0', 'latestVersion': '0.3.0'},
            'shops': {'minVersion': null, 'latestVersion': '1.0.0'},
          },
          'client': {'app': 'business', 'version': '0.1.0', 'platform': 'android'},
          'updateRequired': true,
          'updateAvailable': true,
        });
      }));
      final c = await api.mobileConfig();
      expect(seen.url.path, '/v1/mobile/config');
      expect(seen.headers['x-client'], 'srikit-business/0.1.0 (android)');
      expect(c.updateRequired, isTrue);
      expect(c.updateAvailable, isTrue);
      expect(c.minVersionFor('business'), '0.2.0');
      expect(c.apps['shops']?.minVersion, isNull);
      expect(c.client?.platform, 'android');
    });

    test('client is null when the API could not read x-client', () {
      final c = MobileConfig.fromJson({'apps': {}, 'client': null, 'updateRequired': false, 'updateAvailable': false});
      expect(c.client, isNull);
      expect(c.updateRequired, isFalse);
    });
  });

  group('426 app_update_required', () {
    test('becomes UpdateRequiredException with minVersion and notifies the listener', () async {
      final c = clientWith((r) async => apiError(426, 'app_update_required', 'Please update the app', {'minVersion': '0.2.0'}));
      UpdateRequiredException? heard;
      c.onUpdateRequired = (e) => heard = e;
      await expectLater(
        c.get('/tenancy/mine'),
        throwsA(isA<UpdateRequiredException>()
            .having((e) => e.status, 'status', 426)
            .having((e) => e.minVersion, 'minVersion', '0.2.0')
            .having((e) => e.message, 'message', 'Please update the app')),
      );
      expect(heard?.minVersion, '0.2.0');
    });

    test('other 426 codes stay plain ApiExceptions', () async {
      final c = clientWith((r) async => apiError(426, 'upgrade', 'x'));
      var heard = false;
      c.onUpdateRequired = (_) => heard = true;
      await expectLater(c.get('/x'), throwsA(isNot(isA<UpdateRequiredException>())));
      expect(heard, isFalse);
    });
  });

  group('idempotency', () {
    test('sends Idempotency-Key on writes and reports replayed answers', () async {
      final seen = <http.Request>[];
      final api = SrikitApi(clientWith((r) async {
        seen.add(r);
        return json({'ok': true}, 200, seen.length == 2 ? {'idempotent-replayed': 'true'} : {});
      })
        ..token = 't');
      const key = 'dev1:2f1c4c6e-8a4b-4c39-9a51-0d6c1b7a9e10';
      final first = await api.registerPushToken('fcm-token-1234567890', 'android', idempotencyKey: key);
      final again = await api.registerPushToken('fcm-token-1234567890', 'android', idempotencyKey: key);
      expect(seen.map((r) => r.headers['idempotency-key']), [key, key]);
      expect(first.ok, isTrue);
      expect(first.replayed, isFalse);
      expect(again.replayed, isTrue);

      final res = await api.client.request('POST', '/x', body: const {}, idempotencyKey: key);
      expect(res.status, 200);
      expect(res.replayed, isFalse);
    });

    test('no key → no header', () async {
      late http.Request seen;
      final c = clientWith((r) async {
        seen = r;
        return json({'ok': true});
      });
      await c.post('/x', const {});
      expect(seen.headers.containsKey('idempotency-key'), isFalse);
    });

    test('rejects malformed keys and keys on reads before sending', () async {
      var sent = 0;
      final c = clientWith((r) async {
        sent++;
        return json({});
      });
      expect(() => c.request('POST', '/x', idempotencyKey: 'short'), throwsArgumentError);
      expect(() => c.request('POST', '/x', idempotencyKey: 'has space in it'), throwsArgumentError);
      expect(() => c.request('POST', '/x', idempotencyKey: 'x' * 129), throwsArgumentError);
      expect(() => c.request('GET', '/x', idempotencyKey: 'abcdefgh'), throwsArgumentError);
      expect(sent, 0);
    });

    test('409 idempotency_in_progress is retryable', () async {
      final c = clientWith((r) async => apiError(409, 'idempotency_in_progress', 'Still being processed'));
      try {
        await c.post('/x', const {}, 'abcdefgh-1');
        fail('should throw');
      } on IdempotencyInProgressException catch (e) {
        expect(e.retryable, isTrue);
        expect(e.status, 409);
      }
      // A plain 409 (conflict) is not retryable.
      final plain = clientWith((r) async => apiError(409, 'conflict', 'Already exists'));
      await expectLater(plain.post('/x', const {}),
          throwsA(isA<ApiException>().having((e) => e.retryable, 'retryable', isFalse)));
    });

    test('422 idempotency_key_reused is an Error, not an ApiException', () async {
      final c = clientWith((r) async => apiError(422, 'idempotency_key_reused', 'Used for a different request'));
      Object? caught;
      try {
        await c.post('/x', const {'a': 1}, 'abcdefgh-2');
      } on ApiException {
        fail('must not be an ApiException');
      } catch (e) {
        caught = e;
      }
      expect(caught, isA<IdempotencyKeyReusedError>().having((e) => e.key, 'key', 'abcdefgh-2'));
      // Validation 422s stay ApiExceptions.
      final other = clientWith((r) async => apiError(422, 'invalid', 'nope'));
      await expectLater(other.post('/x', const {}), throwsA(isA<ApiException>()));
    });

    test('IdempotencyKeys makes valid <deviceId>:<uuid v4> keys', () {
      final keys = IdempotencyKeys('3f2a9c0b7d6e4f1a8b5c2d9e0f1a2b3c', random: Random(1));
      final a = keys.next();
      final b = keys.next();
      expect(a, isNot(b));
      expect(isValidIdempotencyKey(a), isTrue);
      expect(a, matches(RegExp(r'^3f2a9c0b7d6e4f1a8b5c2d9e0f1a2b3c:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));
      expect(() => IdempotencyKeys('bad id'), throwsArgumentError);
      expect(() => IdempotencyKeys('a:b'), throwsArgumentError);
    });
  });

  test('requestOtp returns the resend wait', () async {
    final api = SrikitApi(clientWith((r) async =>
        json({'target': '+919999000001', 'channel': 'sms', 'expiresInSeconds': 600, 'resendInSeconds': 30})));
    final r = await api.requestOtp('+919999000001');
    expect(r.resendInSeconds, 30);
    expect(r.target, '+919999000001');
  });
}
