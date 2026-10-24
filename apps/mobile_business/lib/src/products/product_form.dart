import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../counter/scan_screen.dart';
import '../counter/tender.dart';
import '../errors.dart';
import 'product_rules.dart';

/// A new simple product, as the web form makes it: name, category, price (tax-inclusive by default), MRP, GST rate,
/// unit, barcode (type or scan), SKU, and opening stock when the shop tracks stock. Pops with the created product.
class NewProductScreen extends StatefulWidget {
  const NewProductScreen({super.key, this.categories = const []});
  final List<Category> categories;

  static const nameField = Key('newProduct.name');
  static const priceField = Key('newProduct.price');
  static const openingField = Key('newProduct.opening');
  static const saveButton = Key('newProduct.save');

  @override
  State<NewProductScreen> createState() => _NewProductScreenState();
}

class _NewProductScreenState extends State<NewProductScreen> {
  final _name = TextEditingController();
  final _price = TextEditingController();
  final _mrp = TextEditingController();
  final _barcode = TextEditingController();
  final _sku = TextEditingController();
  final _unit = TextEditingController(text: 'pcs');
  final _opening = TextEditingController();
  String? _categoryId;
  bool _taxInclusive = true;
  double _gstRate = 5;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_name, _price, _mrp, _barcode, _sku, _unit, _opening]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _scan() async {
    final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (code != null) _barcode.text = code;
  }

  Future<void> _save() async {
    final l = AppLocalizations.of(context);
    final app = AppScope.read(context);
    final price = parseRupees(_price.text);
    final mrp = _mrp.text.trim().isEmpty ? null : parseRupees(_mrp.text);
    final opening = _opening.text.trim().isEmpty ? 0.0 : parseQty(_opening.text);
    if (_name.text.trim().isEmpty) return setState(() => _error = l.customerNameRequired);
    if (price == null || _price.text.trim().isEmpty || price > maxPaise) return setState(() => _error = l.priceLabel);
    if (_mrp.text.trim().isNotEmpty && mrp == null) return setState(() => _error = l.mrpLabel);
    if (validateCode(_barcode.text) != null) return setState(() => _error = l.codeFieldInvalid(l.barcodeLabel));
    if (validateCode(_sku.text) != null) return setState(() => _error = l.codeFieldInvalid(l.skuLabel));
    if (opening == null) return setState(() => _error = l.qtyInvalid);
    final body = simpleProductBody(
      name: _name.text,
      categoryId: _categoryId,
      price: price,
      mrp: mrp,
      barcode: _barcode.text,
      sku: _sku.text,
      taxInclusive: _taxInclusive,
      gstRate: _gstRate,
      unit: _unit.text,
    );
    setState(() {
      _busy = true;
      _error = null;
    });
    final keys = app.catalogKeys();
    try {
      final created = (await keys.once('product.create:${body.toString()}', (k) => app.api.createProduct(body, idempotencyKey: k))).value;
      // Opening stock: a follow-up "set" (the web's editor does the same); a failure only warns.
      if (opening > 0 && created.variants.isNotEmpty) {
        final v = created.variants.first;
        try {
          await keys.once('stock.opening:${v.id}:$opening',
              (k) => app.api.adjustStock(v.id, mode: 'set', qty: opening, note: 'Opening stock', idempotencyKey: k));
        } on ApiException catch (e) {
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${l.openingStockFailed} ${errorText(l, e)}')));
        }
      }
      if (mounted) Navigator.pop(context, created);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final gates = GateScope.of(context);
    final money = [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))];
    final tracksStock = gates.feature(CatalogKeys.inventory) && gates.can(CatalogKeys.adjust);
    return Scaffold(
      appBar: AppBar(title: Text(l.productNew)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            key: NewProductScreen.nameField,
            controller: _name,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l.productName),
          ),
          DropdownButtonFormField<String?>(
            initialValue: _categoryId,
            decoration: InputDecoration(labelText: l.categoryLabel),
            items: [
              DropdownMenuItem(value: null, child: Text(l.noCategory)),
              for (final c in widget.categories) DropdownMenuItem(value: c.id, child: Text(c.name)),
            ],
            onChanged: (v) => setState(() => _categoryId = v),
          ),
          Row(children: [
            Expanded(
              child: TextField(
                key: NewProductScreen.priceField,
                controller: _price,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: money,
                decoration: InputDecoration(labelText: l.priceLabel),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _mrp,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: money,
                decoration: InputDecoration(labelText: l.mrpLabel),
              ),
            ),
          ]),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _taxInclusive,
            onChanged: (v) => setState(() => _taxInclusive = v),
            title: Text(l.priceIncludesGst),
          ),
          Row(children: [
            Expanded(
              child: DropdownButtonFormField<double>(
                initialValue: _gstRate,
                decoration: InputDecoration(labelText: l.gstRateLabel),
                items: [for (final r in gstRates) DropdownMenuItem(value: r, child: Text('${r.toInt()}%'))],
                onChanged: (v) => setState(() => _gstRate = v ?? 5),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(child: TextField(controller: _unit, maxLength: 16, decoration: InputDecoration(labelText: l.unitLabel))),
          ]),
          Wrap(spacing: 6, children: [
            for (final u in unitSuggestions.take(8)) ActionChip(label: Text(u), onPressed: () => setState(() => _unit.text = u)),
          ]),
          TextField(
            controller: _barcode,
            decoration: InputDecoration(
              labelText: l.barcodeLabel,
              suffixIcon: IconButton(icon: const Icon(Icons.qr_code_scanner), tooltip: l.scanBarcode, onPressed: _scan),
            ),
          ),
          TextField(controller: _sku, decoration: InputDecoration(labelText: l.skuLabel)),
          if (tracksStock)
            TextField(
              key: NewProductScreen.openingField,
              controller: _opening,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
              decoration: InputDecoration(labelText: l.openingStock, suffixText: _unit.text),
            ),
          if (_error != null)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
          const SizedBox(height: 16),
          FilledButton(key: NewProductScreen.saveButton, onPressed: _busy ? null : _save, child: Text(l.save)),
        ],
      ),
    );
  }
}
