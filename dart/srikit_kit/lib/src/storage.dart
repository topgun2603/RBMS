import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:srikit_api/srikit_api.dart';

/// Small string key-value store. [SecureKeyValueStore] on devices, [MemoryKeyValueStore] in tests.
abstract interface class KeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Keychain (iOS) / Keystore-backed (Android) storage through flutter_secure_storage.
class SecureKeyValueStore implements KeyValueStore {
  SecureKeyValueStore([FlutterSecureStorage? storage]) : _s = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _s;

  @override
  Future<String?> read(String key) => _s.read(key: key);
  @override
  Future<void> write(String key, String value) => _s.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _s.delete(key: key);
}

class MemoryKeyValueStore implements KeyValueStore {
  MemoryKeyValueStore([Map<String, String>? initial]) : values = {...?initial};
  final Map<String, String> values;

  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// What the app keeps between launches. Everything goes in secure storage: the token must, and the shop slug and
/// language are tiny, so one store keeps the dependencies down.
class SessionStore {
  SessionStore(this.store);
  final KeyValueStore store;

  static const tokenKey = 'srikit.session.token';
  static const shopKey = 'srikit.session.shop';
  static const localeKey = 'srikit.locale';
  static const deviceIdKey = 'srikit.device.id';

  Future<String>? _deviceId;

  Future<String?> token() => store.read(tokenKey);
  Future<void> saveToken(String token) => store.write(tokenKey, token);
  Future<void> clearToken() => store.delete(tokenKey);

  /// Slug of the last shop picked.
  Future<String?> lastShop() => store.read(shopKey);
  Future<void> saveLastShop(String slug) => store.write(shopKey, slug);
  Future<void> clearLastShop() => store.delete(shopKey);

  Future<String?> locale() => store.read(localeKey);
  Future<void> saveLocale(String code) => store.write(localeKey, code);

  /// A random id for this install (32 hex digits), made on first use and kept across sign-outs. Used as the prefix
  /// of Idempotency-Keys. Reinstalling the app (or clearing its data) makes a new one.
  Future<String> deviceId() => _deviceId ??= _loadDeviceId();

  Future<String> _loadDeviceId() async {
    final saved = await store.read(deviceIdKey);
    if (saved != null && RegExp(r'^[0-9a-f]{32}$').hasMatch(saved)) return saved;
    final id = uuidV4().replaceAll('-', '');
    await store.write(deviceIdKey, id);
    return id;
  }

  static const posDeviceTokenKey = 'srikit.pos.deviceToken';
  static const posOriginKey = 'srikit.pos.origin';

  /// The POS terminal this phone is paired to: its device token (sent as `x-device-token`) and the API origin it was
  /// paired with (a pairing QR may name another API than the build's). Null = not a terminal.
  Future<SavedTerminal?> savedTerminal() async {
    final token = await store.read(posDeviceTokenKey);
    if (token == null || token.isEmpty) return null;
    return SavedTerminal(deviceToken: token, origin: await store.read(posOriginKey));
  }

  Future<void> saveTerminal(String deviceToken, {String? origin}) async {
    await store.write(posDeviceTokenKey, deviceToken);
    if (origin != null && origin.isNotEmpty) {
      await store.write(posOriginKey, origin);
    } else {
      await store.delete(posOriginKey);
    }
  }

  /// Unpaired (or the server said `device_not_paired`): the phone is no longer a terminal.
  Future<void> clearTerminal() async {
    await store.delete(posDeviceTokenKey);
    await store.delete(posOriginKey);
  }

  /// Key maker for this device: call `next()` once per user action and reuse that key for its retries.
  Future<IdempotencyKeys> idempotencyKeys() async => IdempotencyKeys(await deviceId());
}

/// A saved terminal pairing (see [SessionStore.savedTerminal]).
class SavedTerminal {
  const SavedTerminal({required this.deviceToken, this.origin});
  final String deviceToken;

  /// API origin the terminal was paired with; null = the build's.
  final String? origin;
}
