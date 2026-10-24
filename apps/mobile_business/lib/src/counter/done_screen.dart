import 'package:flutter/material.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';
import 'package:srikit_print/srikit_print.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../errors.dart';
import '../links.dart';
import 'counter_controller.dart';
import 'counter_text.dart';

/// After the money (receipt-view.tsx): the server's bill number and total, change to give, what went on credit,
/// payments that couldn't be recorded, then Share on WhatsApp, Print (preview for now) and New bill.
class DoneScreen extends StatelessWidget {
  const DoneScreen({
    super.key,
    required this.controller,
    required this.outcome,
    this.openUrl = openExternal,
    this.printer = const PreviewReceiptPrinter(),
  });

  final CounterController controller;
  final PaymentOutcome outcome;
  final UrlOpener openUrl;
  final ReceiptPrinter printer;

  static const shareButton = Key('done.share');
  static const printButton = Key('done.print');
  static const newBillButton = Key('done.newBill');

  Future<void> _share(BuildContext context) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final link = await controller.share();
      final b = outcome.bill;
      final text = l.shareText(b.number ?? '', formatPaise(b.total), link.url);
      final phone = (b.customer.phone ?? '').replaceAll(RegExp(r'[^0-9]'), '');
      final url = Uri.parse('https://wa.me/${phone.isEmpty ? '' : phone}?text=${Uri.encodeComponent(text)}');
      if (!await openUrl(url)) messenger.showSnackBar(SnackBar(content: Text(l.couldNotOpenWhatsApp)));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorText(l, e))));
    }
  }

  Future<void> _print(BuildContext context) async {
    final l = AppLocalizations.of(context);
    final shop = AppScope.read(context).shop?.tenant.name ?? '';
    final text = await printer.print(receiptFor(outcome.bill, shopName: shop, change: outcome.change, cart: controller.cart.lines));
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.printPreviewTitle),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l.printComingNext),
              const SizedBox(height: 12),
              Container(
                color: Colors.white,
                padding: const EdgeInsets.all(8),
                child: Text(text,
                    key: const Key('done.receiptText'),
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.black, height: 1.2)),
              ),
            ],
          ),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l.closeLabel))],
      ),
    );
  }

  void _newBill(BuildContext context) {
    controller.newBill();
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final b = outcome.bill;
    final onCredit = outcome.unrecorded == 0 ? b.balance : 0;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _newBill(context);
      },
      child: Scaffold(
        appBar: AppBar(automaticallyImplyLeading: false, title: Text(l.saleComplete)),
        body: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Icon(Icons.check_circle, size: 64, color: theme.colorScheme.primary),
            const SizedBox(height: 8),
            Text(
              '${b.number ?? ''} · ${formatPaise(b.total)}',
              key: const Key('done.summary'),
              style: theme.textTheme.titleLarge,
              textAlign: TextAlign.center,
            ),
            if (outcome.change > 0) ...[
              const SizedBox(height: 16),
              Text(l.giveChange, textAlign: TextAlign.center),
              Text(formatPaise(outcome.change), key: const Key('done.change'), style: theme.textTheme.displaySmall, textAlign: TextAlign.center),
            ],
            if (onCredit > 0) Padding(padding: const EdgeInsets.only(top: 12), child: Text(l.addedToCredit(formatPaise(onCredit)), textAlign: TextAlign.center)),
            if (outcome.unrecorded > 0)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(l.paymentsMissing(formatPaise(outcome.unrecorded)), style: TextStyle(color: theme.colorScheme.error)),
              ),
            for (final f in controller.ticketUseFailures)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(l.ticketUseFailed(f.code ?? '', errorText(l, f.error)),
                    key: const Key('done.ticketUseFailed'), style: TextStyle(color: theme.colorScheme.error)),
              ),
            if (b.warnings.contains('credit_limit_exceeded'))
              Padding(padding: const EdgeInsets.only(top: 12), child: Text(l.creditLimitWarning, style: TextStyle(color: theme.colorScheme.error))),
            const SizedBox(height: 32),
            OutlinedButton.icon(key: shareButton, onPressed: () => _share(context), icon: const Icon(Icons.share), label: Text(l.shareWhatsApp)),
            const SizedBox(height: 8),
            OutlinedButton.icon(key: printButton, onPressed: () => _print(context), icon: const Icon(Icons.print), label: Text(l.printReceipt)),
            const SizedBox(height: 8),
            FilledButton.icon(key: newBillButton, onPressed: () => _newBill(context), icon: const Icon(Icons.add), label: Text(l.newBill)),
          ],
        ),
      ),
    );
  }
}
