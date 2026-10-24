// Smoke test of terminal mode against a running API (not the emulator). Skipped unless SRIKIT_LIVE_API is set:
//
//   SRIKIT_LIVE_API=http://localhost:4000 SRIKIT_LIVE_SHOP=murugan SRIKIT_LIVE_EMAIL=you@example.com \
//     SRIKIT_LIVE_OTP=123456 SRIKIT_LIVE_PIN=8023 flutter test --concurrency=1 test/live/pos_live_test.dart
//
// It signs in as the owner (email OTP; needs TEST_OTP_* in the API's .env), makes fresh pairing codes for the shop's
// "Counter 1" and "Weighing 1" (this REPLACES the devices paired to them), pairs both, unlocks with the PIN, syncs
// the catalogue with the app's sync code, issues a weigh ticket on the weighing terminal, fetches it by code from the
// counter terminal, then cancels it and locks both. Pairing is rate limited (10 per IP per 10 min): don't loop it.

// ignore_for_file: avoid_print

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/src/pos/catalog.dart';
import 'package:srikit_business/src/pos/pairing.dart';
import 'package:srikit_business/src/pos/weigh.dart';

final _env = Platform.environment;
final _api = _env['SRIKIT_LIVE_API'];

SrikitApi _client() => SrikitApi(ApiClient(
      baseUrl: _api!,
      client: const ClientInfo(app: 'business', version: '0.1.0', platform: 'android'),
      timeout: const Duration(seconds: 60),
    ));

void main() {
  test('live: pair, PIN, catalogue, weigh ticket across two terminals', () async {
    final shop = _env['SRIKIT_LIVE_SHOP'] ?? 'murugan';
    final email = _env['SRIKIT_LIVE_EMAIL']!;
    final otp = _env['SRIKIT_LIVE_OTP'] ?? '123456';
    final pinCode = _env['SRIKIT_LIVE_PIN'] ?? '8023';
    final keys = IdempotencyKeys('livesmoke');

    // ---- the owner makes pairing codes
    final owner = _client();
    await owner.requestOtp(email, channel: 'email');
    final signIn = await owner.verifyOtp(email, otp);
    owner.client
      ..token = signIn.token
      ..tenant = shop;
    final list = await owner.posTerminals();
    print('terminals in $shop: ${list.items.map((t) => '${t.name} (${t.role}${t.paired ? ', paired' : ''})').join(', ')}; '
        'limit ${list.limit}');
    final counterT = list.items.firstWhere((t) => t.name == 'Counter 1');
    final weighT = list.items.firstWhere((t) => t.name == 'Weighing 1');
    final counterCode = (await owner.posPairingCode(counterT.id, idempotencyKey: keys.next())).value;
    final weighCode = (await owner.posPairingCode(weighT.id, idempotencyKey: keys.next())).value;
    print('pairing codes: Counter 1 ${counterCode.code} (qr ${counterCode.qr}), Weighing 1 ${weighCode.code}');
    final qr = parsePairingQr(counterCode.qr)!;
    print('QR parsed: origin ${qr.origin}, code ${qr.code}, origin switch needed: ${pairingOrigin(qr, _api!) ?? 'no'}');

    // ---- pair both terminals and unlock with the PIN
    Future<(SrikitApi, PosDeviceInfo, PosPinSession)> terminal(String code) async {
      final api = _client();
      final paired = await api.posPair(code, const PosDeviceDescription(platform: 'android', model: 'live smoke', appVersion: '0.1.0'));
      api.client.deviceToken = paired.value.deviceToken;
      final device = await api.posDevice();
      api.client.tenant = device.shop.slug;
      final staff = await api.posStaff();
      final session = await api.posSession(pinCode);
      api.client.token = session.token;
      print('paired ${device.terminal.name} (${device.terminal.role}) of ${device.shop.name} [${device.shop.slug}]; '
          'lockAfter ${device.terminal.settings.lockAfterMinutes} min; features pos.terminals=${device.features.contains('pos.terminals')} '
          'pos.weighing=${device.features.contains('pos.weighing')}; staff ${staff.map((s) => '${s.name ?? '(no name)'}${s.hasPin ? '' : ' no PIN'}').join(', ')}; '
          'PIN session for ${session.userName ?? '(no name)'} roles ${session.tenantRoles} until ${session.expiresAt?.toUtc()}');
      return (api, device, session);
    }

    final (counter, counterDevice, _) = await terminal(qr.code);
    final (weigh, _, _) = await terminal(weighCode.code);
    expect(counterDevice.terminal.role, 'pos');

    // ---- catalogue sync with the app's code
    final catalog = PosCatalog(api: counter, store: MemoryCatalogStore());
    final sw = Stopwatch()..start();
    await catalog.sync(rethrowErrors: true);
    print('catalogue: ${catalog.count} items in ${catalog.lastChange!.pages} page(s), full=${catalog.lastChange!.replace}, '
        '${catalog.categories.length} categories, ${sw.elapsedMilliseconds} ms; by weight: '
        '${catalog.snapshot.items.values.where((i) => i.byWeight).length}; cursor ${catalog.snapshot.cursor}');
    await catalog.sync(rethrowErrors: true);
    print('delta 1: changed=${catalog.lastChange!.changed} notModified=${catalog.lastChange!.notModified} '
        'etag kept=${catalog.snapshot.etag != null}');
    await catalog.sync(rethrowErrors: true);
    print('delta 2: changed=${catalog.lastChange!.changed} notModified=${catalog.lastChange!.notModified}');
    final sample = catalog.snapshot.items.values.firstWhere((i) => i.barcodes.isNotEmpty || i.sku != null,
        orElse: () => catalog.snapshot.items.values.first);
    final code = sample.barcodes.isNotEmpty ? sample.barcodes.first : sample.sku;
    if (code != null) print('local lookup "$code" → ${catalog.index.findByCode(code)?.name}');

    // ---- weigh ticket on the weighing terminal
    final weighCatalog = PosCatalog(api: weigh, store: MemoryCatalogStore());
    await weighCatalog.sync(rethrowErrors: true);
    final item = weighCatalog.index.search('', weightFirst: true).first;
    final line = item.byWeight
        ? PendingWeighLine(item: item, weightKg: 1.284, tareKg: 0.05)
        : PendingWeighLine(item: item, qty: 2);
    final key = keys.next();
    final issued = await weigh.createWeighTicket([line.toInput()], idempotencyKey: key);
    final again = await weigh.createWeighTicket([line.toInput()], idempotencyKey: key);
    print('issued ${issued.value.code} on Weighing 1: ${issued.value.lines.map((l) => '${l.name} ${l.qty} ${l.unit} × ${l.unitPrice} = ${l.amount}').join('; ')}; '
        'total ${issued.value.total} (estimate ${line.estimate}); retry with the same key replayed=${again.replayed} same id=${again.value.id == issued.value.id}');
    expect(isTicketCode(issued.value.code), isTrue);
    expect(again.value.id, issued.value.id);

    // ---- the counter terminal finds it by code
    final found = await counter.weighTicketByCode(issued.value.code);
    final resolved = await counter.counterResolve(issued.value.code);
    print('counter by-code: ${found.code} ${found.status} total ${found.total}, ${found.lines.length} line(s); '
        'counter/resolve weighTicket=${resolved.weighTicket?.code}');
    expect(found.id, issued.value.id);
    expect(found.status, 'open');

    // ---- tidy up: cancel the ticket, lock both
    await weigh.cancelWeighTicket(issued.value.id, idempotencyKey: keys.next());
    try {
      await counter.weighTicketByCode(issued.value.code);
    } on ApiException catch (e) {
      print('after cancel, by-code: ${e.status} ${e.code}');
    }
    try {
      final stray = _client()..client.token = counter.client.token;
      await stray.posCatalog();
    } on ApiException catch (e) {
      print('PIN token without the device token: ${e.status} ${e.code}');
    }
    await counter.posLock();
    await weigh.posLock();
    try {
      await counter.posCatalog();
    } on ApiException catch (e) {
      print('after lock, catalogue: ${e.status} ${e.code}');
    }
    weighCatalog.dispose();
    catalog.dispose();
  }, skip: _api == null || _env['SRIKIT_LIVE_EMAIL'] == null ? 'set SRIKIT_LIVE_API and SRIKIT_LIVE_EMAIL' : false, timeout: const Timeout(Duration(minutes: 3)));
}
