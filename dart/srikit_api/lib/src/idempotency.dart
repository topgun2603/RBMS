import 'dart:math';

final _keyRe = RegExp(r'^[A-Za-z0-9_.:-]{8,128}$');

/// The API's `Idempotency-Key` rule (packages/idempotency `KEY_RE`): 8–128 letters, digits or `_ . : -`.
bool isValidIdempotencyKey(String key) => _keyRe.hasMatch(key);

/// A random UUID v4 (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`) from a secure random source.
String uuidV4([Random? random]) {
  final r = random ?? Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

/// Makes Idempotency-Keys `<deviceId>:<uuid v4>`.
///
/// Make one key per user action (one bill, one payment) and reuse it for every retry of that action; never reuse it
/// for anything else (the API answers 422 `idempotency_key_reused`). The device id keeps keys from two phones apart in
/// logs; uniqueness comes from the UUID.
class IdempotencyKeys {
  IdempotencyKeys(this.deviceId, {Random? random}) : _random = random ?? Random.secure() {
    if (!RegExp(r'^[A-Za-z0-9_.-]{1,64}$').hasMatch(deviceId)) {
      throw ArgumentError.value(deviceId, 'deviceId', 'must be 1–64 of [A-Za-z0-9_.-]');
    }
  }

  final String deviceId;
  final Random _random;

  String next() => '$deviceId:${uuidV4(_random)}';
}
