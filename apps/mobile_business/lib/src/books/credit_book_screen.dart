import 'dart:async';

import 'package:flutter/material.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../errors.dart';
import 'books_rules.dart';
import 'books_text.dart';
import 'credit_flows.dart';
import 'customers_screen.dart';

/// More → Credit book (credit-book.tsx): the shop's totals, due / advance / all, overdue-age buckets with the
/// server's counts, the web's sorts (biggest dues first by default), search, and per row Receive / Remind.
class CreditBookScreen extends StatefulWidget {
  const CreditBookScreen({super.key});

  static const searchField = Key('creditBook.search');
  static const sortButton = Key('creditBook.sort');

  @override
  State<CreditBookScreen> createState() => _CreditBookScreenState();
}

class _CreditBookScreenState extends State<CreditBookScreen> {
  static const _pageSize = 50;
  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;

  /// null = everyone (the server's `all`), `due`, `advance`.
  String? _side;
  final Set<String> _ages = {};
  String _sort = '-due';
  CreditBookPage? _page;
  List<CreditBookRow> _items = const [];
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) _more();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<CreditBookPage> _fetch(int offset) => AppScope.read(context)
      .api
      .creditBook(q: _search.text, filter: _side, age: _ages.toList(), sort: _sort, limit: _pageSize, offset: offset);

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final p = await _fetch(0);
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
      final next = await _fetch(_items.length);
      if (mounted) setState(() => _items = [..._items, ...next.items]);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// The row's customer with the row's balance (the list's `balance` is the ledger balance).
  Customer _customerOf(CreditBookRow r) {
    final c = r.customer;
    return Customer(
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      gstin: c.gstin,
      address: c.address,
      stateCode: c.stateCode,
      openingBalance: c.openingBalance,
      creditLimit: c.creditLimit,
      outstanding: r.balance,
      advance: c.advance,
      createdAt: c.createdAt,
      overdue: r.overdue,
    );
  }

  String _sortLabel(AppLocalizations l, String s) => switch (s) {
        '-due' => l.sortBiggestDue,
        'oldestDue' => l.sortOldestDue,
        '-lastPayment' => l.sortLastPayment,
        _ => l.sortName,
      };

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final access = BooksAccess(GateScope.of(context));
    final totals = _page?.totals;
    final ages = _page?.ageCounts ?? const {};
    return Scaffold(
      appBar: AppBar(
        title: Text(l.creditBookTitle),
        actions: [
          PopupMenuButton<String>(
            key: CreditBookScreen.sortButton,
            icon: const Icon(Icons.sort),
            tooltip: l.sortLabel,
            initialValue: _sort,
            onSelected: (s) {
              setState(() => _sort = s);
              _reload();
            },
            itemBuilder: (_) => [
              for (final s in const ['-due', 'oldestDue', '-lastPayment', 'name']) PopupMenuItem(value: s, child: Text(_sortLabel(l, s))),
            ],
          ),
        ],
      ),
      body: Column(children: [
        if (totals != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Row(children: [
              _Total(label: l.toReceive, value: formatPaise(totals.receivable, decimals: false), keyName: 'creditBook.receivable'),
              _Total(label: l.advanceHeld, value: formatPaise(totals.advance, decimals: false), keyName: 'creditBook.advance'),
              _Total(label: l.customersWithDues, value: '${totals.customersWithDues}', keyName: 'creditBook.withDues'),
            ]),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: TextField(
            key: CreditBookScreen.searchField,
            controller: _search,
            onChanged: (_) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 300), _reload);
            },
            decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.creditBookSearch),
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: Row(children: [
            for (final s in const ['due', 'advance', null])
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ChoiceChip(
                  key: Key('creditBook.side.${s ?? 'all'}'),
                  label: Text(switch (s) {
                    'due' => totals != null && totals.customersWithDues > 0 ? '${l.balanceDueShort} · ${totals.customersWithDues}' : l.balanceDueShort,
                    'advance' => l.balanceAdvanceShort,
                    _ => l.ordersAll,
                  }),
                  selected: _side == s,
                  onSelected: (_) {
                    setState(() => _side = s);
                    _reload();
                  },
                ),
              ),
          ]),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: Row(children: [
            Padding(padding: const EdgeInsets.only(right: 6), child: Text(l.overdueFor, style: theme.textTheme.bodySmall)),
            for (final a in ageBuckets)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: FilterChip(
                  key: Key('creditBook.age.$a'),
                  label: Text((ages[a] ?? 0) > 0 ? '${ageLabel(l, a)} · ${ages[a]}' : ageLabel(l, a)),
                  selected: _ages.contains(a),
                  onSelected: (on) {
                    setState(() => on ? _ages.add(a) : _ages.remove(a));
                    _reload();
                  },
                ),
              ),
          ]),
        ),
        if (_loading && _items.isEmpty) const LinearProgressIndicator(minHeight: 2),
        if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(errorText(l, _error), style: TextStyle(color: theme.colorScheme.error))),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _reload,
            child: _items.isEmpty && !_loading
                ? ListView(children: [
                    Padding(
                      padding: const EdgeInsets.all(32),
                      child: Center(
                        child: Text(
                          switch (_side) {
                            _ when _search.text.isNotEmpty || _ages.isNotEmpty => l.customersNoMatch,
                            'due' => l.creditBookNoDues,
                            'advance' => l.creditBookNoAdvances,
                            _ => l.creditBookEmpty,
                          },
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                  ])
                : ListView.separated(
                    controller: _scroll,
                    physics: const AlwaysScrollableScrollPhysics(),
                    itemCount: _items.length,
                    separatorBuilder: (_, i) => const Divider(height: 1),
                    itemBuilder: (context, i) {
                      final r = _items[i];
                      final c = _customerOf(r);
                      final side = balanceSide(r.balance);
                      return InkWell(
                        key: Key('creditBook.row.$i'),
                        onTap: () => Navigator.of(context)
                            .push(MaterialPageRoute(builder: (_) => CustomerDetailScreen(customerId: c.id, initial: c)))
                            .then((_) => _reload()),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
                          child: Row(children: [
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(c.name, style: theme.textTheme.titleSmall),
                                Text(
                                  r.oldestDue != null
                                      ? l.dueSince(dayLabel(r.oldestDue!, l.localeName))
                                      : (r.lastActivity != null ? l.lastActivity(dayLabel(r.lastActivity!, l.localeName)) : l.noActivity),
                                  style: theme.textTheme.bodySmall,
                                ),
                                if (r.overdue > 0) Text(l.overdueAmount(formatPaise(r.overdue)), style: TextStyle(fontSize: 12, color: theme.colorScheme.error)),
                              ]),
                            ),
                            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                              Text(formatPaise(r.balance.abs()), style: TextStyle(fontWeight: FontWeight.w700, color: sideColor(theme.colorScheme, side))),
                              SidePill(r.balance),
                            ]),
                            if (access.receive)
                              IconButton(
                                key: Key('creditBook.receive.$i'),
                                tooltip: l.receiveFrom(c.name),
                                icon: const Icon(Icons.account_balance_wallet_outlined),
                                onPressed: () async {
                                  if (await showReceiveSheet(context, c)) _reload();
                                },
                              ),
                            if (access.remind && r.balance > 0)
                              IconButton(
                                key: Key('creditBook.remind.$i'),
                                tooltip: l.remindName(c.name),
                                icon: const Icon(Icons.notifications_active_outlined),
                                onPressed: () => sendReminder(context, c, balance: r.balance),
                              ),
                          ]),
                        ),
                      );
                    },
                  ),
          ),
        ),
      ]),
    );
  }
}

class _Total extends StatelessWidget {
  const _Total({required this.label, required this.value, required this.keyName});
  final String label;
  final String value;
  final String keyName;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Card(
        margin: const EdgeInsets.only(right: 6),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: theme.textTheme.bodySmall, maxLines: 2),
            Text(value, key: Key(keyName), style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          ]),
        ),
      ),
    );
  }
}
