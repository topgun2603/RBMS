// Pairing codes and QR payloads (docs/pos-terminals.md), ported from packages/pos-ui/src/lib/pairing.ts.

import 'package:srikit_api/srikit_api.dart';

/// Characters a pairing code is made of (no 0 / 1 / I / L / O).
const pairingAlphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const _codeLength = 8;

/// Upper-cases and drops spaces / dashes. The 8 code characters, or null when it can't be a code.
String? normalizePairingCode(String input) {
  final raw = input.toUpperCase().replaceAll(RegExp(r'[\s-]+'), '');
  if (raw.length != _codeLength) return null;
  for (final ch in raw.split('')) {
    if (!pairingAlphabet.contains(ch)) return null;
  }
  return raw;
}

/// As the person types: upper case, only code characters, a dash after 4 (`abcd23` → `ABCD-23`).
String formatPairingInput(String input) {
  final raw = input.toUpperCase().split('').where(pairingAlphabet.contains).take(_codeLength).join();
  return raw.length > 4 ? '${raw.substring(0, 4)}-${raw.substring(4)}' : raw;
}

/// `ABCD2345` → `ABCD-2345`.
String displayPairingCode(String code) {
  final raw = code.replaceAll('-', '').toUpperCase();
  return raw.length > 4 ? '${raw.substring(0, 4)}-${raw.substring(4)}' : raw;
}

/// A scanned pairing QR: the API [origin] it belongs to (empty for a bare code) and the [code].
class PairingQr {
  const PairingQr(this.origin, this.code);
  final String origin;
  final String code;

  @override
  bool operator ==(Object other) => other is PairingQr && other.origin == origin && other.code == code;
  @override
  int get hashCode => Object.hash(origin, code);
  @override
  String toString() => 'PairingQr($origin, $code)';
}

/// `srikit-pair:1:<apiOrigin>:<code>` → origin + code; a bare code is accepted too (origin ""). Null otherwise, and
/// for an origin that is not an http(s) URL.
PairingQr? parsePairingQr(String text) {
  final t = text.trim();
  const prefix = 'srikit-pair:1:';
  if (t.toLowerCase().startsWith(prefix)) {
    final rest = t.substring(prefix.length);
    final at = rest.lastIndexOf(':');
    if (at <= 0) return null;
    final code = normalizePairingCode(rest.substring(at + 1));
    final origin = rest.substring(0, at).replaceFirst(RegExp(r'/+$'), '');
    final uri = Uri.tryParse(origin);
    if (code == null || uri == null || !(uri.scheme == 'http' || uri.scheme == 'https') || uri.host.isEmpty) return null;
    return PairingQr(origin, code);
  }
  final code = normalizePairingCode(t);
  return code == null ? null : PairingQr('', code);
}

/// The API origin to pair against: the QR's when it names one that differs from the build's, else the build's.
/// Null = keep the build's.
String? pairingOrigin(PairingQr qr, String buildOrigin) {
  if (qr.origin.isEmpty) return null;
  String norm(String s) => s.replaceFirst(RegExp(r'/+$'), '').toLowerCase();
  return norm(qr.origin) == norm(buildOrigin) ? null : qr.origin;
}

enum PairError { format, invalid, tooMany, network, featureOff, other }

/// What went wrong with POST /pos/pair.
PairError pairErrorOf(Object error) {
  if (error is! ApiException) return PairError.other;
  if (error.status == 0 || error.status == 502 || error.status == 503 || error.status == 504) return PairError.network;
  if (error.code == 'pairing_code_invalid') return PairError.invalid;
  if (error.code == 'too_many_attempts' || error.status == 429) return PairError.tooMany;
  if (error.code == 'feature_disabled' || error.code == 'plan_limit') return PairError.featureOff;
  return PairError.other;
}
