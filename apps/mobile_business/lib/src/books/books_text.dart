import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import 'books_rules.dart';

/// Due / Advance / Settled.
String sideLabel(AppLocalizations l, BalanceSide s) => switch (s) {
      BalanceSide.due => l.balanceDueShort,
      BalanceSide.advance => l.balanceAdvanceShort,
      BalanceSide.settled => l.balanceSettledShort,
    };

/// Dues in the warning colour, advances in green, settled muted (credit-book-ui.tsx `balanceInk`).
Color sideColor(ColorScheme c, BalanceSide s) => switch (s) {
      BalanceSide.due => Colors.orange.shade800,
      BalanceSide.advance => Colors.green.shade700,
      BalanceSide.settled => c.outline,
    };

/// `₹1,200.00 due` / `₹500.00 adv.` / `₹0.00` (ledger-view.tsx `RunningBalance`).
String runningBalanceText(AppLocalizations l, int balance) {
  final amount = formatPaise(balance.abs());
  return switch (balanceSide(balance)) {
    BalanceSide.due => '$amount ${l.ledgerBalDue}',
    BalanceSide.advance => '$amount ${l.ledgerBalAdvance}',
    BalanceSide.settled => amount,
  };
}

String methodLabel(AppLocalizations l, String m) => switch (m) {
      'cash' => l.methodCash,
      'upi' => l.methodUpi,
      'card' => l.methodCard,
      'bank' => l.methodBank,
      'cheque' => l.methodCheque,
      _ => l.methodOther,
    };

String ledgerTypeLabel(AppLocalizations l, String t) => switch (t) {
      'opening' => l.ledgerTypeOpening,
      'invoice' => l.ledgerTypeInvoice,
      'payment' => l.ledgerTypePayment,
      'receipt' => l.ledgerTypeReceipt,
      'cancel' => l.ledgerTypeCancel,
      'credit_note' => l.ledgerTypeCreditNote,
      'refund' => l.ledgerTypeRefund,
      _ => t,
    };

String ageLabel(AppLocalizations l, String a) => switch (a) {
      'current' => l.ageCurrent,
      '1-30' => l.age1to30,
      '31-60' => l.age31to60,
      '61-90' => l.age61to90,
      _ => l.age90plus,
    };

const ageBuckets = ['current', '1-30', '31-60', '61-90', '90+'];

/// Built-in category names are translated; the owner's own names show as typed (expense-dialog.tsx `categoryLabel`).
String categoryName(AppLocalizations l, String name, {bool builtin = true}) {
  if (!builtin) return name;
  return switch (name.toLowerCase()) {
        'rent' => l.expenseCatRent,
        'salaries' => l.expenseCatSalaries,
        'electricity' => l.expenseCatElectricity,
        'transport' => l.expenseCatTransport,
        'packaging' => l.expenseCatPackaging,
        'marketing' => l.expenseCatMarketing,
        'repairs' => l.expenseCatRepairs,
        'other' => l.expenseCatOther,
        _ => null,
      } ??
      name;
}

/// `21 Oct` (or `21 Oct 2025` outside the current year) for an IST `YYYY-MM-DD`.
String dayLabel(String iso, String locale, {bool year = false}) {
  final d = DateTime.tryParse(iso);
  if (d == null) return iso;
  final pattern = year || d.year != DateTime.now().year ? 'd MMM y' : 'd MMM';
  try {
    return DateFormat(pattern, locale).format(d);
  } catch (_) {
    return DateFormat(pattern).format(d);
  }
}

/// The statement message for WhatsApp, worded for due, advance or settled (credit-book-ui.tsx `statementMessage`).
String statementMessage(AppLocalizations l, {required String name, required String shop, required int balance, required String url}) {
  final amount = formatPaise(balance.abs());
  return switch (balanceSide(balance)) {
    BalanceSide.due => l.statementMessageDue(name, shop, amount, url),
    BalanceSide.advance => l.statementMessageAdvance(name, shop, amount, url),
    BalanceSide.settled => l.statementMessageSettled(name, shop, url),
  };
}

/// Rupees for a text field: `1200` / `1200.5` (money-input `paiseToInput`).
String paiseToInput(int paise) {
  final r = paise ~/ 100;
  final p = paise % 100;
  if (p == 0) return '$r';
  return '$r.${p.toString().padLeft(2, '0')}';
}

/// A small coloured label (like orders' status pills).
class SidePill extends StatelessWidget {
  const SidePill(this.balance, {super.key});
  final int balance;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final s = balanceSide(balance);
    final color = sideColor(Theme.of(context).colorScheme, s);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(sideLabel(l, s), style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

/// The customer's name for lists and titles.
String customerTitle(Customer c) => c.name;
