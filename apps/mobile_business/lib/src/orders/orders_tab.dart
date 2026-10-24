import 'dart:async';

import 'package:flutter/material.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../errors.dart';
import 'order_actions.dart';
import 'order_detail.dart';
import 'order_rules.dart';
import 'order_text.dart';

/// Orders: status chips with counts, search, pull to refresh, infinite scroll. New orders arriving while the tab is
/// open (the watcher's count goes up) reload the list.
class OrdersTab extends StatefulWidget {
  const OrdersTab({super.key});

  static const searchField = Key('orders.search');

  @override
  State<OrdersTab> createState() => _OrdersTabState();
}

class _OrdersTabState extends State<OrdersTab> {
  static const _pageSize = 30;
  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;
  String? _status;
  List<OrderRow> _items = const [];
  Map<String, int> _counts = const {};
  int _total = 0;
  bool _loading = false;
  Object? _error;
  OrdersWatcherListener? _watch;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) _loadMore();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _watch = OrdersWatcherListener(AppScope.read(context).ordersWatcher(), _reload);
      _reload();
    });
  }

  @override
  void dispose() {
    _watch?.dispose();
    _debounce?.cancel();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  SrikitApi get _api => AppScope.read(context).api;

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await _api.orders(q: _search.text, statuses: _status == null ? null : [_status!], limit: _pageSize);
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _counts = page.counts;
        _total = page.total;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadMore() async {
    if (_loading || _items.length >= _total) return;
    setState(() => _loading = true);
    try {
      final page = await _api.orders(
          q: _search.text, statuses: _status == null ? null : [_status!], limit: _pageSize, offset: _items.length);
      if (mounted) setState(() => _items = [..._items, ...page.items]);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), _reload);
  }

  Future<void> _open(OrderRow row) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: row.id)));
    if (mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final all = _counts.values.fold(0, (a, b) => a + b);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: TextField(
            key: OrdersTab.searchField,
            controller: _search,
            onChanged: _onSearch,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.ordersSearch),
          ),
        ),
        SizedBox(
          height: 52,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            children: [
              _chip(l.ordersAll, all, null),
              for (final s in orderStatuses) _chip(orderStatusLabel(l, s), _counts[s] ?? 0, s),
            ],
          ),
        ),
        if (_loading && _items.isEmpty) const LinearProgressIndicator(minHeight: 2),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(8),
            child: Text(errorText(l, _error), style: TextStyle(color: theme.colorScheme.error)),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _reload,
            child: _items.isEmpty && !_loading
                ? ListView(children: [Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(l.ordersEmpty)))])
                : ListView.separated(
                    controller: _scroll,
                    physics: const AlwaysScrollableScrollPhysics(),
                    itemCount: _items.length,
                    separatorBuilder: (_, i) => const Divider(height: 1),
                    itemBuilder: (context, i) {
                      final o = _items[i];
                      return ListTile(
                        key: Key('orders.row.${o.number}'),
                        onTap: () => _open(o),
                        title: Text('${o.number} · ${o.customerName}', maxLines: 1, overflow: TextOverflow.ellipsis),
                        subtitle: Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Wrap(
                            spacing: 6,
                            runSpacing: 4,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Pill(orderStatusLabel(l, o.status), orderStatusColor(theme.colorScheme, o.status)),
                              Pill(paymentStatusLabel(l, o.paymentStatus), paymentStatusColor(theme.colorScheme, o.paymentStatus)),
                              Text('${istDateTime(o.placedAt, locale)} · ${l.itemsCount(o.itemCount)}', style: theme.textTheme.bodySmall),
                            ],
                          ),
                        ),
                        trailing: Text(formatPaise(o.total), style: theme.textTheme.titleSmall),
                      );
                    },
                  ),
          ),
        ),
      ],
    );
  }

  Widget _chip(String label, int count, String? status) => Padding(
        padding: const EdgeInsets.only(right: 6),
        child: ChoiceChip(
          key: Key('orders.chip.${status ?? 'all'}'),
          label: Text('$label · $count'),
          selected: _status == status,
          onSelected: (_) {
            setState(() => _status = status);
            _reload();
          },
        ),
      );
}

/// Reloads the list when the new-order count goes up.
class OrdersWatcherListener {
  OrdersWatcherListener(this.watcher, this.onNew) : _seen = watcher.newOrders {
    watcher.addListener(_changed);
  }
  final OrdersWatcher watcher;
  final Future<void> Function() onNew;
  int _seen;

  void _changed() {
    final n = watcher.newOrders;
    if (n > _seen) onNew();
    _seen = n;
  }

  void dispose() => watcher.removeListener(_changed);
}

