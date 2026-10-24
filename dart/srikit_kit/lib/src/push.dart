import 'package:srikit_api/srikit_api.dart';

/// Where the device push token comes from.
///
/// TODO(fcm): implement with firebase_messaging (`FirebaseMessaging.instance.getToken()`, `onTokenRefresh`, the
/// notification permission prompt on Android 13+ / iOS). Until then [NoPushTokenSource] is used and nothing is sent.
abstract interface class PushTokenSource {
  /// The current token, or null when push isn't available.
  Future<String?> token();

  /// `android` or `ios` (the app values POST /v1/notify/push-tokens accepts).
  String get platform;
}

class NoPushTokenSource implements PushTokenSource {
  const NoPushTokenSource([this.platform = 'android']);
  @override
  final String platform;
  @override
  Future<String?> token() async => null;
}

/// Registers the device token after a shop is picked and removes it on sign-out. Failures are swallowed: push must
/// never block signing in or out.
class PushRegistrar {
  PushRegistrar(this.api, this.source);
  final SrikitApi api;
  final PushTokenSource source;
  String? _registered;

  /// Call with the shop already set on the client: the API stores the token for the `x-tenant` shop.
  Future<void> register() async {
    try {
      final t = await source.token();
      if (t == null) return;
      await api.registerPushToken(t, source.platform);
      _registered = t;
    } catch (_) {}
  }

  Future<void> unregister() async {
    try {
      final t = _registered ?? await source.token();
      if (t == null) return;
      await api.removePushToken(t);
    } catch (_) {}
    _registered = null;
  }
}
