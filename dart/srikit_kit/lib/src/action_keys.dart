import 'package:srikit_api/srikit_api.dart';

import 'storage.dart';

/// One Idempotency-Key per user action, reused until that action succeeds.
///
/// Name the action by what it does and to what (`order.status:<id>:shipped`, `pay:<bill>:0:cash:64000`): the same
/// action retried after a failure — a dropped connection, a lost answer — sends the same key, so the server does it
/// once and replays its answer; a different action gets a new key.
class ActionKeys {
  ActionKeys(this.session);
  final SessionStore session;

  final Map<String, String> _keys = {};
  IdempotencyKeys? _maker;

  /// Keys whose action hasn't succeeded yet.
  Map<String, String> get pending => Map.unmodifiable(_keys);

  /// Runs [run] with the key for [action]; the key is forgotten once [run] succeeds.
  Future<T> once<T>(String action, Future<T> Function(String key) run) async {
    _maker ??= await session.idempotencyKeys();
    final key = _keys[action] ??= _maker!.next();
    final result = await run(key);
    _keys.remove(action);
    return result;
  }

  /// Drops the key of an action that will not be retried (the user gave up or changed it).
  void forget(String action) => _keys.remove(action);
}
