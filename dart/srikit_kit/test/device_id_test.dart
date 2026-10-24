import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

void main() {
  test('device id is made once, stored, and reused by later sessions', () async {
    final store = MemoryKeyValueStore();
    final a = SessionStore(store);
    final results = await Future.wait([a.deviceId(), a.deviceId()]);
    expect(results[0], results[1]); // concurrent first calls agree
    expect(results[0], matches(RegExp(r'^[0-9a-f]{32}$')));
    expect(store.values[SessionStore.deviceIdKey], results[0]);
    expect(await SessionStore(store).deviceId(), results[0]); // next launch
  });

  test('a malformed stored id is replaced', () async {
    final store = MemoryKeyValueStore({SessionStore.deviceIdKey: 'not valid!'});
    final id = await SessionStore(store).deviceId();
    expect(id, matches(RegExp(r'^[0-9a-f]{32}$')));
  });

  test('sign-out keeps the device id; keys use it as the prefix', () async {
    final store = MemoryKeyValueStore({SessionStore.tokenKey: 't'});
    final session = SessionStore(store);
    final id = await session.deviceId();
    final api = SrikitApi(ApiClient(
      baseUrl: 'http://api.test',
      client: const ClientInfo(app: 'business', version: '0.1.0'),
      httpClient: MockClient((r) async => http.Response(jsonEncode({'ok': true}), 200)),
    ))
      ..client.token = 't';
    await AuthRepository(api: api, session: session).signOut();
    expect(store.values.keys, [SessionStore.deviceIdKey]);
    final key = (await session.idempotencyKeys()).next();
    expect(key, startsWith('$id:'));
    expect(isValidIdempotencyKey(key), isTrue);
  });
}
