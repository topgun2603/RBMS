import 'dart:async';

import 'package:flutter/material.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../errors.dart';
import '../pos/weigh.dart';
import '../pos/weighing_screen.dart';
import 'cart.dart';
import 'counter_controller.dart';
import 'counter_text.dart';
import 'customer_sheet.dart';
import 'line_sheet.dart';
import 'pay_screen.dart';
import 'scan_screen.dart';
import 'till_sheet.dart';

/// The Bill tab: till status, item search / scan / code, the cart, the customer, and Charge.
class BillTab extends StatefulWidget {
  const BillTab({super.key});

  static const searchField = Key('counter.search');
  static const scanButton = Key('counter.scan');
  static const chargeButton = Key('counter.charge');
  static const customerButton = Key('counter.customer');
  static const tillStrip = Key('counter.till');

  @override
  State<BillTab> createState() => _BillTabState();
}

class _BillTabState extends State<BillTab> {
  final _search = TextEditingController();
  Timer? _debounce;
  String _query = '';
  List<CartProduct> _results = const [];
  bool _searching = false;
  Object? _searchError;
  bool _charging = false;

  /// Category browse (terminals with the on-device catalogue).
  String? _category;

  /// The web counter's search debounce.
  static const _debounceTime = Duration(milliseconds: 150);

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  CounterController get _c => AppScope.read(context).counter();

  void _onQuery(String q) {
    _debounce?.cancel();
    setState(() => _query = q.trim());
    if (q.trim().isEmpty) {
      setState(() => _results = const []);
      return;
    }
    _debounce = Timer(_debounceTime, () => _runSearch(q.trim()));
  }

  Future<void> _runSearch(String q) async {
    setState(() {
      _searching = true;
      _searchError = null;
    });
    try {
      final r = await _c.search(q);
      if (!mounted || _query != q) return;
      setState(() => _results = r);
    } catch (e) {
      if (mounted) setState(() => _searchError = e);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  void _clearSearch() {
    _debounce?.cancel();
    _search.clear();
    setState(() {
      _query = '';
      _results = const [];
    });
  }

  void _toast(String text) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text), duration: const Duration(seconds: 2)));
  }

  /// Weight items ask for the weight in kg (3 decimals) unless a scale label gave it.
  Future<void> _add(CartProduct p, {double? qty, String? serial}) async {
    var q = qty;
    if (q == null && p.byWeight) {
      q = await askWeight(context, p.name);
      if (q == null || !mounted) return;
    }
    _c.addProduct(p, qty: q ?? 1, serial: serial);
    _clearSearch();
    _toast(AppLocalizations.of(context).itemAdded(p.name));
  }

  String _ticketText(AppLocalizations l, TicketProblem p) => switch (p.kind) {
        TicketProblemKind.notFound => l.ticketNotFound(p.code),
        TicketProblemKind.used => l.ticketUsed(p.code),
        TicketProblemKind.expired => l.ticketExpired(p.code),
        TicketProblemKind.cancelled => l.ticketCancelled(p.code),
        TicketProblemKind.duplicate => l.ticketDuplicate(p.code),
        TicketProblemKind.empty => l.ticketEmpty(p.code),
      };

  Future<void> _removeTicket(CartLine line) async {
    final l = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.removeTicketTitle(line.ticketCode ?? '')),
        content: Text(l.removeTicketBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.cancel)),
          FilledButton(key: const Key('counter.removeTicket'), onPressed: () => Navigator.pop(ctx, true), child: Text(l.remove)),
        ],
      ),
    );
    if (ok == true) _c.remove(line.key);
  }

  /// Enter in the search box: a code goes through lookup / resolve first, else the first result.
  Future<void> _submit(String text) async {
    final t = text.trim();
    if (t.isEmpty) return;
    if ((looksLikeCode(t) || isTicketCode(t)) && await _code(t)) return;
    if (_results.isEmpty) await _runSearch(t);
    if (!mounted) return;
    if (_results.isNotEmpty) {
      await _add(_results.first);
    } else {
      _toast(AppLocalizations.of(context).noResults);
    }
  }

  /// A scanned / typed code. Returns whether it added something.
  Future<bool> _code(String code) async {
    final l = AppLocalizations.of(context);
    try {
      final hit = await _c.lookupCode(code);
      if (!mounted) return hit != null;
      if (hit == null) {
        _toast(l.codeNotFound(code));
        return false;
      }
      final ticket = hit.ticket;
      if (ticket != null) {
        _c.addTicket(ticket);
        _clearSearch();
        _toast(l.ticketAdded(ticket.code));
        return true;
      }
      await _add(hit.product!, qty: hit.qty, serial: hit.serial);
      return true;
    } on TicketProblem catch (p) {
      if (mounted) _toast(_ticketText(l, p));
      return true; // it was a ticket code: don't search for it as text
    } on ApiException catch (e) {
      if (mounted) _toast(errorText(l, e));
      return false;
    }
  }

  Future<void> _scan() async {
    final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (code != null && mounted) await _code(code);
  }

  Future<void> _charge() async {
    final c = _c;
    final l = AppLocalizations.of(context);
    c.walkInDefaultName = l.walkInDefaultName;
    setState(() => _charging = true);
    try {
      await c.createBill();
      if (!mounted) return;
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => PayScreen(controller: c)));
    } on ApiException catch (e) {
      // The same cart pressed again reuses its Idempotency-Key: no second bill.
      if (mounted) _toast(errorText(l, e));
    } finally {
      if (mounted) setState(() => _charging = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = AppScope.of(context).counter();
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final l = AppLocalizations.of(context);
        final theme = Theme.of(context);
        return Column(
          children: [
            _TillStrip(controller: c),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
              child: TextField(
                key: BillTab.searchField,
                controller: _search,
                textInputAction: TextInputAction.search,
                onChanged: _onQuery,
                onSubmitted: _submit,
                decoration: InputDecoration(
                  hintText: l.searchItems,
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (_query.isNotEmpty) IconButton(icon: const Icon(Icons.clear), onPressed: _clearSearch),
                      IconButton(
                        key: BillTab.scanButton,
                        tooltip: l.scanBarcode,
                        icon: const Icon(Icons.qr_code_scanner),
                        onPressed: _scan,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (c.catalog != null && c.catalog!.categories.isNotEmpty)
              CategoryChips(
                categories: c.catalog!.categories,
                selected: _category,
                onSelected: (id) => setState(() => _category = id),
              ),
            if (_searching) const LinearProgressIndicator(minHeight: 2),
            Expanded(
              child: _query.isNotEmpty
                  ? _resultsList(l, theme)
                  : _category != null
                      ? _categoryList(c, l, theme)
                      : _cartList(c, l, theme),
            ),
            _ChargeBar(controller: c, charging: _charging, onCharge: _charge),
          ],
        );
      },
    );
  }

  Widget _resultsList(AppLocalizations l, ThemeData theme) {
    if (_searchError != null) {
      return Center(child: Text(errorText(l, _searchError), style: TextStyle(color: theme.colorScheme.error)));
    }
    if (_results.isEmpty) return Center(child: Text(_searching ? '' : l.noResults));
    return ListView.separated(
      itemCount: _results.length,
      separatorBuilder: (_, i) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final p = _results[i];
        return ListTile(
          key: Key('counter.result.$i'),
          title: Text(p.name),
          subtitle: Text([if (p.sku != null) p.sku!, p.unit].join(' · ')),
          trailing: Text(formatPaise(p.price), style: theme.textTheme.titleSmall),
          onTap: () => _add(p),
        );
      },
    );
  }

  /// The items of the picked category from the on-device catalogue.
  Widget _categoryList(CounterController c, AppLocalizations l, ThemeData theme) {
    final items = c.catalog!.index.search('', categoryId: _category, limit: 500).map(CartProduct.fromPosItem).toList();
    if (items.isEmpty) return Center(child: Text(l.noResults));
    return ListView.separated(
      itemCount: items.length,
      separatorBuilder: (_, i) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final p = items[i];
        return ListTile(
          key: Key('counter.category.$i'),
          leading: p.byWeight ? const Icon(Icons.scale) : null,
          title: Text(p.name),
          subtitle: Text([if (p.sku != null) p.sku!, p.unit].join(' · ')),
          trailing: Text(formatPaise(p.price), style: theme.textTheme.titleSmall),
          onTap: () async {
            await _add(p);
            if (mounted) setState(() => _category = null);
          },
        );
      },
    );
  }

  Widget _cartList(CounterController c, AppLocalizations l, ThemeData theme) {
    if (c.cart.isEmpty) {
      return Center(
        child: Padding(padding: const EdgeInsets.all(24), child: Text(l.cartEmpty, textAlign: TextAlign.center)),
      );
    }
    return ListView.separated(
      itemCount: c.cart.lines.length,
      separatorBuilder: (_, i) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final line = c.cart.lines[i];
        if (line.fixed) {
          return ListTile(
            key: Key('counter.line.$i'),
            onTap: () => _removeTicket(line),
            leading: const Icon(Icons.scale),
            title: Text(line.product.name),
            subtitle: Text('${qtyText(line.qty)} ${line.product.unit} × ${formatPaise(line.price)} · ${l.ticketLabel(line.ticketCode ?? '')}'),
            trailing: Text(formatPaise(line.gross), style: theme.textTheme.titleSmall),
          );
        }
        return ListTile(
          key: Key('counter.line.$i'),
          onTap: () => showLineSheet(context, c, line.key),
          title: Text(line.product.name),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${qtyText(line.qty)} ${line.product.unit} × ${formatPaise(line.price)}'
                  '${line.discount > 0 ? ' − ${formatPaise(line.discount)}' : ''}'),
              for (final s in line.serials) Text(l.serialLabel(s), style: theme.textTheme.bodySmall),
            ],
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                key: Key('counter.line.$i.minus'),
                icon: const Icon(Icons.remove_circle_outline),
                onPressed: line.qty <= 1 ? null : () => c.step(line.key, -1),
              ),
              Text(formatPaise(line.net), style: theme.textTheme.titleSmall),
              IconButton(
                key: Key('counter.line.$i.plus'),
                icon: const Icon(Icons.add_circle_outline),
                onPressed: line.serials.isNotEmpty ? null : () => c.step(line.key, 1),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _TillStrip extends StatelessWidget {
  const _TillStrip({required this.controller});
  final CounterController controller;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final c = controller;
    final open = c.dayOpen;
    final text = !c.tillLoaded
        ? l.loading
        : open
            ? l.tillOpenSince(clock(c.till!.openedAt))
            : (c.till?.status == 'closed' ? l.tillClosed : l.tillNotOpened);
    return Material(
      color: open ? theme.colorScheme.secondaryContainer : theme.colorScheme.errorContainer,
      child: InkWell(
        key: BillTab.tillStrip,
        onTap: () => showTillSheet(context, c),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              Icon(open ? Icons.point_of_sale : Icons.lock_clock,
                  size: 20, color: open ? theme.colorScheme.onSecondaryContainer : theme.colorScheme.onErrorContainer),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '$text · ${c.register}',
                  style: TextStyle(color: open ? theme.colorScheme.onSecondaryContainer : theme.colorScheme.onErrorContainer),
                ),
              ),
              const Icon(Icons.chevron_right, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _ChargeBar extends StatelessWidget {
  const _ChargeBar({required this.controller, required this.charging, required this.onCharge});
  final CounterController controller;
  final bool charging;
  final VoidCallback onCharge;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final c = controller;
    final who = switch (c.customer.kind) {
      CustomerKind.none => l.customerNone,
      CustomerKind.walkIn => c.customer.name?.isNotEmpty ?? false ? c.customer.name! : l.customerWalkIn,
      CustomerKind.saved => c.customer.name ?? '',
    };
    return Material(
      elevation: 8,
      color: theme.colorScheme.surfaceContainer,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  ActionChip(
                    key: BillTab.customerButton,
                    avatar: const Icon(Icons.person_outline, size: 18),
                    label: Text(who),
                    onPressed: () => showCustomerSheet(context, c),
                  ),
                  const Spacer(),
                  if (!c.cart.isEmpty) Text(l.itemsCount(c.cart.count), style: theme.textTheme.bodySmall),
                ],
              ),
              const SizedBox(height: 6),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  key: BillTab.chargeButton,
                  onPressed: c.cart.isEmpty || charging ? null : onCharge,
                  child: charging
                      ? Text(l.makingBill)
                      : Text(c.cart.isEmpty ? l.charge(formatPaise(0, decimals: false)) : l.charge(formatPaise(c.estimate, decimals: false))),
                ),
              ),
              if (!c.cart.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(l.estimateNote, style: theme.textTheme.bodySmall),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
