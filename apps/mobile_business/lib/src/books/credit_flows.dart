import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../counter/tender.dart';
import '../errors.dart';
import 'books_rules.dart';
import 'books_text.dart';

/// Receive payment on account (receive-dialog.tsx). True when a receipt was saved.
Future<bool> showReceiveSheet(BuildContext context, Customer customer) async =>
    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => ReceiveSheet(customer: customer),
    ) ==
    true;

/// Creates the public statement link and opens WhatsApp with the web's message (share-statement-dialog.tsx). Sent
/// to the customer's phone when it is a usable number, otherwise WhatsApp asks whom to send it to.
Future<void> shareStatement(BuildContext context, Customer c, {int? balance}) async {
  final l = AppLocalizations.of(context);
  final app = AppScope.read(context);
  final messenger = ScaffoldMessenger.of(context);
  try {
    final link = await app.booksActions().shareStatement(c.id);
    final text = statementMessage(l, name: c.name, shop: app.shop?.tenant.name ?? '', balance: balance ?? c.outstanding, url: link.url);
    if (!await app.openUrl(waLink(c.phone, text))) messenger.showSnackBar(SnackBar(content: Text(l.couldNotOpenWhatsApp)));
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(errorText(l, e))));
  }
}

/// Asks the server to send the reminder from the shop's WhatsApp (credit-book-ui.tsx `useRemind`); when that fails
/// (no provider, no phone …) the message offers WhatsApp from this phone with the statement link instead.
Future<void> sendReminder(BuildContext context, Customer c, {int? balance}) async {
  final l = AppLocalizations.of(context);
  final app = AppScope.read(context);
  final messenger = ScaffoldMessenger.of(context);
  try {
    await app.booksActions().remind(c, locale: l.localeName);
    messenger.showSnackBar(SnackBar(content: Text(l.remindSent(c.name))));
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(
      duration: const Duration(seconds: 10),
      content: Text(l.remindFailed(errorText(l, e))),
      action: SnackBarAction(
        label: l.remindViaWhatsApp,
        onPressed: () {
          if (context.mounted) shareStatement(context, c, balance: balance);
        },
      ),
    ));
  }
}

/// Amount (the balance by default), method, date (not after today), reference, note; then the server's allocations:
/// the bills settled oldest first and what was kept as advance.
class ReceiveSheet extends StatefulWidget {
  const ReceiveSheet({super.key, required this.customer});
  final Customer customer;

  static const amountField = Key('receive.amount');
  static const referenceField = Key('receive.reference');
  static const noteField = Key('receive.note');
  static const dateButton = Key('receive.date');
  static const saveButton = Key('receive.save');
  static const doneButton = Key('receive.done');

  @override
  State<ReceiveSheet> createState() => _ReceiveSheetState();
}

class _ReceiveSheetState extends State<ReceiveSheet> {
  late final _amount = TextEditingController(text: widget.customer.outstanding > 0 ? paiseToInput(widget.customer.outstanding) : '');
  final _reference = TextEditingController();
  final _note = TextEditingController();
  String _method = 'cash';
  String _date = todayIst();
  bool _busy = false;
  String? _error;
  ReceiptView? _done;

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    _note.dispose();
    super.dispose();
  }

  String _message(AppLocalizations l, ReceiptError e) => switch (e) {
        ReceiptError.amount => l.amountRequired,
        ReceiptError.dateInFuture || ReceiptError.dateInvalid => l.dateNotFuture,
        ReceiptError.referenceTooLong || ReceiptError.noteTooLong => l.tooLong,
      };

  Future<void> _pickDate() async {
    final today = DateTime.parse(todayIst());
    final picked = await showDatePicker(context: context, initialDate: DateTime.parse(_date), firstDate: DateTime(2000), lastDate: today);
    if (picked != null) setState(() => _date = isoDate(picked));
  }

  Future<void> _save() async {
    final l = AppLocalizations.of(context);
    final err = validateReceipt(amount: _amount.text, date: _date, reference: _reference.text, note: _note.text);
    if (err != null) return setState(() => _error = _message(l, err));
    final amount = parseRupees(_amount.text)!;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await AppScope.read(context).booksActions().receive(
            widget.customer,
            amount: amount,
            method: _method,
            date: _date,
            reference: _reference.text.trim().isEmpty ? null : _reference.text.trim(),
            note: _note.text.trim().isEmpty ? null : _note.text.trim(),
          );
      if (mounted) setState(() => _done = receiptView(r, typedAmount: amount, typedDate: _date));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final c = widget.customer;
    final done = _done;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: done != null
            ? _Result(view: done, name: c.name)
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(l.receivePayment, style: theme.textTheme.titleLarge),
                  Text(l.receiveHint(c.name), style: theme.textTheme.bodySmall),
                  TextField(
                    key: ReceiveSheet.amountField,
                    controller: _amount,
                    autofocus: true,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                    style: theme.textTheme.titleLarge,
                    decoration: InputDecoration(
                      labelText: l.amountReceived,
                      prefixText: '₹',
                      helperText: c.outstanding > 0
                          ? l.balanceDueOf(formatPaise(c.outstanding))
                          : (c.outstanding < 0 ? l.alreadyAdvance(c.name, formatPaise(-c.outstanding)) : null),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(spacing: 6, children: [
                    for (final m in paymentMethods)
                      ChoiceChip(
                        key: Key('receive.method.$m'),
                        label: Text(methodLabel(l, m)),
                        selected: _method == m,
                        onSelected: (_) => setState(() => _method = m),
                      ),
                  ]),
                  ListTile(
                    key: ReceiveSheet.dateButton,
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.event_outlined),
                    title: Text(l.dateLabel),
                    trailing: Text(dayLabel(_date, l.localeName, year: true)),
                    onTap: _pickDate,
                  ),
                  TextField(key: ReceiveSheet.referenceField, controller: _reference, maxLength: 100, decoration: InputDecoration(labelText: l.referenceOptional)),
                  TextField(key: ReceiveSheet.noteField, controller: _note, maxLength: 500, decoration: InputDecoration(labelText: l.noteOptional)),
                  if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
                  FilledButton(key: ReceiveSheet.saveButton, onPressed: _busy ? null : _save, child: Text(l.saveReceipt)),
                ],
              ),
      ),
    );
  }
}

class _Result extends StatelessWidget {
  const _Result({required this.view, required this.name});
  final ReceiptView view;
  final String name;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Icon(Icons.check_circle, size: 56, color: theme.colorScheme.primary),
        Text(l.receivedAmount(formatPaise(view.amount)), key: const Key('receive.title'), style: theme.textTheme.titleLarge, textAlign: TextAlign.center),
        Text(l.receivedFrom(name, dayLabel(view.date, l.localeName, year: true)), textAlign: TextAlign.center),
        const SizedBox(height: 16),
        if (view.lines.isNotEmpty) ...[
          Text(l.settledAgainst, style: theme.textTheme.labelLarge),
          for (final a in view.lines)
            ListTile(
              key: Key('receive.allocation.${a.invoiceId}'),
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: const Icon(Icons.receipt_long_outlined),
              title: Text(l.billNumberShort(a.number)),
              trailing: Text(formatPaise(a.amount), style: TextStyle(color: Colors.green.shade700, fontWeight: FontWeight.w600)),
            ),
        ],
        if (view.noBills) Text(l.noOpenBills, key: const Key('receive.noBills'), textAlign: TextAlign.center),
        if (view.hasAdvance)
          ListTile(
            key: const Key('receive.advance'),
            contentPadding: EdgeInsets.zero,
            dense: true,
            leading: const Icon(Icons.savings_outlined),
            title: Text(l.keptAsAdvance),
            trailing: Text(formatPaise(view.advance), style: TextStyle(color: Colors.green.shade700, fontWeight: FontWeight.w600)),
          ),
        const SizedBox(height: 16),
        FilledButton(key: ReceiveSheet.doneButton, onPressed: () => Navigator.pop(context, true), child: Text(l.done)),
      ],
    );
  }
}
