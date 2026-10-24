import 'dart:async';

import 'package:flutter/material.dart' hide Page;
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../counter/counter_text.dart';
import '../errors.dart';
import '../orders/order_text.dart';
import '../products/product_rules.dart';
import '../products/products_screen.dart';

/// Stock (More → Stock; feature `inventory`): all / low / out, search, totals, and a location picker only when the
/// shop has more than one location (`inventory.locations`).
class StockScreen extends StatefulWidget {
  const StockScreen({super.key});

  static const searchField = Key('stock.search');

  @override
  State<StockScreen> createState() => _StockScreenState();
}

class _StockScreenState extends State<StockScreen> {
  static const _pageSize = 50;
  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;

  /// null = all, `low`, `out`.
  String? _filter;
  String? _locationId;
  List<StockLocation> _locations = const [];
  StockPage? _page;
  List<StockItem> _items = const [];
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
      _loadLocations();
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

  Future<void> _loadLocations() async {
    if (!AppScope.read(context).gates.feature(CatalogKeys.locations)) return;
    try {
      final l = await _api.stockLocations();
      if (mounted) setState(() => _locations = l.items.where((x) => x.active).toList());
    } catch (_) {}
  }

  List<String>? get _statuses => switch (_filter) {
        'low' => const ['low'],
        'out' => const ['out'],
        _ => null,
      };

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final p = await _api.stock(q: _search.text, statuses: _statuses, locationId: _locationId, limit: _pageSize);
      if (!mounted) return;
      setState(() {
        _page = p;
        _items = p.items;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _more() async {
    final p = _page;
    if (_loading || p == null || _items.length >= p.total) return;
    setState(() => _loading = true);
    try {
      final next = await _api.stock(q: _search.text, statuses: _statuses, locationId: _locationId, limit: _pageSize, offset: _items.length);
      if (mounted) setState(() => _items = [..._items, ...next.items]);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final gates = GateScope.of(context);
    final p = _page;
    final picker = showLocationPicker(gates.feature(CatalogKeys.locations), _locations.length);
    return Scaffold(
      appBar: AppBar(title: Text(l.stockTitle)),
      body: Column(
        children: [
          if (p != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Row(children: [
                Expanded(child: Text(l.stockValue(formatPaise(p.stockValue, decimals: false)), style: theme.textTheme.bodySmall)),
                Text(l.stockLowOut(p.lowCount, p.outCount), style: theme.textTheme.bodySmall),
              ]),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: TextField(
              key: StockScreen.searchField,
              controller: _search,
              onChanged: (_) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 300), _reload);
              },
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.productsSearch),
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(children: [
              for (final f in const [null, 'low', 'out'])
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    key: Key('stock.filter.${f ?? 'all'}'),
                    label: Text(switch (f) { 'low' => l.stockFilterLow, 'out' => l.stockFilterOut, _ => l.ordersAll }),
                    selected: _filter == f,
                    onSelected: (_) {
                      setState(() => _filter = f);
                      _reload();
                    },
                  ),
                ),
              if (picker)
                DropdownButton<String?>(
                  key: const Key('stock.location'),
                  value: _locationId,
                  items: [
                    DropdownMenuItem(value: null, child: Text(l.allLocations)),
                    for (final loc in _locations) DropdownMenuItem(value: loc.id, child: Text(loc.name)),
                  ],
                  onChanged: (v) {
                    setState(() => _locationId = v);
                    _reload();
                  },
                ),
            ]),
          ),
          if (_loading && _items.isEmpty) const LinearProgressIndicator(minHeight: 2),
          if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(errorText(l, _error), style: TextStyle(color: theme.colorScheme.error))),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _reload,
              child: _items.isEmpty && !_loading
                  ? ListView(children: [Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(l.stockEmpty)))])
                  : ListView.separated(
                      controller: _scroll,
                      physics: const AlwaysScrollableScrollPhysics(),
                      itemCount: _items.length,
                      separatorBuilder: (_, i) => const Divider(height: 1),
                      itemBuilder: (context, i) {
                        final s = _items[i];
                        return ListTile(
                          key: Key('stock.row.$i'),
                          title: Text(s.name),
                          subtitle: Text(s.reserved > 0 ? l.stockAvailable(qtyText(s.available), qtyText(s.reserved)) : (s.categoryName ?? '')),
                          trailing: s.track
                              ? Pill(stockStatusText(l, s.status, s.qty), stockColor(theme.colorScheme, s.status))
                              : Pill(l.stockNotTracked, theme.colorScheme.outline),
                          onTap: () => Navigator.of(context)
                              .push(MaterialPageRoute(builder: (_) => StockItemScreen(itemId: s.itemId, name: s.name, locationId: _locationId)))
                              .then((_) => _reload()),
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

/// One item's stock: quantity, reserved / available, low-stock level, average cost, value, adjust, and movements.
class StockItemScreen extends StatefulWidget {
  const StockItemScreen({super.key, required this.itemId, required this.name, this.locationId});
  final String itemId;
  final String name;
  final String? locationId;

  static const adjustButton = Key('stockItem.adjust');

  @override
  State<StockItemScreen> createState() => _StockItemScreenState();
}

class _StockItemScreenState extends State<StockItemScreen> {
  StockItem? _item;
  List<StockMovement> _moves = const [];
  int _movesTotal = 0;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final api = AppScope.read(context).api;
    try {
      final r = await Future.wait<Object>([
        api.stockItem(widget.itemId, locationId: widget.locationId),
        api.stockMovements(widget.itemId, locationId: widget.locationId),
      ]);
      if (!mounted) return;
      final m = r[1] as Page<StockMovement>;
      setState(() {
        _item = r[0] as StockItem;
        _moves = m.items;
        _movesTotal = m.total ?? m.items.length;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _moreMoves() async {
    final api = AppScope.read(context).api;
    final m = await api.stockMovements(widget.itemId, locationId: widget.locationId, offset: _moves.length);
    if (mounted) setState(() => _moves = [..._moves, ...m.items]);
  }

  Future<void> _adjust() async {
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => AdjustSheet(item: _item!, locationId: widget.locationId),
    );
    if (done == true && mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final gates = GateScope.of(context);
    final s = _item;
    return Scaffold(
      appBar: AppBar(title: Text(widget.name)),
      floatingActionButton: s != null && gates.can(CatalogKeys.adjust)
          ? FloatingActionButton.extended(
              key: StockItemScreen.adjustButton,
              onPressed: _adjust,
              icon: const Icon(Icons.tune),
              label: Text(l.stockAdjust),
            )
          : null,
      body: s == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Column(mainAxisSize: MainAxisSize.min, children: [Text(errorText(l, _error)), TextButton(onPressed: _load, child: Text(l.retry))]),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                children: [
                  Row(children: [
                    Text('${qtyText(s.qty)} ${s.unit}', key: const Key('stockItem.qty'), style: theme.textTheme.headlineMedium),
                    const SizedBox(width: 12),
                    if (s.track) Pill(stockStatusText(l, s.status, s.qty), stockColor(theme.colorScheme, s.status)) else Pill(l.stockNotTracked, theme.colorScheme.outline),
                  ]),
                  if (s.reserved > 0) Text(l.stockAvailable(qtyText(s.available), qtyText(s.reserved))),
                  Text(l.reorderLevel(qtyText(s.reorderLevel))),
                  if (s.avgCost != null) Text(l.avgCost(formatPaise(s.avgCost!), formatPaise(s.value))),
                  const Divider(height: 32),
                  Text(l.stockMovements, style: theme.textTheme.titleMedium),
                  if (_moves.isEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(l.stockNoMovements)),
                  for (final m in _moves)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text([movementLabel(l, m.reason), if (m.refNumber != null) m.refNumber!].join(' · ')),
                      subtitle: Text([istDateTime(DateTime.tryParse(m.date), Localizations.localeOf(context).toLanguageTag()), if (m.note != null) m.note!].join(' · ')),
                      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text('${m.delta > 0 ? '+' : ''}${qtyText(m.delta)}',
                            style: TextStyle(color: m.delta < 0 ? theme.colorScheme.error : Colors.green.shade700, fontWeight: FontWeight.w600)),
                        Text(qtyText(m.qtyAfter), style: theme.textTheme.bodySmall),
                      ]),
                    ),
                  if (_moves.length < _movesTotal) TextButton(onPressed: _moreMoves, child: Text(l.loadMore)),
                ],
              ),
            ),
    );
  }
}

String movementLabel(AppLocalizations l, String reason) => switch (reason) {
      'opening' => l.moveOpening,
      'adjustment' => l.moveAdjustment,
      'sale' => l.moveSale,
      'sale_cancel' => l.moveSaleCancel,
      'sale_return' => l.moveSaleReturn,
      'sale_return_cancel' => l.moveSaleReturnCancel,
      'purchase' => l.movePurchase,
      'purchase_cancel' => l.movePurchaseCancel,
      'transfer_out' => l.moveTransferOut,
      'transfer_in' => l.moveTransferIn,
      _ => reason,
    };

/// Add / remove / set stock (inventory.adjust): quantity with up to 3 decimals, optional note; shows the stock after,
/// and warns (but allows, like the web) when it goes below zero.
class AdjustSheet extends StatefulWidget {
  const AdjustSheet({super.key, required this.item, this.locationId});
  final StockItem item;
  final String? locationId;

  static const qtyField = Key('adjust.qty');
  static const noteField = Key('adjust.note');
  static const saveButton = Key('adjust.save');

  @override
  State<AdjustSheet> createState() => _AdjustSheetState();
}

class _AdjustSheetState extends State<AdjustSheet> {
  final _qty = TextEditingController();
  final _note = TextEditingController();
  AdjustMode _mode = AdjustMode.add;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _qty.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _qty.dispose();
    _note.dispose();
    super.dispose();
  }

  String _message(AppLocalizations l, AdjustError e) => switch (e) {
        AdjustError.empty || AdjustError.invalid => l.qtyInvalid,
        AdjustError.tooManyDecimals => l.qtyDecimals,
        AdjustError.zero => l.qtyMoreThanZero,
        AdjustError.tooLarge => l.qtyInvalid,
        AdjustError.noteTooLong => l.tillNote,
      };

  Future<void> _save() async {
    final l = AppLocalizations.of(context);
    final err = validateAdjust(_mode, _qty.text, note: _note.text);
    if (err != null) return setState(() => _error = _message(l, err));
    final app = AppScope.read(context);
    final qty = parseQty(_qty.text)!;
    final it = widget.item;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await app.catalogKeys().once(
            'stock.adjust:${it.itemId}:${it.qty}:${_mode.name}:$qty:${_note.text.trim()}:${widget.locationId}',
            (k) => app.api.adjustStock(it.itemId,
                mode: _mode.name, qty: qty, note: _note.text, locationId: widget.locationId, idempotencyKey: k),
          );
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
    final theme = Theme.of(context);
    final it = widget.item;
    final q = parseQty(_qty.text);
    final after = q == null ? null : stockAfter(it.qty, _mode, q);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(it.name, style: theme.textTheme.titleMedium),
          Text(l.stockNow('${qtyText(it.qty)} ${it.unit}')),
          const SizedBox(height: 12),
          SegmentedButton<AdjustMode>(
            segments: [
              ButtonSegment(value: AdjustMode.add, label: Text(l.adjustAdd)),
              ButtonSegment(value: AdjustMode.remove, label: Text(l.adjustRemove)),
              ButtonSegment(value: AdjustMode.set, label: Text(l.adjustSet)),
            ],
            selected: {_mode},
            onSelectionChanged: (v) => setState(() => _mode = v.first),
          ),
          TextField(
            key: AdjustSheet.qtyField,
            controller: _qty,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
            decoration: InputDecoration(labelText: l.qtyLabel, suffixText: it.unit),
          ),
          TextField(key: AdjustSheet.noteField, controller: _note, maxLength: 500, decoration: InputDecoration(labelText: l.tillNote)),
          if (after != null)
            Text(l.stockAfter('${qtyText(after)} ${it.unit}'), key: const Key('adjust.after'), style: theme.textTheme.titleSmall),
          if (q != null && goesNegative(it.qty, _mode, q)) Text(l.stockNegativeWarning, style: TextStyle(color: Colors.orange.shade800)),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
          const SizedBox(height: 12),
          FilledButton(key: AdjustSheet.saveButton, onPressed: _busy ? null : _save, child: Text(l.save)),
        ],
      ),
    );
  }
}
