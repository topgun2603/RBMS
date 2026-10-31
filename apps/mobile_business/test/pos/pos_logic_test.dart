import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/src/pos/catalog.dart';
import 'package:srikit_business/src/pos/idle_lock.dart';
import 'package:srikit_business/src/pos/pairing.dart';
import 'package:srikit_business/src/pos/pin_pad.dart';

import '../fake_api.dart';
import '../fake_pos.dart';

/// A SrikitApi paired to the fake's counter terminal and unlocked with the owner's PIN.
Future<(SrikitApi, FakeSrikitServer)> unlockedApi() async {
  final server = FakeSrikitServer();
  final api = SrikitApi(server.apiClient());
  final pair = await api.posPair('ABCD-2345', const PosDeviceDescription(platform: 'android'));
  api.client.deviceToken = pair.value.deviceToken;
  api.client.token = (await api.posSession('8023')).token;
  return (api, server);
}

void main() {
  group('pairing QR', () {
    test('srikit-pair:1:<origin>:<code> gives the origin and the code', () {
      expect(parsePairingQr('srikit-pair:1:https://api.rbms.in:ABCD-2345'), const PairingQr('https://api.rbms.in', 'ABCD2345'));
      // An origin with a port: the code is after the last colon.
      expect(parsePairingQr(' SRIKIT-PAIR:1:http://192.168.1.20:4000:abcd2345 '), const PairingQr('http://192.168.1.20:4000', 'ABCD2345'));
    });

    test('a bare code is accepted (case-insensitive, dash optional); anything else is not', () {
      expect(parsePairingQr('abcd-2345'), const PairingQr('', 'ABCD2345'));
      expect(parsePairingQr('ABCD2345'), const PairingQr('', 'ABCD2345'));
      expect(parsePairingQr('ABCD-234'), isNull); // 7 characters
      expect(parsePairingQr('ABCD-2340'), isNull); // 0 is not in the alphabet
      expect(parsePairingQr('srikit-pair:1:ABCD2345'), isNull); // no origin
      expect(parsePairingQr('srikit-pair:1:ftp://x.in:ABCD2345'), isNull); // not http(s)
      expect(parsePairingQr('srikit-pair:2:https://a.in:ABCD2345'), isNull); // unknown version
      expect(parsePairingQr('https://example.com'), isNull);
    });

    test("the QR's origin is used only when it differs from the build's", () {
      final qr = parsePairingQr('srikit-pair:1:https://api.rbms.in/:ABCD2345')!;
      expect(pairingOrigin(qr, 'https://api.rbms.in'), isNull);
      expect(pairingOrigin(qr, 'http://10.0.2.2:4000'), 'https://api.rbms.in');
      expect(pairingOrigin(parsePairingQr('ABCD2345')!, 'http://10.0.2.2:4000'), isNull);
    });

    test('typing formats the code', () {
      expect(formatPairingInput('abcd23'), 'ABCD-23');
      expect(formatPairingInput('ab-cd 2345 99'), 'ABCD-2345');
      expect(formatPairingInput('a0o1'), 'A');
      expect(displayPairingCode('abcd2345'), 'ABCD-2345');
    });

    test('pair errors', () {
      expect(pairErrorOf(const ApiException(400, 'pairing_code_invalid', '')), PairError.invalid);
      expect(pairErrorOf(const ApiException(429, 'too_many_attempts', '')), PairError.tooMany);
      expect(pairErrorOf(const ApiException(403, 'feature_disabled', '')), PairError.featureOff);
      expect(pairErrorOf(const ApiException(0, 'network', '')), PairError.network);
    });
  });

  group('PIN pad', () {
    test('digits up to 6, back, clear; complete from 4', () {
      var p = const PinPad();
      for (final d in '80231'.split('')) {
        p = p.digit(d);
      }
      expect(p.digits, '80231');
      expect(p.complete, isTrue);
      p = p.digit('9').digit('7');
      expect(p.digits, '802319'); // max 6
      p = p.digit('x');
      expect(p.digits, '802319');
      p = p.back().back().back();
      expect(p.digits, '802');
      expect(p.complete, isFalse);
      expect(p.clear().digits, '');
      expect(const PinPad().back().digits, '');
    });

    test('pin_invalid keeps the tries left; pin_locked counts down and closes the pad', () {
      final t0 = DateTime.utc(2026, 10, 22, 10);
      final wrong = unlockProblemOf(const ApiException(401, 'pin_invalid', 'Wrong PIN', details: {'remaining': 2}), t0);
      expect(wrong.kind, UnlockKind.invalid);
      expect(wrong.remaining, 2);
      expect(padDisabled(wrong, false, t0), isFalse);

      final locked = unlockProblemOf(const ApiException(429, 'pin_locked', '', details: {'retryAfterSeconds': 300}), t0);
      expect(locked.kind, UnlockKind.locked);
      expect(locked.secondsLeft(t0), 300);
      expect(formatCountdown(locked.secondsLeft(t0.add(const Duration(milliseconds: 1500)))), '4:59');
      expect(padDisabled(locked, false, t0.add(const Duration(minutes: 4))), isTrue);
      expect(locked.secondsLeft(t0.add(const Duration(minutes: 5))), 0);
      expect(padDisabled(locked, false, t0.add(const Duration(minutes: 5))), isFalse);
      // A 429 without the code still locks (default 5 min).
      expect(unlockProblemOf(const ApiException(429, 'too_many_attempts', ''), t0).secondsLeft(t0), 300);
      expect(unlockProblemOf(const ApiException(403, 'pin_not_allowed', ''), t0).kind, UnlockKind.notAllowed);
      expect(unlockProblemOf(const ApiException(401, 'device_not_paired', ''), t0).kind, UnlockKind.unpaired);
      expect(padDisabled(null, true, t0), isTrue); // busy
    });
  });

  group('idle auto-lock', () {
    testWidgets('locks after lockAfterMinutes without a touch; a touch restarts the wait', (tester) async {
      var locks = 0;
      final idle = IdleLock(onLock: () => locks++, lockAfter: const Duration(minutes: 5))..start();
      await tester.pump(const Duration(minutes: 4));
      idle.touch();
      await tester.pump(const Duration(minutes: 4));
      expect(locks, 0);
      await tester.pump(const Duration(minutes: 1, seconds: 1));
      expect(locks, 1);
      expect(idle.armed, isFalse);
      await tester.pump(const Duration(minutes: 10));
      expect(locks, 1); // once
      idle.dispose();
    });

    testWidgets('back from the background after that long locks at once; a short trip does not', (tester) async {
      var now = DateTime.utc(2026, 10, 22, 10);
      var locks = 0;
      final idle = IdleLock(onLock: () => locks++, lockAfter: const Duration(minutes: 2), now: () => now)..start();
      idle.paused();
      now = now.add(const Duration(minutes: 1));
      idle.resumed();
      expect(locks, 0);
      idle.paused();
      now = now.add(const Duration(minutes: 3));
      idle.resumed();
      expect(locks, 1);
      idle.dispose();
    });

    test('lockAfter is clamped to 1..60 minutes', () {
      expect(IdleLock(onLock: () {}, lockAfter: Duration.zero).lockAfter, const Duration(minutes: 1));
      expect(IdleLock(onLock: () {}, lockAfter: const Duration(hours: 3)).lockAfter, const Duration(minutes: 60));
    });
  });

  group('catalogue sync', () {
    test('full, then a delta with changes and removed ids; inactive items leave; 304 changes nothing', () async {
      final (api, server) = await unlockedApi();
      final store = MemoryCatalogStore();
      final c = PosCatalog(api: api, store: store);
      await c.sync(rethrowErrors: true);
      expect(c.count, 5);
      expect(c.lastChange!.replace, isTrue);
      expect(c.snapshot.cursor, 'c1');
      expect(c.categories.map((x) => x.name), ['Vegetables', 'Grains']);
      expect(store.saved!.items.length, 5);
      final first = server.pos.requests.where((r) => r.url.path == '/v1/pos/catalog').last;
      expect(first.url.queryParameters.containsKey('since'), isFalse);

      // Nothing changed: the first delta (since c1) is empty and its ETag is kept; the next one is a 304.
      await c.sync(rethrowErrors: true);
      expect(c.lastChange!.changed, isFalse);
      expect(c.snapshot.etag, isNotNull);
      final writes = store.writes;
      await c.sync(rethrowErrors: true);
      expect(store.writes, writes); // nothing to save
      expect(c.lastChange!.notModified, isTrue);
      expect(server.pos.requests.where((r) => r.url.path == '/v1/pos/catalog').last.headers['if-none-match'], isNotNull);
      expect(c.count, 5);

      server.pos.touch(FakePos.item('i-rice', 'Ponni Rice 5 kg', price: 33000, sku: 'RICE5', barcodes: const ['8901000000011'], gst: 5));
      server.pos.touch(FakePos.item('i-new', 'Jaggery', price: 9000, barcodes: const ['8902']));
      server.pos.remove('i-onion');
      server.pos.touch(FakePos.item('i-coconut', 'Coconut', price: 3500, active: false));
      await c.sync(rethrowErrors: true);
      final delta = server.pos.requests.where((r) => r.url.path == '/v1/pos/catalog').last;
      expect(delta.url.queryParameters['since'], 'c1');
      expect(c.lastChange!.replace, isFalse);
      expect(c.snapshot.items['i-rice']!.price, 33000);
      expect(c.snapshot.items.containsKey('i-new'), isTrue);
      expect(c.snapshot.items.containsKey('i-onion'), isFalse);
      expect(c.snapshot.items.containsKey('i-coconut'), isFalse);
      expect(c.count, 4);
      expect(c.snapshot.cursor, 'c${server.pos.rev}');
      expect(c.index.findByCode('8902')!.name, 'Jaggery');
    });

    test('pages with next (later pages send after alone) and full: true replaces the cache', () async {
      final (api, server) = await unlockedApi();
      server.pos.pageLimit = 2;
      final pages = <Map<String, String>>[];
      final change = await fetchCatalogChange(({since, after, limit, etag}) async {
        final p = await api.posCatalog(since: since, after: after, limit: limit, etag: etag);
        pages.add(server.pos.requests.last.url.queryParameters);
        return p;
      });
      expect(change.pages, 3);
      expect(change.upserts.length, 5);
      expect(pages[0], {'limit': '1000'});
      expect(pages[1].keys.toSet(), {'after', 'limit'});
      expect(pages[2].keys.toSet(), {'after', 'limit'});

      // A stale cache (an item the server no longer has) is dropped by a full answer.
      final stale = CatalogSnapshot(items: {'gone': const PosItem(itemId: 'gone', name: 'Old', price: 1, taxInclusive: true, gstRate: 0)});
      final next = applyCatalogChange(stale, change, now: DateTime.now());
      expect(next.items.containsKey('gone'), isFalse);
      expect(next.items.length, 5);
    });

    test('a failure half-way keeps the previous cache', () async {
      final (api, server) = await unlockedApi();
      final c = PosCatalog(api: api, store: MemoryCatalogStore());
      await c.sync();
      server.pos.touch(FakePos.item('i-new', 'Jaggery', price: 9000));
      api.client.token = 'expired';
      await c.sync();
      expect(c.lastError, isA<ApiException>());
      expect(c.count, 5);
      expect(c.snapshot.cursor, 'c1');
    });
  });

  group('local search', () {
    final index = CatalogIndex([
      const PosItem(itemId: 'a', name: 'Soap Bar', sku: '8901', price: 1, taxInclusive: true, gstRate: 0),
      const PosItem(itemId: 'b', name: 'Detergent', barcodes: ['8901', '777'], price: 1, taxInclusive: true, gstRate: 0),
      const PosItem(itemId: 'c', name: 'Rice 8901 Special', sku: 'RICE', price: 1, taxInclusive: true, gstRate: 0, plu: '0042', soldBy: 'weight', unit: 'kg', categoryId: 'g'),
      const PosItem(itemId: 'd', name: 'Brown Rice', price: 1, taxInclusive: true, gstRate: 0, categoryId: 'g'),
      const PosItem(itemId: 'e', name: 'Hidden', price: 1, taxInclusive: true, gstRate: 0, active: false, barcodes: ['999']),
    ]);

    test('a code: any barcode first, then SKU (any case), then PLU', () {
      expect(index.findByCode('8901')!.itemId, 'b'); // barcode beats the SKU "8901" of another item
      expect(index.findByCode('777')!.itemId, 'b'); // second barcode
      expect(index.findByCode('rice')!.itemId, 'c'); // SKU, case-insensitive
      expect(index.findByCode('42')!.itemId, 'c'); // PLU, leading zeros ignored
      expect(index.findByCode('999'), isNull); // inactive
    });

    test('search ranks barcode → SKU → name prefix → the rest', () {
      expect(index.search('8901').map((i) => i.itemId), ['b', 'a', 'c']);
      expect(index.search('rice').map((i) => i.itemId), ['c', 'd']); // SKU match, then "Brown Rice"
      expect(index.search('ri').map((i) => i.itemId), ['c', 'd']); // prefix, then contains
      expect(index.search('rice brown').map((i) => i.itemId), ['d']); // every word
      expect(index.search('', categoryId: 'g').map((i) => i.itemId), ['d', 'c']);
      expect(index.search('', weightFirst: true).first.itemId, 'c');
    });
  });

  test('JSON file store: round trip, and ~5k items load fast enough (prints the numbers)', () async {
    final dir = await Directory.systemTemp.createTemp('pos_catalog');
    addTearDown(() => dir.delete(recursive: true));
    final store = JsonFileCatalogStore(dir, 'shop-1');
    expect(await store.read(), isNull);
    final items = {
      for (var i = 0; i < 5000; i++)
        'item-$i': PosItem(
          itemId: '00000000-0000-4000-8000-${i.toString().padLeft(12, '0')}',
          productId: 'p-$i',
          name: 'Product number $i – Variant ${i % 7}',
          variantTitle: 'Variant ${i % 7}',
          sku: 'SKU$i',
          barcodes: ['890${i.toString().padLeft(10, '0')}'],
          categoryId: 'cat-${i % 20}',
          price: 1000 + i,
          mrp: 1200 + i,
          taxInclusive: true,
          gstRate: 5,
          hsn: '1006',
          unit: i % 10 == 0 ? 'kg' : 'pcs',
          soldBy: i % 10 == 0 ? 'weight' : 'unit',
          plu: i % 10 == 0 ? '$i' : null,
          stock: const PosItemStock(qty: 12, status: 'ok'),
          updatedAt: DateTime.utc(2026, 10, 22),
        ),
    };
    final snap = CatalogSnapshot(items: {for (final i in items.values) i.itemId: i}, cursor: 'c9', etag: '"e"', syncedAt: DateTime.utc(2026));
    final sw = Stopwatch()..start();
    await store.write(snap);
    final writeMs = sw.elapsedMilliseconds;
    sw.reset();
    final back = (await store.read())!;
    final readMs = sw.elapsedMilliseconds;
    sw.reset();
    final index = CatalogIndex(back.items.values);
    final indexMs = sw.elapsedMilliseconds;
    sw.reset();
    for (var i = 0; i < 20; i++) {
      index.search('product ${i * 37}');
    }
    final searchMs = sw.elapsedMilliseconds / 20;
    final bytes = await store.file.length();
    // ignore: avoid_print
    print('catalog store, 5000 items: ${(bytes / 1024).round()} KB, write ${writeMs}ms, read+parse ${readMs}ms, '
        'index ${indexMs}ms, search ${searchMs.toStringAsFixed(1)}ms');
    expect(back.items.length, 5000);
    expect(back.cursor, 'c9');
    expect(back.etag, '"e"');
    expect(jsonEncode(back.items.values.first.toJson()), jsonEncode(items.values.first.toJson()));
    expect(index.findByCode('8900000004321')!.sku, 'SKU4321');
    await store.clear();
    expect(await store.read(), isNull);
  });
}
