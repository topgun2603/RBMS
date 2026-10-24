// Order status rules, ported from the server (packages/orders/src/logic.ts) and the web (packages/orders-ui/src/lib).
// The order detail's `nextStatuses` (from the server) is the source of truth; these functions are used for list rows
// (which carry no nextStatuses) and to label / gate the actions.

import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

const orderStatuses = ['placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'];

/// logic.ts `ORDER_FLOW`.
const orderFlow = ['placed', 'confirmed', 'packed', 'shipped', 'delivered'];

/// logic.ts `CANCELLABLE`: no cancelling once shipped.
const cancellable = ['placed', 'confirmed', 'packed'];

/// Feature / permission keys (packages/orders/src/features.ts).
abstract final class OrderKeys {
  static const orders = 'orders';
  static const returns = 'orders.returns';
  static const manage = 'orders.manage';
  static const cancel = 'orders.cancel';
  static const refund = 'orders.refund';
  static const ship = 'orders.ship';
  static const deliver = 'orders.deliver';
  static const invoices = 'invoices';
}

/// logic.ts `allowedTransitions`: any forward step (skipping allowed), cancel before shipping, return after delivery
/// when returns are on.
List<String> allowedTransitions(String status, {bool returnsEnabled = false}) {
  final out = <String>[];
  final i = orderFlow.indexOf(status);
  if (i >= 0) out.addAll(orderFlow.sublist(i + 1));
  if (cancellable.contains(status)) out.add('cancelled');
  if (status == 'delivered' && returnsEnabled) out.add('returned');
  return out;
}

/// status.ts `nextStep`: the primary button, the next step of the flow that is allowed.
String? nextStep(String status, List<String> allowed) {
  final i = orderFlow.indexOf(status);
  if (i < 0 || i + 1 >= orderFlow.length) return null;
  final next = orderFlow[i + 1];
  return allowed.contains(next) ? next : null;
}

/// Later forward steps for "Skip to" (status.ts `skipAheadSteps`).
List<String> skipAhead(String status, List<String> allowed) {
  final next = nextStep(status, allowed);
  return [for (final s in allowed) if (orderFlow.contains(s) && s != next) s];
}

/// routes.ts: which permission a move needs (any one of the list).
List<String> permissionsFor(String to) => switch (to) {
      'cancelled' => const [OrderKeys.cancel],
      'shipped' => const [OrderKeys.manage, OrderKeys.ship],
      'delivered' => const [OrderKeys.manage, OrderKeys.deliver],
      _ => const [OrderKeys.manage],
    };

bool canMove(Gates g, String to) => permissionsFor(to).any(g.can);

/// The moves the user may make now: allowed by the server and permitted.
List<String> availableMoves(Gates g, String status, List<String> allowed) =>
    [for (final s in allowed) if (canMove(g, s)) s];

/// status.ts: these open a dialog first (reason / shipping details); the others post straight away.
bool needsDialog(String to) => to == 'cancelled' || to == 'shipped' || to == 'returned';

/// payments-card.tsx: record a payment while something is due and the order is still live.
bool canRecordPayment(Gates g, Order o) =>
    g.can(OrderKeys.manage) && o.balance > 0 && o.status != 'cancelled' && o.status != 'returned';

/// side-cards.tsx: the invoice retry shows only after the automatic invoice failed.
bool invoiceFailed(Order o) =>
    o.invoiceId == null && o.events.any((e) => e.data['kind'] == 'effect_failed' && '${e.data['effect']}'.startsWith('invoice'));

/// The web's tracking URL check (status-actions.tsx).
bool validTrackingUrl(String url) => url.trim().isEmpty || RegExp(r'^https?://\S+\.\S+').hasMatch(url.trim());

/// The web's preset cancel reasons (status-actions.tsx). The text sent is the localised label.
const cancelReasonKeys = ['customer', 'stock', 'payment', 'duplicate', 'address'];

/// A cancel needs a reason in the web UI (the server accepts none); max 500 characters.
String? validateCancelReason(String reason) {
  final t = reason.trim();
  if (t.isEmpty) return 'required';
  if (t.length > 500) return 'tooLong';
  return null;
}
