import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../errors.dart';
import 'counter_controller.dart';
import 'done_screen.dart';
import 'tender.dart';

/// Take the money for the issued bill (payment-dialog.tsx): cash (quick notes, change), UPI (with "received"),
/// card, and the rest on credit when the shop has the credit book and the customer is saved. All of it may be split.
/// Every number shown is the server's.
class PayScreen extends StatefulWidget {
  const PayScreen({super.key, required this.controller});
  final CounterController controller;

  static const cashField = Key('pay.cash');
  static const upiField = Key('pay.upi');
  static const cardField = Key('pay.card');
  static const creditField = Key('pay.credit');
  static const upiReceived = Key('pay.upiReceived');
  static const completeButton = Key('pay.complete');
  static const retryButton = Key('pay.retry');
  static const finishWithoutButton = Key('pay.finishWithout');

  @override
  State<PayScreen> createState() => _PayScreenState();
}

class _PayScreenState extends State<PayScreen> {
  final _cash = TextEditingController();
  final _upi = TextEditingController();
  final _card = TextEditingController();
  final _credit = TextEditingController();
  final _upiRef = TextEditingController();
  final _cardRef = TextEditingController();
  bool _upiConfirmed = false;
  bool _busy = false;
  Object? _failure;
  bool _started = false;

  @override
  void initState() {
    super.initState();
    for (final c in [_cash, _upi, _card, _credit]) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    for (final c in [_cash, _upi, _card, _credit, _upiRef, _cardRef]) {
      c.dispose();
    }
    super.dispose();
  }

  CounterController get _c => widget.controller;
  Invoice get _bill => _c.bill!;

  int _v(TextEditingController t) => parseRupees(t.text) ?? -1;

  /// Nothing typed = exact cash (the web counter's Enter / F10).
  Tenders get _tenders {
    final none = [_cash, _upi, _card, _credit].every((t) => t.text.trim().isEmpty);
    if (none) return Tenders(cash: _bill.balance);
    return Tenders(cash: _v(_cash).clamp(0, 1 << 40), upi: _v(_upi).clamp(0, 1 << 40), card: _v(_card).clamp(0, 1 << 40), credit: _v(_credit).clamp(0, 1 << 40));
  }

  bool get _malformed => [_cash, _upi, _card, _credit].any((t) => parseRupees(t.text) == null);

  Settlement get _settlement => settle(
        _bill.balance,
        _tenders,
        upiConfirmed: _upiConfirmed,
        hasCustomer: _c.customer.kind == CustomerKind.saved,
        creditAllowed: _c.creditAllowed,
      );

  String _problem(AppLocalizations l, TenderProblem p, Settlement s) => switch (p) {
        TenderProblem.short => l.shortBy(formatPaise(s.remaining)),
        TenderProblem.overNonCash => l.problemOverNonCash,
        TenderProblem.upiUnconfirmed => l.problemUpiUnconfirmed,
        TenderProblem.creditNeedsCustomer => l.problemCreditNeedsCustomer,
        TenderProblem.creditUnavailable => l.problemCreditUnavailable,
        TenderProblem.nothingToPay => '',
      };

  Future<void> _complete() async {
    setState(() {
      _busy = true;
      _failure = null;
      _started = true;
    });
    try {
      final outcome = await _c.pay(_tenders, upiRef: _upiRef.text, cardRef: _cardRef.text);
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => DoneScreen(controller: _c, outcome: outcome)));
    } on ApiException catch (e) {
      if (mounted) setState(() => _failure = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _finishWithout() {
    final outcome = _c.finishWithout();
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => DoneScreen(controller: _c, outcome: outcome)));
  }

  Future<bool> _confirmLeave() async {
    final l = AppLocalizations.of(context);
    final cancel = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.leaveBillTitle),
        content: Text(l.leaveBillBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.stay)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.cancelBill)),
        ],
      ),
    );
    if (cancel != true) return false;
    try {
      await _c.cancelBill('Left the counter before paying');
      return true;
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(l, e))));
      return false;
    }
  }

  Widget _money(Key key, TextEditingController c, String label, {Widget? suffix}) => TextField(
        key: key,
        controller: c,
        enabled: !_started,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
        decoration: InputDecoration(labelText: label, suffixIcon: suffix),
      );

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final b = _bill;
    final t = b.totals;
    final s = _settlement;
    final problems = _malformed ? <String>[l.errorGeneric] : s.problems.map((p) => _problem(l, p, s)).where((x) => x.isNotEmpty).toList();
    final canComplete = !_busy && (_started || (problems.isEmpty || b.balance == 0));

    Widget row(String a, int v, {bool bold = false}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(children: [
            Expanded(child: Text(a, style: bold ? theme.textTheme.titleMedium : null)),
            Text(formatPaise(v), style: bold ? theme.textTheme.titleMedium : null),
          ]),
        );

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || _busy) return;
        if (_started) return; // payments began: finish or retry, don't cancel
        final nav = Navigator.of(context);
        if (await _confirmLeave()) nav.pop();
      },
      child: Scaffold(
        appBar: AppBar(title: Text(l.billNumber(b.number ?? ''))),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            row(l.subtotalLabel, t.subtotal),
            if (t.discount != 0) row(l.discountLabel, -t.discount),
            row(l.taxableLabel, t.taxable),
            if (t.cgst != 0) row(l.cgstLabel, t.cgst),
            if (t.sgst != 0) row(l.sgstLabel, t.sgst),
            if (t.igst != 0) row(l.igstLabel, t.igst),
            if (t.roundOff != 0) row(l.roundOffLabel, t.roundOff),
            row(l.totalLabel, t.total, bold: true),
            const Divider(height: 24),
            Text(l.toPay(formatPaise(b.balance)), key: const Key('pay.toPay'), style: theme.textTheme.headlineSmall),
            const SizedBox(height: 12),
            _money(PayScreen.cashField, _cash, l.cashReceived),
            Wrap(
              spacing: 8,
              children: [
                for (final n in quickNotes(b.balance - (_v(_upi).clamp(0, 1 << 40)) - (_v(_card).clamp(0, 1 << 40)) - (_v(_credit).clamp(0, 1 << 40))))
                  ActionChip(label: Text(formatPaise(n, decimals: n % 100 != 0)), onPressed: _started ? null : () => _cash.text = (n / 100).toStringAsFixed(n % 100 == 0 ? 0 : 2)),
              ],
            ),
            if (s.change > 0)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(l.changeDue(formatPaise(s.change)), style: theme.textTheme.titleLarge),
              ),
            const SizedBox(height: 12),
            _money(PayScreen.upiField, _upi, l.upiAmount),
            if (_v(_upi) > 0) ...[
              SwitchListTile(
                key: PayScreen.upiReceived,
                contentPadding: EdgeInsets.zero,
                value: _upiConfirmed,
                onChanged: _started ? null : (v) => setState(() => _upiConfirmed = v),
                title: Text(l.upiReceived),
              ),
              TextField(controller: _upiRef, enabled: !_started, maxLength: 100, decoration: InputDecoration(labelText: l.referenceOptional)),
            ],
            const SizedBox(height: 12),
            _money(PayScreen.cardField, _card, l.cardAmount),
            if (_v(_card) > 0)
              TextField(controller: _cardRef, enabled: !_started, maxLength: 100, decoration: InputDecoration(labelText: l.referenceOptional)),
            if (_c.creditAllowed) ...[
              const SizedBox(height: 12),
              _money(PayScreen.creditField, _credit, l.creditAmount),
            ],
            const SizedBox(height: 12),
            if (!_started)
              for (final p in problems) Text(p, style: TextStyle(color: theme.colorScheme.error)),
            if (_failure != null) ...[
              Text('${l.paymentFailed} ${errorText(l, _failure)}', style: TextStyle(color: theme.colorScheme.error)),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(
                  child: OutlinedButton(key: PayScreen.finishWithoutButton, onPressed: _busy ? null : _finishWithout, child: Text(l.finishWithout)),
                ),
                const SizedBox(width: 8),
                Expanded(child: FilledButton(key: PayScreen.retryButton, onPressed: _busy ? null : _complete, child: Text(l.retry))),
              ]),
            ] else
              FilledButton(
                key: PayScreen.completeButton,
                onPressed: canComplete ? _complete : null,
                child: _busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.completePayment),
              ),
          ],
        ),
      ),
    );
  }
}
