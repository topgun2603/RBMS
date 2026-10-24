import 'dart:async';

import 'package:flutter/material.dart' hide Page;
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../errors.dart';
import '../orders/order_text.dart';
import 'product_detail.dart';
import 'product_form.dart';
import 'product_rules.dart';

/// Products (More → Products; feature `catalogue`): search, category filter, archived toggle, stock badge, infinite
/// scroll. New product needs `catalogue.manage`.
class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key});

  static const searchField = Key('products.search');
  static const addButton = Key('products.add');

  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  static const _pageSize = 30;
  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;
  String? _categoryId;
  bool _archived = false;
  List<Category> _categories = const [];
  List<ProductRow> _items = const [];
  int _total = 0;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) _more();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _reload();
      _loadCategories();
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  SrikitApi get _api => AppScope.read(context).api;

  Future<void> _loadCategories() async {
    try {
      final c = await _api.categories();
      if (mounted) setState(() => _categories = c.items.where((x) => x.active).toList());
    } catch (_) {}
  }

  Future<Page<ProductRow>> _page(int offset) => _api.products(
        q: _search.text,
        categoryId: _categoryId,
        statuses: _archived ? const ['archived'] : const ['active', 'draft'],
        limit: _pageSize,
        offset: offset,
      );

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final p = await _page(0);
      if (!mounted) return;
      setState(() {
        _items = p.items;
        _total = p.total ?? p.items.length;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _more() async {
    if (_loading || _items.length >= _total) return;
    setState(() => _loading = true);
    try {
      final p = await _page(_items.length);
      if (mounted) setState(() => _items = [..._items, ...p.items]);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _open(ProductRow row) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductDetailScreen(productId: row.id, categoryName: row.categoryName)));
    if (mounted) _reload();
  }

  Future<void> _create() async {
    final created = await Navigator.of(context).push<Product>(MaterialPageRoute(builder: (_) => NewProductScreen(categories: _categories)));
    if (created != null && mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final gates = GateScope.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.productsTitle)),
      floatingActionButton: gates.can(CatalogKeys.manage)
          ? FloatingActionButton.extended(
              key: ProductsScreen.addButton,
              onPressed: _create,
              icon: const Icon(Icons.add),
              label: Text(l.productNew),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: TextField(
              key: ProductsScreen.searchField,
              controller: _search,
              onChanged: (_) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 300), _reload);
              },
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.productsSearch),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: [
                Expanded(
                  child: DropdownButton<String?>(
                    isExpanded: true,
                    value: _categoryId,
                    items: [
                      DropdownMenuItem(value: null, child: Text(l.allCategories)),
                      for (final c in _categories) DropdownMenuItem(value: c.id, child: Text(c.name)),
                    ],
                    onChanged: (v) {
                      setState(() => _categoryId = v);
                      _reload();
                    },
                  ),
                ),
                const SizedBox(width: 8),
                FilterChip(
                  label: Text(l.productArchived),
                  selected: _archived,
                  onSelected: (v) {
                    setState(() => _archived = v);
                    _reload();
                  },
                ),
              ],
            ),
          ),
          if (_loading && _items.isEmpty) const LinearProgressIndicator(minHeight: 2),
          if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(errorText(l, _error), style: TextStyle(color: theme.colorScheme.error))),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _reload,
              child: _items.isEmpty && !_loading
                  ? ListView(children: [Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(l.productsEmpty)))])
                  : ListView.separated(
                      controller: _scroll,
                      physics: const AlwaysScrollableScrollPhysics(),
                      itemCount: _items.length,
                      separatorBuilder: (_, i) => const Divider(height: 1),
                      itemBuilder: (context, i) {
                        final p = _items[i];
                        final price = p.priceMin == p.priceMax ? formatPaise(p.priceMin) : '${formatPaise(p.priceMin)} – ${formatPaise(p.priceMax)}';
                        return ListTile(
                          key: Key('products.row.$i'),
                          onTap: () => _open(p),
                          title: Text(p.name),
                          subtitle: Text([
                            if (p.categoryName != null) p.categoryName!,
                            price,
                            if (p.variantCount > 1) l.variantsCount(p.variantCount),
                          ].join(' · ')),
                          trailing: StockBadgeView(row: p),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The product row's stock: nothing when the shop doesn't track stock, "Not tracked", or qty with ok / low / out.
class StockBadgeView extends StatelessWidget {
  const StockBadgeView({super.key, required this.row});
  final ProductRow row;

  @override
  Widget build(BuildContext context) {
    if (!row.stockTracked) return const SizedBox.shrink();
    final l = AppLocalizations.of(context);
    final c = Theme.of(context).colorScheme;
    final s = row.stock;
    if (s == null) return Pill(l.stockNotTracked, c.outline);
    return Pill(stockStatusText(l, s.status, s.qty), stockColor(c, s.status));
  }
}

String stockStatusText(AppLocalizations l, String status, double qty) {
  final q = qty == qty.roundToDouble() ? qty.toInt().toString() : qty.toStringAsFixed(3).replaceFirst(RegExp(r'0+$'), '');
  return switch (status) {
    'out' => l.stockOut,
    'low' => l.stockLow(q),
    _ => l.stockQty(q),
  };
}

Color stockColor(ColorScheme c, String status) => switch (status) {
      'out' => c.error,
      'low' => Colors.orange.shade700,
      _ => Colors.green.shade700,
    };
