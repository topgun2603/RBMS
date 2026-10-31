import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_kit/srikit_kit.dart';

void main() {
  test('a terminal pairing is saved with its origin, survives a new SessionStore and is cleared on unpair', () async {
    final store = MemoryKeyValueStore();
    final s = SessionStore(store);
    expect(await s.savedTerminal(), isNull);
    await s.saveTerminal('dev-token', origin: 'https://api.rbms.in');
    final t = (await SessionStore(store).savedTerminal())!;
    expect(t.deviceToken, 'dev-token');
    expect(t.origin, 'https://api.rbms.in');
    await s.saveTerminal('dev-2'); // paired again with the build's API
    expect((await s.savedTerminal())!.origin, isNull);
    final id = await s.deviceId();
    await s.clearTerminal();
    expect(await s.savedTerminal(), isNull);
    expect(await s.deviceId(), id); // the install id stays
  });
}
