import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import 'counter_controller.dart';
import 'counter_text.dart';
import 'tender.dart';

/// Edit a cart line (line-edit-dialog.tsx): quantity (3 decimals), and with `invoices.discount` the price and a
/// discount in ₹ or %.
Future<void> showLineSheet(BuildContext context, CounterController c, String key) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _LineSheet(controller: c, lineKey: key),
    );

class _LineSheet extends StatefulWidget {
  const _LineSheet({required this.controller, required this.lineKey});
  final CounterController controller;
  final String lineKey;

  @override
  State<_LineSheet> createState() => _LineSheetState();
}

class _LineSheetState extends State<_LineSheet> {
  late final TextEditingController _qty;
  late final TextEditingController _price;
  late final TextEditingController _discount;
  bool _percent = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final l = widget.controller.cart.line(widget.lineKey)!;
    _qty = TextEditingController(text: qtyText(l.qty));
    _price = TextEditingController(text: rupeesInput(l.price));
    _discount = TextEditingController(text: l.discount > 0 ? rupeesInput(l.discount) : '');
  }

  @override
  void dispose() {
    _qty.dispose();
    _price.dispose();
    _discount.dispose();
    super.dispose();
  }

  void _apply() {
    final l = AppLocalizations.of(context);
    final c = widget.controller;
    final q = double.tryParse(_qty.text.trim());
    if (q == null || q <= 0 || !RegExp(r'^\d*\.?\d{0,3}$').hasMatch(_qty.text.trim())) {
      setState(() => _error = l.qtyLabel);
      return;
    }
    c.setQty(widget.lineKey, q);
    if (c.canDiscount) {
      final price = parseRupees(_price.text);
      if (price == null) {
        setState(() => _error = l.priceLabel);
        return;
      }
      c.setPrice(widget.lineKey, price);
      if (_percent) {
        final pct = double.tryParse(_discount.text.trim().isEmpty ? '0' : _discount.text.trim());
        if (pct == null) {
          setState(() => _error = l.discountLabel);
          return;
        }
        c.setDiscountPercent(widget.lineKey, pct);
      } else {
        final d = parseRupees(_discount.text);
        if (d == null) {
          setState(() => _error = l.discountLabel);
          return;
        }
        c.setDiscount(widget.lineKey, d);
      }
    }
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final c = widget.controller;
    final line = c.cart.line(widget.lineKey);
    if (line == null) return const SizedBox.shrink();
    final number = [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))];
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(line.product.name, style: Theme.of(context).textTheme.titleMedium),
          if (line.priceChanged) Text(formatPaise(line.listPrice), style: const TextStyle(decoration: TextDecoration.lineThrough)),
          const SizedBox(height: 12),
          TextField(
            key: const Key('line.qty'),
            controller: _qty,
            enabled: line.serials.isEmpty,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: number,
            decoration: InputDecoration(labelText: l.qtyLabel, suffixText: line.product.unit),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('line.price'),
            controller: _price,
            enabled: c.canDiscount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: number,
            decoration: InputDecoration(labelText: l.priceLabel, suffixIcon: c.canDiscount ? null : const Icon(Icons.lock_outline)),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('line.discount'),
                  controller: _discount,
                  enabled: c.canDiscount,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: number,
                  decoration: InputDecoration(labelText: l.discountLabel),
                ),
              ),
              const SizedBox(width: 8),
              SegmentedButton<bool>(
                segments: [
                  ButtonSegment(value: false, label: Text(l.discountRupees)),
                  ButtonSegment(value: true, label: Text(l.discountPercent)),
                ],
                selected: {_percent},
                onSelectionChanged: c.canDiscount ? (v) => setState(() => _percent = v.first) : null,
              ),
            ],
          ),
          if (!c.canDiscount) Padding(padding: const EdgeInsets.only(top: 8), child: Text(l.priceLocked)),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          const SizedBox(height: 16),
          Row(
            children: [
              TextButton.icon(
                key: const Key('line.remove'),
                onPressed: () {
                  c.remove(widget.lineKey);
                  Navigator.pop(context);
                },
                icon: const Icon(Icons.delete_outline),
                label: Text(l.remove),
              ),
              const Spacer(),
              FilledButton(key: const Key('line.apply'), onPressed: _apply, child: Text(l.apply)),
            ],
          ),
        ],
      ),
    );
  }
}
