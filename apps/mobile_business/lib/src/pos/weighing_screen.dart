import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';
import 'package:srikit_print/srikit_print.dart' show formatQty;

import '../../l10n/app_localizations.dart';
import '../errors.dart';
import 'catalog.dart';
import 'terminal_controller.dart';
import 'ticket_view.dart';
import 'weigh.dart';

final _kgFormatter = FilteringTextInputFormatter.allow(RegExp(r'^\d{0,3}([.,]\d{0,3})?'));

/// Asks for a weight in kg with 3 decimals (counter: a by-weight item without a scale label). Null = cancelled.
Future<double?> askWeight(BuildContext context, String item) => showDialog<double>(
      context: context,
      builder: (ctx) => _WeightDialog(item: item),
    );

class _WeightDialog extends StatefulWidget {
  const _WeightDialog({required this.item});
  final String item;

  @override
  State<_WeightDialog> createState() => _WeightDialogState();
}

class _WeightDialogState extends State<_WeightDialog> {
  final _kg = TextEditingController();
  bool _bad = false;

  @override
  void dispose() {
    _kg.dispose();
    super.dispose();
  }

  void _ok() {
    final v = parseKg(_kg.text);
    if (v == null || v <= 0) {
      setState(() => _bad = true);
      return;
    }
    Navigator.pop(context, v);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l.enterWeightTitle(widget.item)),
      content: TextField(
        key: const Key('weight.kg'),
        controller: _kg,
        autofocus: true,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [_kgFormatter],
        decoration: InputDecoration(labelText: l.weightKgLabel, suffixText: 'kg', errorText: _bad ? l.weightInvalid : null),
        onSubmitted: (_) => _ok(),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.cancel)),
        FilledButton(key: const Key('weight.ok'), onPressed: _ok, child: Text(l.add)),
      ],
    );
  }
}

/// The weighing station (role `weighing`, permission `pos.weigh`): pick an item (search, categories, by-weight
/// first), weigh it (the scale reader; manual keypad entry for now), tare, add lines, Issue ticket → the ticket with
/// its barcode; today's tickets with cancel.
class WeighingScreen extends StatefulWidget {
  const WeighingScreen({super.key, required this.terminal});
  final TerminalController terminal;

  static const searchField = Key('weigh.search');
  static const issueButton = Key('weigh.issue');
  static const todayButton = Key('weigh.today');

  @override
  State<WeighingScreen> createState() => _WeighingScreenState();
}

class _WeighingScreenState extends State<WeighingScreen> {
  final _search = TextEditingController();
  String _q = '';
  String? _category;
  bool _issuing = false;

  WeighingController get _w => widget.terminal.weighing!;
  PosCatalog get _catalog => widget.terminal.catalog!;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _toast(String s) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(s)));

  Future<void> _pick(PosItem item) async {
    final line = await showModalBottomSheet<PendingWeighLine>(
      context: context,
      isScrollControlled: true,
      builder: (_) => WeighSheet(item: item, scale: _w.scale),
    );
    if (line != null) _w.add(line);
  }

  Future<void> _issue() async {
    final l = AppLocalizations.of(context);
    setState(() => _issuing = true);
    try {
      final t = await _w.issue();
      if (!mounted) return;
      final d = widget.terminal.device!;
      await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => TicketScreen(
          ticket: t,
          shopName: d.shop.name,
          terminalName: d.terminal.name,
          paperWidth: d.terminal.settings.printerWidth,
        ),
      ));
    } on ApiException catch (e) {
      // The same lines pressed again reuse their Idempotency-Key: no second ticket.
      if (mounted) _toast(errorText(l, e));
    } finally {
      if (mounted) setState(() => _issuing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: Listenable.merge([_w, _catalog]),
      builder: (context, _) {
        final items = _catalog.index.search(_q, categoryId: _category, weightFirst: true, limit: 120);
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
              child: TextField(
                key: WeighingScreen.searchField,
                controller: _search,
                onChanged: (v) => setState(() => _q = v),
                decoration: InputDecoration(
                  hintText: l.searchItems,
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _q.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.clear),
                          onPressed: () => setState(() {
                            _search.clear();
                            _q = '';
                          }),
                        ),
                ),
              ),
            ),
            CategoryChips(categories: _catalog.categories, selected: _category, onSelected: (c) => setState(() => _category = c)),
            if (_catalog.syncing) const LinearProgressIndicator(minHeight: 2),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () => _catalog.sync(),
                child: items.isEmpty
                    ? ListView(children: [Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(_catalog.ready ? l.noResults : l.catalogueNotSynced)))])
                    : ListView.separated(
                        itemCount: items.length,
                        separatorBuilder: (_, i) => const Divider(height: 1),
                        itemBuilder: (context, i) {
                          final it = items[i];
                          return ListTile(
                            key: Key('weigh.item.$i'),
                            leading: Icon(it.byWeight ? Icons.scale : Icons.inventory_2_outlined),
                            title: Text(it.name),
                            subtitle: Text([if (it.byWeight) l.byWeight, if (it.sku != null) it.sku!, if (it.plu != null) 'PLU ${it.plu}'].join(' · ')),
                            trailing: Text('${formatPaise(it.price)}/${it.unit}', style: theme.textTheme.titleSmall),
                            onTap: () => _pick(it),
                          );
                        },
                      ),
              ),
            ),
            Material(
              elevation: 8,
              color: theme.colorScheme.surfaceContainer,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 150),
                        child: ListView(
                          shrinkWrap: true,
                          children: [
                            for (var i = 0; i < _w.lines.length; i++)
                              ListTile(
                                key: Key('weigh.line.$i'),
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                title: Text(_w.lines[i].item.name),
                                subtitle: Text(_w.lines[i].item.byWeight
                                    ? '${kgText(_w.lines[i].netKg)} kg${_w.lines[i].tareKg > 0 ? ' (${l.tareLabel} ${kgText(_w.lines[i].tareKg)})' : ''}'
                                    : '× ${formatQty(_w.lines[i].qty ?? 1)}'),
                                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                                  Text('≈ ${formatPaise(_w.lines[i].estimate)}'),
                                  IconButton(icon: const Icon(Icons.close), onPressed: () => _w.removeAt(i)),
                                ]),
                              ),
                          ],
                        ),
                      ),
                      Row(
                        children: [
                          Expanded(child: Text(l.ticketLines(_w.lines.length), style: theme.textTheme.bodySmall)),
                          TextButton.icon(
                            key: WeighingScreen.todayButton,
                            onPressed: () => Navigator.of(context).push(
                              MaterialPageRoute(builder: (_) => TodayTicketsScreen(terminal: widget.terminal)),
                            ),
                            icon: const Icon(Icons.receipt_outlined),
                            label: Text(l.todayTickets),
                          ),
                        ],
                      ),
                      FilledButton(
                        key: WeighingScreen.issueButton,
                        onPressed: _w.lines.isEmpty || _issuing ? null : _issue,
                        child: Text(_issuing ? l.issuing : l.issueTicket(formatPaise(_w.estimate))),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Category filter from `/pos/catalog/categories` (top level first, in position order).
class CategoryChips extends StatelessWidget {
  const CategoryChips({super.key, required this.categories, required this.selected, required this.onSelected});
  final List<PosCategory> categories;
  final String? selected;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    if (categories.isEmpty) return const SizedBox.shrink();
    final l = AppLocalizations.of(context);
    final sorted = [...categories]..sort((a, b) {
        final p = (a.parentId == null ? 0 : 1) - (b.parentId == null ? 0 : 1);
        return p != 0 ? p : (a.position != b.position ? a.position - b.position : a.name.compareTo(b.name));
      });
    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: ChoiceChip(label: Text(l.allCategories), selected: selected == null, onSelected: (_) => onSelected(null)),
          ),
          for (final c in sorted)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(
                key: Key('category.${c.id}'),
                label: Text(c.name),
                selected: selected == c.id,
                onSelected: (_) => onSelected(selected == c.id ? null : c.id),
              ),
            ),
        ],
      ),
    );
  }
}

/// Weigh one item: the scale's reading (typed on the keypad until a scale is connected), tare, net, Add. Count
/// items ask how many.
class WeighSheet extends StatefulWidget {
  const WeighSheet({super.key, required this.item, required this.scale});
  final PosItem item;
  final ScaleReader scale;

  static const grossField = Key('weigh.gross');
  static const tareField = Key('weigh.tare');
  static const qtyField = Key('weigh.qty');
  static const addButton = Key('weigh.add');

  @override
  State<WeighSheet> createState() => _WeighSheetState();
}

class _WeighSheetState extends State<WeighSheet> {
  final _gross = TextEditingController();
  final _tare = TextEditingController();
  final _qty = TextEditingController(text: '1');
  bool _tried = false;

  @override
  void initState() {
    super.initState();
    final r = widget.scale.current;
    if (r != null && !widget.scale.manual) _gross.text = kgText(r.kg);
    widget.scale.readings.listen((r) {
      if (!mounted || widget.scale.manual) return;
      setState(() => _gross.text = kgText(r.kg));
    });
  }

  @override
  void dispose() {
    _gross.dispose();
    _tare.dispose();
    _qty.dispose();
    super.dispose();
  }

  double? get _grossKg => parseKg(_gross.text);
  double get _tareKg => _tare.text.trim().isEmpty ? 0 : (parseKg(_tare.text) ?? -1);

  void _add() {
    setState(() => _tried = true);
    final item = widget.item;
    if (!item.byWeight) {
      final q = double.tryParse(_qty.text.trim());
      if (q == null || q <= 0) return;
      Navigator.pop(context, PendingWeighLine(item: item, qty: q));
      return;
    }
    final g = _grossKg;
    if (g == null || !validNet(g, _tareKg)) return;
    final s = widget.scale;
    if (s is ManualScaleReader) s.enter(g);
    Navigator.pop(context, PendingWeighLine(item: item, weightKg: g, tareKg: _tareKg));
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final item = widget.item;
    final g = _grossKg;
    final valid = item.byWeight ? g != null && validNet(g, _tareKg) : (double.tryParse(_qty.text.trim()) ?? 0) > 0;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(item.byWeight ? l.weighItem(item.name) : l.countItem(item.name), style: theme.textTheme.titleLarge),
          Text('${formatPaise(item.price)}/${item.unit}'),
          const SizedBox(height: 12),
          if (item.byWeight) ...[
            if (widget.scale.manual) Text(l.manualScale, style: theme.textTheme.bodySmall),
            TextField(
              key: WeighSheet.grossField,
              controller: _gross,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [_kgFormatter],
              style: theme.textTheme.headlineMedium,
              decoration: InputDecoration(labelText: l.grossLabel, suffixText: 'kg'),
              onChanged: (_) => setState(() {}),
            ),
            TextField(
              key: WeighSheet.tareField,
              controller: _tare,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [_kgFormatter],
              decoration: InputDecoration(labelText: l.tareLabel, suffixText: 'kg', hintText: '0.000'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 8),
            if (g != null && validNet(g, _tareKg))
              Text(l.netWeight(kgText(((g - _tareKg) * 1000).round() / 1000)), key: const Key('weigh.net'), style: theme.textTheme.titleMedium)
            else if (_tried || (g != null && !validNet(g, _tareKg)))
              Text(l.netInvalid, style: TextStyle(color: theme.colorScheme.error)),
          ] else
            TextField(
              key: WeighSheet.qtyField,
              controller: _qty,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(labelText: l.qtyLabel),
              onChanged: (_) => setState(() {}),
            ),
          const SizedBox(height: 16),
          FilledButton(key: WeighSheet.addButton, onPressed: valid ? _add : null, child: Text(l.addToTicket)),
        ],
      ),
    );
  }
}

/// Today's tickets of this terminal, with cancel for open ones.
class TodayTicketsScreen extends StatefulWidget {
  const TodayTicketsScreen({super.key, required this.terminal});
  final TerminalController terminal;

  @override
  State<TodayTicketsScreen> createState() => _TodayTicketsScreenState();
}

class _TodayTicketsScreenState extends State<TodayTicketsScreen> {
  WeighingController get _w => widget.terminal.weighing!;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _w.loadToday());
  }

  Future<void> _cancel(WeighTicket t) async {
    final l = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.cancelTicketTitle(t.code)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.stay)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.cancelTicket)),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _w.cancel(t);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(l, e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final d = widget.terminal.device!;
    return Scaffold(
      appBar: AppBar(title: Text(l.todayTickets)),
      body: ListenableBuilder(
        listenable: _w,
        builder: (context, _) {
          if (_w.loadingToday && _w.today.isEmpty) return const Center(child: CircularProgressIndicator());
          if (_w.todayError != null && _w.today.isEmpty) return Center(child: Text(errorText(l, _w.todayError)));
          if (_w.today.isEmpty) return Center(child: Text(l.noTicketsToday));
          return RefreshIndicator(
            onRefresh: _w.loadToday,
            child: ListView.separated(
              itemCount: _w.today.length,
              separatorBuilder: (_, i) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final t = _w.today[i];
                final status = switch (t.status) {
                  'used' => l.ticketStatusUsed,
                  'cancelled' => l.ticketStatusCancelled,
                  _ => l.ticketStatusOpen,
                };
                return ListTile(
                  key: Key('today.$i'),
                  title: Text('${t.code} · ${formatPaise(t.total)}'),
                  subtitle: Text('$status · ${t.lines.map((x) => x.name).join(', ')}'),
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => TicketScreen(ticket: t, shopName: d.shop.name, terminalName: d.terminal.name, paperWidth: d.terminal.settings.printerWidth),
                  )),
                  trailing: t.isOpen
                      ? IconButton(tooltip: l.cancelTicket, icon: Icon(Icons.cancel_outlined, color: theme.colorScheme.error), onPressed: () => _cancel(t))
                      : null,
                );
              },
            ),
          );
        },
      ),
    );
  }
}
