import 'dart:async';

/// Locks an unlocked terminal after [lockAfter] without a touch (Terminal `settings.lockAfterMinutes`), and when the
/// app comes back from the background after being away that long.
///
/// [touch] on every pointer event restarts the timer; [paused] / [resumed] follow the app lifecycle (timers may not
/// run in the background, so the time away is measured with [now]).
class IdleLock {
  IdleLock({required this.onLock, Duration lockAfter = const Duration(minutes: 5), DateTime Function()? now})
      : _lockAfter = _clamp(lockAfter),
        _now = now ?? DateTime.now;

  final void Function() onLock;
  final DateTime Function() _now;
  Duration _lockAfter;
  Timer? _timer;
  DateTime? _pausedAt;
  bool _armed = false;

  static Duration _clamp(Duration d) {
    if (d < const Duration(minutes: 1)) return const Duration(minutes: 1);
    if (d > const Duration(minutes: 60)) return const Duration(minutes: 60);
    return d;
  }

  Duration get lockAfter => _lockAfter;
  bool get armed => _armed;

  set lockAfter(Duration d) {
    _lockAfter = _clamp(d);
    if (_armed) touch();
  }

  /// Unlocked: start counting.
  void start() {
    _armed = true;
    _pausedAt = null;
    touch();
  }

  /// Locked: nothing to count.
  void stop() {
    _armed = false;
    _timer?.cancel();
    _timer = null;
    _pausedAt = null;
  }

  void touch() {
    if (!_armed) return;
    _timer?.cancel();
    _timer = Timer(_lockAfter, _fire);
  }

  void paused() {
    if (_armed) _pausedAt = _now();
  }

  void resumed() {
    final at = _pausedAt;
    _pausedAt = null;
    if (!_armed || at == null) return;
    if (_now().difference(at) >= _lockAfter) {
      _fire();
    } else {
      touch();
    }
  }

  void _fire() {
    if (!_armed) return;
    stop();
    onLock();
  }

  void dispose() => stop();
}
