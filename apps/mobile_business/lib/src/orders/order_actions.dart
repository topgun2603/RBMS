import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

/// New-order count for the Orders tab badge. Until push arrives (FCM), it polls `GET /v1/orders/summary` every
/// [interval] while the Orders tab is visible ([start] / [stop]); [refresh] is also called once when the shop opens.
/// "New" is the web's meaning: orders still `placed` (waiting to be confirmed).
///
/// TODO(fcm): on a new-order push, call [refresh] (and stop polling).
class OrdersWatcher extends ChangeNotifier {
  OrdersWatcher(this.api, {this.interval = const Duration(seconds: 60)});
  final SrikitApi api;
  final Duration interval;

  OrderSummary? summary;
  Timer? _timer;

  int get newOrders => summary?.newOrders ?? 0;
  bool get polling => _timer != null;

  Future<void> refresh() async {
    try {
      summary = await api.orderSummary();
      notifyListeners();
    } catch (_) {
      // A missed poll is fine; the next one tries again.
    }
  }

  void start() {
    if (_timer != null) return;
    refresh();
    _timer = Timer.periodic(interval, (_) => refresh());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}

/// Order writes, each with an Idempotency-Key per user action (kept for the shop, so a retry after leaving the screen
/// still reuses it). Every call answers with the server's updated order.
class OrderActions {
  OrderActions(this.api, SessionStore session) : keys = ActionKeys(session);
  final SrikitApi api;
  final ActionKeys keys;

  /// Confirm, pack, ship (with [fulfillment]), deliver, cancel ([note] = reason), return.
  Future<Order> move(Order o, String to, {String? note, Fulfillment? fulfillment}) async => (await keys.once(
        'order.status:${o.id}:${o.status}:$to',
        (k) => api.setOrderStatus(o.id, to, note: note, fulfillment: fulfillment, idempotencyKey: k),
      ))
          .value;

  Future<Order> recordPayment(Order o, {required int amount, required String method, String? reference, String? date}) async =>
      (await keys.once(
        'order.pay:${o.id}:${o.paid}:$amount:$method:${reference ?? ''}',
        (k) => api.recordOrderPayment(o.id, amount: amount, method: method, reference: reference, date: date, idempotencyKey: k),
      ))
          .value;

  Future<Order> updateFulfillment(Order o, Fulfillment f) async =>
      (await keys.once('order.fulfillment:${o.id}:${f.carrier}:${f.trackingNumber}:${f.trackingUrl}',
              (k) => api.updateFulfillment(o.id, f, idempotencyKey: k)))
          .value;

  Future<Order> invoice(Order o) async =>
      (await keys.once('order.invoice:${o.id}', (k) => api.invoiceOrder(o.id, idempotencyKey: k))).value;
}
