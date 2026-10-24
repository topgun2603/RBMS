import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../l10n/app_localizations.dart';

/// Status chip labels (the web calls `placed` "New").
String orderStatusLabel(AppLocalizations l, String s) => switch (s) {
      'placed' => l.orderStatusPlaced,
      'confirmed' => l.orderStatusConfirmed,
      'packed' => l.orderStatusPacked,
      'shipped' => l.orderStatusShipped,
      'delivered' => l.orderStatusDelivered,
      'cancelled' => l.orderStatusCancelled,
      'returned' => l.orderStatusReturned,
      _ => s,
    };

/// Button labels for a move.
String orderActionLabel(AppLocalizations l, String to) => switch (to) {
      'confirmed' => l.orderActionConfirm,
      'packed' => l.orderActionPack,
      'shipped' => l.orderActionShip,
      'delivered' => l.orderActionDeliver,
      'cancelled' => l.orderActionCancel,
      'returned' => l.orderActionReturn,
      _ => to,
    };

String paymentStatusLabel(AppLocalizations l, String s) => switch (s) {
      'paid' => l.paymentPaid,
      'cod' => l.paymentCod,
      'pending' => l.paymentPending,
      'refunded' => l.paymentRefunded,
      'partially_refunded' => l.paymentPartRefunded,
      _ => l.paymentUnpaid,
    };

String channelLabel(AppLocalizations l, String c) => switch (c) {
      'store' => l.channelStore,
      'manual' => l.channelManual,
      'pos' => l.channelPos,
      'marketplace' => l.channelMarketplace,
      _ => c,
    };

/// pills.tsx tones.
Color orderStatusColor(ColorScheme c, String s) => switch (s) {
      'placed' => Colors.orange.shade700,
      'confirmed' => c.primary,
      'packed' || 'shipped' => Colors.blue.shade700,
      'delivered' => Colors.green.shade700,
      'cancelled' => c.error,
      _ => c.outline,
    };

Color paymentStatusColor(ColorScheme c, String s) => switch (s) {
      'paid' => Colors.green.shade700,
      'cod' => Colors.orange.shade700,
      'pending' => Colors.blue.shade700,
      'unpaid' => c.error,
      _ => c.outline,
    };

/// A small coloured label.
class Pill extends StatelessWidget {
  const Pill(this.text, this.color, {super.key});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Text(text, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
      );
}

/// "14 Oct, 6:42 pm" in IST, as the web lists show it.
String istDateTime(DateTime? t, String locale) {
  if (t == null) return '';
  final ist = t.toUtc().add(const Duration(hours: 5, minutes: 30));
  try {
    return DateFormat('d MMM, h:mm a', locale).format(ist);
  } catch (_) {
    return DateFormat('d MMM, h:mm a').format(ist);
  }
}
