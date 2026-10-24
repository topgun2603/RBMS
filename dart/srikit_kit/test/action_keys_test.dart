import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

void main() {
  test('one key per action, reused until it succeeds; a new action gets a new key', () async {
    final keys = ActionKeys(SessionStore(MemoryKeyValueStore()));
    final seen = <String>[];
    var fail = true;
    Future<int> run(String k) async {
      seen.add(k);
      if (fail) throw const ApiException(0, ApiException.networkCode, 'offline');
      return 1;
    }

    await expectLater(keys.once('order.status:o1:shipped', run), throwsA(isA<ApiException>()));
    expect(keys.pending, hasLength(1));
    fail = false;
    await keys.once('order.status:o1:shipped', run);
    expect(seen[0], seen[1]);
    expect(keys.pending, isEmpty);
    await keys.once('order.status:o1:delivered', run);
    expect(seen[2], isNot(seen[1]));
    expect(isValidIdempotencyKey(seen[2]), isTrue);
  });

  test('forget drops a pending key', () async {
    final keys = ActionKeys(SessionStore(MemoryKeyValueStore()));
    await expectLater(keys.once<void>('a', (_) async => throw StateError('x')), throwsStateError);
    keys.forget('a');
    expect(keys.pending, isEmpty);
  });
}
