import 'package:srikit_api/srikit_api.dart';

import 'push.dart';
import 'storage.dart';

/// Owns the session token: restores it at launch, saves it after sign-in, drops it on sign-out.
class AuthRepository {
  AuthRepository({required this.api, required this.session, PushRegistrar? push}) : push = push ?? PushRegistrar(api, const NoPushTokenSource());

  final SrikitApi api;
  final SessionStore session;
  final PushRegistrar push;

  ApiClient get _client => api.client;

  /// The saved session's user, or null when there is none or the server no longer accepts it (401: the token is
  /// deleted). Network and server errors are rethrown with the token kept, so the app can offer a retry instead of
  /// signing the user out while offline.
  Future<Me?> restore() async {
    final token = await session.token();
    if (token == null || token.isEmpty) return null;
    _client.token = token;
    try {
      return await api.me();
    } on ApiException catch (e) {
      if (e.isUnauthorized) {
        await _forget();
        return null;
      }
      rethrow;
    }
  }

  /// Phone sign-in config (`GET /v1/auth/config`).
  Future<AuthClientConfig> config() => api.authConfig();

  /// Stores the session from a sign-in answer and makes the client use it.
  Future<void> completeSignIn(SignInResult result) async {
    _client.token = result.token;
    await session.saveToken(result.token);
  }

  /// Current user with roles and permissions for the client's `x-tenant` shop.
  Future<Me> me() => api.me();

  /// Removes the push token, ends the server session (best effort) and forgets the token and last shop locally.
  /// Never throws: the user is signed out on this device even when offline.
  Future<void> signOut() async {
    if (_client.token != null) {
      await push.unregister();
      try {
        await api.logout();
      } catch (_) {}
    }
    await _forget();
    await session.clearLastShop();
  }

  Future<void> _forget() async {
    _client.token = null;
    _client.tenant = null;
    await session.clearToken();
  }
}
