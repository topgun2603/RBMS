import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../counter/cart.dart';
import '../counter/counter_text.dart';
import '../counter/scan_screen.dart';
import '../counter/tender.dart';
import '../errors.dart';
import '../orders/order_text.dart';
import '../stock/stock_screen.dart';
import 'product_rules.dart';
import 'products_screen.dart';

/// A product: its variants (price, MRP, SKU, barcode, stock), quick edit of price / MRP / barcode / SKU, archive.
class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.productId, this.categoryName});
  final String productId;
  final String? categoryName;

  static const menu = Key('product.menu');

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  Product? _product;
  Map<String, StockItem> _stock = const {};
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final app = AppScope.read(context);
    try {
      final p = await app.api.product(widget.productId);
      var stock = <String, StockItem>{};
      if (app.gates.feature(CatalogKeys.inventory)) {
        // Per variant, as the web's product editor shows stock (404 = not tracked yet).
        final rows = await Future.wait(p.variants.map((v) => app.api.stockItem(v.id).then<StockItem?>((s) => s, onError: (Object _) => null)));
        stock = {for (final s in rows.whereType<StockItem>()) s.itemId: s};
      }
      if (!mounted) return;
      setState(() {
        _product = p;
        _stock = stock;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _setStatus(String status) async {
    final l = AppLocalizations.of(context);
    final app = AppScope.read(context);
    final p = _product!;
    if (status == 'archived') {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(l.productArchiveTitle),
          content: Text(l.productArchiveBody),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.cancel)),
            FilledButton(key: const Key('product.archiveConfirm'), onPressed: () => Navigator.pop(ctx, true), child: Text(l.productArchive)),
          ],
        ),
      );
      if (ok != true) return;
    }
    setState(() => _busy = true);
    try {
      final r = await app.catalogKeys().once('product.status:${p.id}:$status',
          (k) => app.api.updateProduct(p.id, {'status': status}, idempotencyKey: k));
      if (mounted) setState(() => _product = r.value);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(l, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit(ProductVariant v) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => VariantEditSheet(product: _product!, variant: v),
    );
    if (changed == true && mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final gates = GateScope.of(context);
    final p = _product;
    if (p == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: _error == null
              ? const CircularProgressIndicator()
              : Column(mainAxisSize: MainAxisSize.min, children: [Text(errorText(l, _error)), TextButton(onPressed: _load, child: Text(l.retry))]),
        ),
      );
    }
    final canManage = gates.can(CatalogKeys.manage);
    return Scaffold(
      appBar: AppBar(
        title: Text(p.name),
        actions: [
          if (canManage)
            PopupMenuButton<String>(
              key: ProductDetailScreen.menu,
              enabled: !_busy,
              onSelected: _setStatus,
              itemBuilder: (_) => [
                if (p.archived)
                  PopupMenuItem(value: 'active', child: Text(l.productUnarchive))
                else
                  PopupMenuItem(value: 'archived', child: Text(l.productArchive)),
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
              if (p.archived) Pill(l.productArchived, theme.colorScheme.outline),
              if (p.status == 'draft') Pill(l.productDraft, theme.colorScheme.outline),
              if (widget.categoryName != null) Text(widget.categoryName!),
              Text(l.productTax(qtyText(p.gstRate), p.taxInclusive ? l.taxIncluded : l.taxExtra), style: theme.textTheme.bodySmall),
              Text(p.unit, style: theme.textTheme.bodySmall),
            ]),
            if (_busy) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator()),
            const SizedBox(height: 12),
            for (final v in p.variants)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Expanded(child: Text(v.title.isEmpty ? p.name : v.title, style: theme.textTheme.titleMedium)),
                        if (canManage)
                          IconButton(key: Key('variant.edit.${v.id}'), icon: const Icon(Icons.edit_outlined), onPressed: () => _edit(v)),
                      ]),
                      Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                        Text(formatPaise(v.price), key: Key('variant.price.${v.id}'), style: theme.textTheme.titleLarge),
                        if (v.mrp != null && v.mrp! > v.price) ...[
                          Text(formatPaise(v.mrp!), style: const TextStyle(decoration: TextDecoration.lineThrough)),
                          Text(l.percentOff(discountPercent(v.price, v.mrp)!), style: TextStyle(color: Colors.green.shade700)),
                        ],
                      ]),
                      const SizedBox(height: 4),
                      Text('${l.skuLabel}: ${v.sku ?? '—'}  ·  ${l.barcodeLabel}: ${v.barcode ?? '—'}', style: theme.textTheme.bodySmall),
                      if (gates.feature(CatalogKeys.inventory))
                        _stock[v.id] == null
                            ? Text(l.stockNotTracked, style: theme.textTheme.bodySmall)
                            : InkWell(
                                key: Key('variant.stock.${v.id}'),
                                onTap: () => Navigator.of(context)
                                    .push(MaterialPageRoute(builder: (_) => StockItemScreen(itemId: v.id, name: v.title.isEmpty ? p.name : '${p.name} ${v.title}')))
                                    .then((_) => _load()),
                                child: Padding(
                                  padding: const EdgeInsets.only(top: 6),
                                  child: Pill(stockStatusText(l, _stock[v.id]!.status, _stock[v.id]!.qty),
                                      stockColor(theme.colorScheme, _stock[v.id]!.status)),
                                ),
                              ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Quick edit of a variant's price, MRP, barcode (type or scan) and SKU. Without `catalogue.variants` only the price
/// can change (through the billing-item fallback, GST-exclusive rate), as in the web editor.
class VariantEditSheet extends StatefulWidget {
  const VariantEditSheet({super.key, required this.product, required this.variant});
  final Product product;
  final ProductVariant variant;

  static const priceField = Key('variantEdit.price');
  static const mrpField = Key('variantEdit.mrp');
  static const barcodeField = Key('variantEdit.barcode');
  static const skuField = Key('variantEdit.sku');
  static const scanButton = Key('variantEdit.scan');
  static const saveButton = Key('variantEdit.save');

  @override
  State<VariantEditSheet> createState() => _VariantEditSheetState();
}

class _VariantEditSheetState extends State<VariantEditSheet> {
  late final _price = TextEditingController(text: rupeesInput(widget.variant.price));
  late final _mrp = TextEditingController(text: widget.variant.mrp == null ? '' : rupeesInput(widget.variant.mrp!));
  late final _barcode = TextEditingController(text: widget.variant.barcode ?? '');
  late final _sku = TextEditingController(text: widget.variant.sku ?? '');
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_price, _mrp, _barcode, _sku]) {
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
    final variants = app.gates.feature(CatalogKeys.variants);
    final v = widget.variant;
    final price = parseRupees(_price.text);
    final mrp = _mrp.text.trim().isEmpty ? null : parseRupees(_mrp.text);
    if (price == null || _price.text.trim().isEmpty || price > maxPaise) return setState(() => _error = l.priceLabel);
    if (_mrp.text.trim().isNotEmpty && (mrp == null || mrp > maxPaise)) return setState(() => _error = l.mrpLabel);
    if (validateCode(_barcode.text) != null) return setState(() => _error = l.codeFieldInvalid(l.barcodeLabel));
    if (validateCode(_sku.text) != null) return setState(() => _error = l.codeFieldInvalid(l.skuLabel));
    String? code(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    // Only what changed, as the web sends it.
    final patch = <String, Object?>{
      if (price != v.price) 'price': price,
      if (mrp != v.mrp) 'mrp': mrp,
      if (code(_barcode) != v.barcode) 'barcode': code(_barcode),
      if (code(_sku) != v.sku) 'sku': code(_sku),
    };
    if (patch.isEmpty) return Navigator.pop(context, false);
    if (!variants && patch.keys.any((k) => k != 'price')) return setState(() => _error = l.variantsFeatureNeeded);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final keys = app.catalogKeys();
      if (variants) {
        await keys.once('variant.patch:${v.id}:${patch.entries.map((e) => '${e.key}=${e.value}').join(',')}',
            (k) => app.api.updateVariant(v.id, patch, idempotencyKey: k));
      } else {
        final rate = exclusiveOf(price, widget.product.gstRate, widget.product.taxInclusive);
        await keys.once('item.rate:${v.id}:$rate', (k) => app.api.updateItemRate(v.id, rate, idempotencyKey: k));
      }
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final variants = GateScope.of(context).feature(CatalogKeys.variants);
    final money = [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))];
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.variant.title.isEmpty ? widget.product.name : widget.variant.title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            TextField(
              key: VariantEditSheet.priceField,
              controller: _price,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: money,
              decoration: InputDecoration(labelText: l.priceLabel, helperText: widget.product.taxInclusive ? l.taxIncluded : l.taxExtra),
            ),
            TextField(
              key: VariantEditSheet.mrpField,
              controller: _mrp,
              enabled: variants,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: money,
              decoration: InputDecoration(labelText: l.mrpLabel),
            ),
            TextField(
              key: VariantEditSheet.barcodeField,
              controller: _barcode,
              enabled: variants,
              decoration: InputDecoration(
                labelText: l.barcodeLabel,
                suffixIcon: IconButton(key: VariantEditSheet.scanButton, icon: const Icon(Icons.qr_code_scanner), onPressed: variants ? _scan : null),
              ),
            ),
            TextField(key: VariantEditSheet.skuField, controller: _sku, enabled: variants, decoration: InputDecoration(labelText: l.skuLabel)),
            if (!variants) Padding(padding: const EdgeInsets.only(top: 8), child: Text(l.variantsFeatureNeeded)),
            if (_error != null)
              Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
            const SizedBox(height: 12),
            FilledButton(key: VariantEditSheet.saveButton, onPressed: _busy ? null : _save, child: Text(l.save)),
          ],
        ),
      ),
    );
  }
}
