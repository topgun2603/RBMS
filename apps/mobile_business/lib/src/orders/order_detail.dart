import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../counter/counter_text.dart';
import '../counter/tender.dart';
import '../errors.dart';
import 'order_rules.dart';
import 'order_text.dart';

/// One order: lines, customer, address, totals, payments, shipment, timeline, and the moves the server allows
/// (`nextStatuses`) that the user may make. Ship opens shipping details, cancel asks for a reason, return confirms.
class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.orderId});
  final String orderId;

  static const primaryAction = Key('order.primary');
  static const moreActions = Key('order.more');
  static const recordPaymentButton = Key('order.recordPayment');
  static const invoiceButton = Key('order.invoice');

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  Order? _order;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    try {
      final o = await AppScope.read(context).api.order(widget.orderId);
      if (!mounted) return;
      setState(() {
        _order = o;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _toast(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  /// Runs an order write; a 409 (moved meanwhile / not allowed now) reloads the order.
  Future<void> _run(Future<Order> Function() action) async {
    final l = AppLocalizations.of(context);
    setState(() => _busy = true);
    try {
      final o = await action();
      if (mounted) setState(() => _order = o);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.status == 409) {
        _toast(l.orderChanged);
        await _load();
      } else {
        _toast(errorText(l, e));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _move(String to) async {
    final o = _order!;
    final actions = AppScope.read(context).orderActions();
    switch (to) {
      case 'shipped':
        final f = await _shipDialog(o.fulfillment);
        if (f == null) return;
        await _run(() => actions.move(o, to, fulfillment: f));
      case 'cancelled':
        final reason = await _cancelDialog();
        if (reason == null) return;
        await _run(() => actions.move(o, to, note: reason));
      case 'returned':
        final note = await _returnDialog();
        if (note == null) return;
        await _run(() => actions.move(o, to, note: note));
      default:
        await _run(() => actions.move(o, to));
    }
  }

  Future<Fulfillment?> _shipDialog(Fulfillment current) {
    final l = AppLocalizations.of(context);
    final carrier = TextEditingController(text: current.carrier ?? '');
    final number = TextEditingController(text: current.trackingNumber ?? '');
    final url = TextEditingController(text: current.trackingUrl ?? '');
    String? error;
    return showDialog<Fulfillment>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text(l.shipTitle),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(key: const Key('ship.carrier'), controller: carrier, maxLength: 80, decoration: InputDecoration(labelText: l.carrierLabel)),
              TextField(key: const Key('ship.number'), controller: number, maxLength: 80, decoration: InputDecoration(labelText: l.trackingNumberLabel)),
              TextField(
                key: const Key('ship.url'),
                controller: url,
                maxLength: 500,
                keyboardType: TextInputType.url,
                decoration: InputDecoration(labelText: l.trackingUrlLabel, errorText: error),
              ),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l.cancel)),
            FilledButton(
              key: const Key('ship.confirm'),
              onPressed: () {
                if (!validTrackingUrl(url.text)) {
                  setLocal(() => error = l.trackingUrlInvalid);
                  return;
                }
                String? v(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
                Navigator.pop(ctx, Fulfillment(carrier: v(carrier), trackingNumber: v(number), trackingUrl: v(url)));
              },
              child: Text(l.orderActionShip),
            ),
          ],
        ),
      ),
    );
  }

  Future<String?> _cancelDialog() {
    final l = AppLocalizations.of(context);
    final reason = TextEditingController();
    final presets = {
      'customer': l.cancelReasonCustomer,
      'stock': l.cancelReasonStock,
      'payment': l.cancelReasonPayment,
      'duplicate': l.cancelReasonDuplicate,
      'address': l.cancelReasonAddress,
    };
    String? error;
    return showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text(l.cancelOrderTitle),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final e in presets.entries)
                  ActionChip(key: Key('cancel.${e.key}'), label: Text(e.value), onPressed: () => setLocal(() => reason.text = e.value)),
              ]),
              const SizedBox(height: 8),
              TextField(
                key: const Key('cancel.reason'),
                controller: reason,
                maxLength: 500,
                decoration: InputDecoration(labelText: l.tillReason, errorText: error),
              ),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l.keepOrder)),
            FilledButton(
              key: const Key('cancel.confirm'),
              style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
              onPressed: () {
                if (validateCancelReason(reason.text) != null) {
                  setLocal(() => error = l.cancelReasonRequired);
                  return;
                }
                Navigator.pop(ctx, reason.text.trim());
              },
              child: Text(l.orderActionCancel),
            ),
          ],
        ),
      ),
    );
  }

  Future<String?> _returnDialog() {
    final l = AppLocalizations.of(context);
    final note = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.returnTitle),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(l.returnBody),
          TextField(controller: note, maxLength: 500, decoration: InputDecoration(labelText: l.tillNote)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(l.cancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, note.text.trim()), child: Text(l.orderActionReturn)),
        ],
      ),
    );
  }

  Future<void> _recordPayment() async {
    final o = _order!;
    final l = AppLocalizations.of(context);
    final amount = TextEditingController(text: rupeesInput(o.balance));
    final ref = TextEditingController();
    var method = 'cash';
    String? error;
    final result = await showModalBottomSheet<({int amount, String method, String ref})>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(ctx).bottom),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(l.recordPayment, style: Theme.of(ctx).textTheme.titleMedium),
            const SizedBox(height: 8),
            TextField(
              key: const Key('orderPay.amount'),
              controller: amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
              decoration: InputDecoration(labelText: l.tillAmount, errorText: error),
            ),
            const SizedBox(height: 8),
            Wrap(spacing: 6, children: [
              for (final m in const ['cash', 'upi', 'card', 'bank', 'cheque', 'other'])
                ChoiceChip(label: Text(methodLabel(l, m)), selected: method == m, onSelected: (_) => setLocal(() => method = m)),
            ]),
            TextField(controller: ref, maxLength: 100, decoration: InputDecoration(labelText: l.referenceOptional)),
            FilledButton(
              key: const Key('orderPay.save'),
              onPressed: () {
                final a = parseRupees(amount.text);
                if (a == null || a <= 0 || a > o.balance) {
                  setLocal(() => error = l.orderPayAmountInvalid(formatPaise(o.balance)));
                  return;
                }
                Navigator.pop(ctx, (amount: a, method: method, ref: ref.text));
              },
              child: Text(l.save),
            ),
          ]),
        ),
      ),
    );
    if (result == null || !mounted) return;
    await _run(() => AppScope.read(context)
        .orderActions()
        .recordPayment(o, amount: result.amount, method: result.method, reference: result.ref, date: todayIst()));
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final o = _order;
    if (o == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: _error == null
              ? const CircularProgressIndicator()
              : Column(mainAxisSize: MainAxisSize.min, children: [Text(errorText(l, _error)), TextButton(onPressed: _load, child: Text(l.retry))]),
        ),
      );
    }
    final gates = GateScope.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final moves = availableMoves(gates, o.status, o.nextStatuses);
    final primary = nextStep(o.status, moves);
    final others = [for (final m in moves) if (m != primary) m];

    Widget money(String a, int v, {bool bold = false}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(children: [
            Expanded(child: Text(a, style: bold ? theme.textTheme.titleSmall : null)),
            Text(formatPaise(v), style: bold ? theme.textTheme.titleSmall : null),
          ]),
        );
    Widget section(String title, List<Widget> children) => Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            ...children,
          ]),
        );

    return Scaffold(
      appBar: AppBar(
        title: Text(l.orderTitle(o.number)),
        actions: [
          if (others.isNotEmpty)
            PopupMenuButton<String>(
              key: OrderDetailScreen.moreActions,
              enabled: !_busy,
              onSelected: _move,
              itemBuilder: (_) => [
                for (final m in others)
                  PopupMenuItem(
                    value: m,
                    child: Text(
                      orderFlow.contains(m) ? '${l.skipTo} ${orderStatusLabel(l, m)}' : orderActionLabel(l, m),
                      style: m == 'cancelled' ? TextStyle(color: theme.colorScheme.error) : null,
                    ),
                  ),
              ],
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Pill(orderStatusLabel(l, o.status), orderStatusColor(theme.colorScheme, o.status)),
              Pill(paymentStatusLabel(l, o.paymentStatus), paymentStatusColor(theme.colorScheme, o.paymentStatus)),
              Text('${channelLabel(l, o.channel)} · ${istDateTime(o.placedAt, locale)}', style: theme.textTheme.bodySmall),
            ]),
            if (o.cancelReason != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(o.cancelReason!)),
            if (primary != null) ...[
              const SizedBox(height: 12),
              FilledButton(
                key: OrderDetailScreen.primaryAction,
                onPressed: _busy ? null : () => _move(primary),
                child: Text(orderActionLabel(l, primary)),
              ),
              if (primary == 'delivered' && o.isCod && o.balance > 0)
                Padding(padding: const EdgeInsets.only(top: 4), child: Text(l.codDeliverNote, style: theme.textTheme.bodySmall)),
            ],
            if (_busy) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator()),
            section(l.customerTitle, [
              Text(o.customer.name),
              if (o.customer.phone != null) Text(o.customer.phone!),
              if (o.customerNote != null && o.customerNote!.isNotEmpty) Text('${l.customerNoteLabel}: ${o.customerNote}'),
            ]),
            if (o.shippingAddress != null) section(l.shipToLabel, [for (final line in o.shippingAddress!.lines) Text(line)]),
            section(l.orderItems, [
              for (final line in o.lines)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text(line.name),
                  subtitle: Text('${qtyText(line.qty)} ${line.unit} × ${formatPaise(line.price)}${line.sku == null ? '' : ' · ${line.sku}'}'),
                  trailing: Text(formatPaise(line.total)),
                ),
              const Divider(),
              money(l.subtotalLabel, o.totals.subtotal),
              if (o.totals.discount != 0) money(l.discountLabel, -o.totals.discount),
              if (o.totals.shipping != 0) money(l.orderShipping, o.totals.shipping),
              if (o.totals.codFee != 0) money(l.orderCodFee, o.totals.codFee),
              money(l.taxableLabel, o.totals.taxable),
              if (o.totals.cgst + o.totals.sgst != 0) money('${l.cgstLabel} + ${l.sgstLabel}', o.totals.cgst + o.totals.sgst),
              if (o.totals.igst != 0) money(l.igstLabel, o.totals.igst),
              if (o.totals.roundOff != 0) money(l.roundOffLabel, o.totals.roundOff),
              money(l.totalLabel, o.total, bold: true),
            ]),
            section(l.orderPayments, [
              if (o.payments.isEmpty) Text(l.orderNoPayments),
              for (final p in o.payments)
                money('${methodLabel(l, p.method == 'cod' ? 'cash' : p.method)}${p.source == 'cod' ? ' (COD)' : ''}${p.reference == null ? '' : ' · ${p.reference}'}', p.amount),
              money(l.orderPaidLabel, o.paid),
              if (o.refunded > 0) money(l.paymentRefunded, -o.refunded),
              money(l.orderBalance, o.balance, bold: true),
              if (canRecordPayment(gates, o))
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton(
                    key: OrderDetailScreen.recordPaymentButton,
                    onPressed: _busy ? null : _recordPayment,
                    child: Text(l.recordPayment),
                  ),
                ),
            ]),
            if (!o.fulfillment.isEmpty)
              section(l.orderShipment, [
                if (o.fulfillment.carrier != null) Text('${l.carrierLabel}: ${o.fulfillment.carrier}'),
                if (o.fulfillment.trackingNumber != null) Text('${l.trackingNumberLabel}: ${o.fulfillment.trackingNumber}'),
                if (o.fulfillment.trackingUrl != null) SelectableText(o.fulfillment.trackingUrl!),
              ]),
            if (o.invoiceNumber != null)
              section(l.invoiceLabel(o.invoiceNumber!), const [])
            else if (gates.can(OrderKeys.manage) && (invoiceFailed(o) || o.status == 'delivered'))
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: OutlinedButton(
                  key: OrderDetailScreen.invoiceButton,
                  onPressed: _busy ? null : () => _run(() => AppScope.read(context).orderActions().invoice(o)),
                  child: Text(l.makeInvoice),
                ),
              ),
            section(l.orderTimeline, [
              for (final e in o.events.reversed)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: Icon(switch (e.type) {
                    'status' => Icons.flag_outlined,
                    'payment' => Icons.payments_outlined,
                    'fulfillment' => Icons.local_shipping_outlined,
                    'refund' => Icons.undo,
                    _ => Icons.notes,
                  }),
                  title: Text(_eventText(l, e)),
                  subtitle: Text(istDateTime(e.createdAt, locale)),
                ),
            ]),
          ],
        ),
      ),
    );
  }

  String _eventText(AppLocalizations l, OrderEvent e) {
    switch (e.type) {
      case 'status':
        final to = e.toStatus == null ? '' : orderStatusLabel(l, e.toStatus!);
        return e.message == null || e.message!.isEmpty ? l.eventStatus(to) : '${l.eventStatus(to)} · ${e.message}';
      case 'payment':
        return l.eventPayment(formatPaise((e.data['amount'] as num?)?.toInt() ?? 0), methodLabel(l, '${e.data['method']}'));
      case 'refund':
        return l.eventRefund(formatPaise((e.data['amount'] as num?)?.toInt() ?? 0));
      case 'fulfillment':
        return l.eventFulfillment;
      default:
        return e.message ?? '';
    }
  }
}
