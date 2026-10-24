// The lock screen's PIN pad and unlock errors (packages/pos-ui/src/lib/pin.ts). Pure; the server is the last word.

import 'package:srikit_api/srikit_api.dart';

const pinMin = 4;
const pinMax = 6;

/// Digits typed so far (never shown, only as dots).
class PinPad {
  const PinPad([this.digits = '']);
  final String digits;

  PinPad digit(String d) => RegExp(r'^\d$').hasMatch(d) && digits.length < pinMax ? PinPad(digits + d) : this;
  PinPad back() => digits.isEmpty ? this : PinPad(digits.substring(0, digits.length - 1));
  PinPad clear() => const PinPad();

  /// 4–6 digits: OK may be pressed.
  bool get complete => digits.length >= pinMin;
  int get length => digits.length;
}

enum UnlockKind { invalid, locked, notAllowed, unpaired, network, other }

/// Why POST /pos/session failed, for the lock screen.
class UnlockProblem {
  const UnlockProblem(this.kind, {this.remaining, this.until, this.message = ''});
  final UnlockKind kind;

  /// `pin_invalid`: tries left before the lockout.
  final int? remaining;

  /// `pin_locked`: when the pad opens again.
  final DateTime? until;
  final String message;

  /// Whole seconds left on a lockout (0 when over or not locked).
  int secondsLeft(DateTime now) {
    final u = until;
    if (kind != UnlockKind.locked || u == null) return 0;
    final ms = u.difference(now).inMilliseconds;
    return ms <= 0 ? 0 : (ms / 1000).ceil();
  }
}

int? _num(Object? v) => v is num ? v.toInt() : null;

UnlockProblem unlockProblemOf(Object error, DateTime now) {
  if (error is! ApiException) return const UnlockProblem(UnlockKind.other);
  final details = error.details is Map ? error.details as Map : const {};
  if (error.status == 0 || error.status == 502 || error.status == 503 || error.status == 504) {
    return const UnlockProblem(UnlockKind.network);
  }
  UnlockProblem locked() =>
      UnlockProblem(UnlockKind.locked, until: now.add(Duration(seconds: _num(details['retryAfterSeconds']) ?? 300)));
  switch (error.code) {
    case 'pin_invalid':
      return UnlockProblem(UnlockKind.invalid, remaining: _num(details['remaining']));
    case 'pin_locked':
      return locked();
    case 'pin_not_allowed':
      return const UnlockProblem(UnlockKind.notAllowed);
    case 'device_not_paired':
      return const UnlockProblem(UnlockKind.unpaired);
  }
  if (error.status == 429) return locked();
  return UnlockProblem(UnlockKind.other, message: error.message);
}

/// 299 → `4:59`.
String formatCountdown(int seconds) {
  final s = seconds < 0 ? 0 : seconds;
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

/// The pad is usable: not while a lockout runs or a request is in flight.
bool padDisabled(UnlockProblem? problem, bool busy, DateTime now) =>
    busy || (problem != null && problem.secondsLeft(now) > 0);
