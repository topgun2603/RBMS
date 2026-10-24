// Weigh tickets and the weighing station (docs/pos-terminals.md → Weigh tickets, Scale reading).

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import 'catalog.dart';

/// "W" + 11 digits (scanners may send lower case).
bool isTicketCode(String code) => RegExp(r'^W\d{11}$', caseSensitive: false).hasMatch(code.trim());
String normalizeTicketCode(String code) => code.trim().toUpperCase();

enum TicketProblemKind { notFound, used, expired, cancelled, duplicate, empty }

/// A ticket code that can't go on the bill.
class TicketProblem implements Exception {
  const TicketProblem(this.kind, this.code);
  final TicketProblemKind kind;
  final String code;

  @override
  String toString() => 'TicketProblem($kind, $code)';
}

/// GET /weigh-tickets/by-code failure → a [TicketProblem]; null for anything else (network, permission).
TicketProblem? ticketProblemOf(ApiException e, String code) => switch (e.code) {
      'ticket_not_found' => TicketProblem(TicketProblemKind.notFound, code),
      'ticket_used' => TicketProblem(TicketProblemKind.used, code),
      'ticket_expired' => TicketProblem(TicketProblemKind.expired, code),
      'ticket_cancelled' => TicketProblem(TicketProblemKind.cancelled, code),
      _ => e.status == 404
          ? TicketProblem(TicketProblemKind.notFound, code)
          : e.status == 410
              ? TicketProblem(TicketProblemKind.expired, code)
              : null,
    };

/// The counter resolver answers tickets in any state: check it can be billed.
TicketProblem? ticketStateProblem(WeighTicket t, DateTime now) {
  if (t.status == 'used') return TicketProblem(TicketProblemKind.used, t.code);
  if (t.status == 'cancelled') return TicketProblem(TicketProblemKind.cancelled, t.code);
  if (t.expired(now)) return TicketProblem(TicketProblemKind.expired, t.code);
  if (t.lines.isEmpty) return TicketProblem(TicketProblemKind.empty, t.code);
  return null;
}

// ---------------------------------------------------------------- scales

/// One weight from a scale, in kg. [stable] when the scale says the reading settled (manual entry always is).
class ScaleReading {
  const ScaleReading(this.kg, {this.stable = true});
  final double kg;
  final bool stable;
}

/// Where the weighing station gets weights from.
abstract interface class ScaleReader {
  /// Readings as they arrive.
  Stream<ScaleReading> get readings;

  /// The last reading (null before the first).
  ScaleReading? get current;

  /// Whether the reader needs the keypad (manual entry) instead of a connected scale.
  bool get manual;

  Future<void> close();
}

/// Weights typed on the station's keypad (the fallback the web also keeps). [enter] publishes a reading.
class ManualScaleReader implements ScaleReader {
  final _controller = StreamController<ScaleReading>.broadcast();
  ScaleReading? _current;

  @override
  Stream<ScaleReading> get readings => _controller.stream;
  @override
  ScaleReading? get current => _current;
  @override
  bool get manual => true;

  /// [kg] rounded to 3 decimals; ignored when negative or over 999.999.
  void enter(double kg) {
    if (kg.isNaN || kg < 0 || kg > 999.999) return;
    _current = ScaleReading((kg * 1000).round() / 1000);
    _controller.add(_current!);
  }

  void clear() => _current = null;

  @override
  Future<void> close() => _controller.close();
}

/// Bluetooth scales (TODO, not wired). A Bluetooth Low Energy / SPP scale streams weight lines like the serial
/// scales the web reads (`"  1.234kg"`, `"ST,GS,+  1.234kg"`; kg or g, `ST` = stable). Implementing it means: add a
/// BLE plugin (e.g. flutter_blue_plus) with the Android BLUETOOTH_SCAN / CONNECT permissions, pick and remember the
/// scale per terminal, parse each line into a [ScaleReading] (the same rules as pos-ui `scale-serial.ts`), and keep
/// [ManualScaleReader] as the fallback when the scale is off or out of range.
class BluetoothScaleReader implements ScaleReader {
  /// Not available yet: always throws [UnsupportedError].
  factory BluetoothScaleReader.connect(String deviceId) =>
      throw UnsupportedError('Bluetooth scales are not supported yet; use ManualScaleReader');

  @override
  Stream<ScaleReading> get readings => const Stream.empty();
  @override
  ScaleReading? get current => null;
  @override
  bool get manual => false;
  @override
  Future<void> close() async {}
}

/// `"1.234 kg"` and the like as typed: digits with up to 3 decimals. Null when it isn't a weight.
double? parseKg(String text) {
  final t = text.trim().replaceAll(',', '.');
  if (!RegExp(r'^\d{1,3}(\.\d{0,3})?$').hasMatch(t) && !RegExp(r'^\.\d{1,3}$').hasMatch(t)) return null;
  return double.tryParse(t.startsWith('.') ? '0$t' : t);
}

String kgText(double kg) => kg.toStringAsFixed(3);

// ---------------------------------------------------------------- the weighing station

/// A line waiting to go on the next ticket. By-weight items carry the gross [weightKg] and [tareKg]; count items a
/// [qty]. [estimate] is the screen's guess; the server prices the ticket.
class PendingWeighLine {
  const PendingWeighLine({required this.item, this.weightKg, this.tareKg = 0, this.qty});
  final PosItem item;
  final double? weightKg;
  final double tareKg;
  final double? qty;

  double get netKg => (((weightKg ?? 0) - tareKg) * 1000).round() / 1000;

  /// Price × net weight (or qty), rounded to the paisa. Only an estimate.
  int get estimate {
    final q = item.byWeight ? netKg : (qty ?? 0);
    final units = item.byWeight && _gramUnits.contains(item.unit.toLowerCase()) ? q * 1000 : q;
    return ((units * 1000).round() * item.price / 1000).round();
  }

  WeighTicketLineInput toInput() {
    if (!item.byWeight) return WeighTicketLineInput(itemId: item.itemId, qty: qty ?? 1);
    // Gram-priced items take grams as qty (the server's rule for unit g).
    if (_gramUnits.contains(item.unit.toLowerCase())) {
      return WeighTicketLineInput(itemId: item.itemId, qty: (netKg * 1000).roundToDouble());
    }
    return WeighTicketLineInput(itemId: item.itemId, weightKg: weightKg, tareKg: tareKg > 0 ? tareKg : null);
  }
}

const _gramUnits = {'g', 'gm', 'gms', 'gram', 'grams'};

/// Net weight must be > 0 and ≤ 999.999 kg (the server's rule).
bool validNet(double grossKg, double tareKg) {
  final net = grossKg - tareKg;
  return tareKg >= 0 && net > 0 && net <= 999.999;
}

/// The weighing station: lines for the next ticket, Issue (POST /weigh-tickets with an Idempotency-Key per ticket),
/// today's tickets, cancel.
class WeighingController extends ChangeNotifier {
  WeighingController({required this.api, required this.session, required this.catalog, ScaleReader? scale})
      : scale = scale ?? ManualScaleReader();

  final SrikitApi api;
  final SessionStore session;
  final PosCatalog catalog;
  final ScaleReader scale;
  late final ActionKeys _keys = ActionKeys(session);

  List<PendingWeighLine> lines = const [];
  int _version = 0;
  WeighTicket? lastIssued;
  List<WeighTicket> today = const [];
  bool loadingToday = false;
  Object? todayError;

  Map<String, String> get pendingKeys => _keys.pending;
  int get estimate => lines.fold(0, (s, l) => s + l.estimate);

  void add(PendingWeighLine l) {
    lines = [...lines, l];
    _version++;
    notifyListeners();
  }

  void removeAt(int i) {
    lines = [...lines]..removeAt(i);
    _version++;
    notifyListeners();
  }

  void clear() {
    lines = const [];
    _version++;
    notifyListeners();
  }

  /// Issues the ticket for the current lines. The same lines retried after a failure reuse their key.
  Future<WeighTicket> issue({String? note}) async {
    if (lines.isEmpty) throw StateError('Add a line first');
    final input = [for (final l in lines) l.toInput()];
    final r = await _keys.once('ticket.issue:$_version', (k) => api.createWeighTicket(input, note: note, idempotencyKey: k));
    lastIssued = r.value;
    lines = const [];
    _version++;
    today = [r.value, ...today.where((t) => t.id != r.value.id)];
    notifyListeners();
    return r.value;
  }

  Future<void> loadToday() async {
    loadingToday = true;
    notifyListeners();
    try {
      today = (await api.weighTickets(limit: 200)).items;
      todayError = null;
    } catch (e) {
      todayError = e;
    } finally {
      loadingToday = false;
      notifyListeners();
    }
  }

  Future<WeighTicket> cancel(WeighTicket t) async {
    final r = await _keys.once('ticket.cancel:${t.id}', (k) => api.cancelWeighTicket(t.id, idempotencyKey: k));
    today = [for (final x in today) x.id == t.id ? r.value : x];
    notifyListeners();
    return r.value;
  }

  @override
  void dispose() {
    scale.close();
    super.dispose();
  }
}
