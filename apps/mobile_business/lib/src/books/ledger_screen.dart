import 'package:flutter/material.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../errors.dart';
import 'books_rules.dart';
import 'books_text.dart';

enum LedgerPeriod { thisFy, thisMonth, lastMonth, custom }

/// A customer's ledger (customer-detail.tsx `LedgerCard`, the phone timeline): this financial year by default, the
/// balance brought forward, each entry with debit / credit and the running balance (due / adv.), then the totals and
/// closing balance.
class LedgerScreen extends StatefulWidget {
  const LedgerScreen({super.key, required this.customer, this.today});
  final Customer customer;

  /// For tests: "today" in IST (`YYYY-MM-DD`).
  final String? today;

  @override
  State<LedgerScreen> createState() => _LedgerScreenState();
}

class _LedgerScreenState extends State<LedgerScreen> {
  LedgerPeriod _period = LedgerPeriod.thisFy;
  late DateRange _range = thisFinancialYear(widget.today);
  Ledger? _ledger;
  Object? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await AppScope.read(context).api.ledger(widget.customer.id, from: _range.from, to: _range.to);
      if (mounted) setState(() => _ledger = r);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pick(LedgerPeriod p) async {
    DateRange? range = switch (p) {
      LedgerPeriod.thisFy => thisFinancialYear(widget.today),
      LedgerPeriod.thisMonth => thisMonth(widget.today),
      LedgerPeriod.lastMonth => lastMonth(widget.today),
      LedgerPeriod.custom => null,
    };
    if (range == null) {
      final picked = await showDateRangePicker(
        context: context,
        firstDate: DateTime(2000),
        lastDate: DateTime.parse(widget.today ?? isoDate(DateTime.now())),
        initialDateRange: DateTimeRange(start: DateTime.parse(_range.from), end: DateTime.parse(_range.to)),
      );
      if (picked == null) return;
      range = (from: isoDate(picked.start), to: isoDate(picked.end));
    }
    setState(() {
      _period = p;
      _range = range!;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final ledger = _ledger;
    final rows = ledger == null ? const <LedgerRow>[] : ledgerRows(ledger, from: _range.from);
    final totals = ledger == null ? null : ledgerTotals(ledger);
    return Scaffold(
      appBar: AppBar(title: Text(l.ledgerOf(widget.customer.name))),
      body: Column(children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: Row(children: [
            for (final p in LedgerPeriod.values)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ChoiceChip(
                  key: Key('ledger.period.${p.name}'),
                  label: Text(switch (p) {
                    LedgerPeriod.thisFy => l.periodThisFy,
                    LedgerPeriod.thisMonth => l.periodThisMonth,
                    LedgerPeriod.lastMonth => l.periodLastMonth,
                    LedgerPeriod.custom => l.periodCustom,
                  }),
                  selected: _period == p,
                  onSelected: (_) => _pick(p),
                ),
              ),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
          child: Text(l.periodRange(dayLabel(_range.from, l.localeName, year: true), dayLabel(_range.to, l.localeName, year: true)),
              key: const Key('ledger.range'), style: theme.textTheme.bodySmall),
        ),
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(errorText(l, _error), style: TextStyle(color: theme.colorScheme.error))),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              children: [
                for (final (i, r) in rows.indexed) _LedgerTile(row: r, index: i),
                if (ledger != null && ledger.entries.isEmpty)
                  Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Text(l.ledgerEmpty, textAlign: TextAlign.center)),
                if (ledger != null && totals != null) ...[
                  const Divider(height: 24),
                  _Line(label: l.ledgerBilled, value: formatPaise(totals.debit)),
                  _Line(label: l.ledgerReceived, value: formatPaise(totals.credit)),
                  _Line(
                    label: l.ledgerClosing,
                    value: runningBalanceText(l, ledger.closingBalance),
                    valueKey: const Key('ledger.closing'),
                    color: sideColor(theme.colorScheme, balanceSide(ledger.closingBalance)),
                    bold: true,
                  ),
                ],
              ],
            ),
          ),
        ),
      ]),
    );
  }
}

class _LedgerTile extends StatelessWidget {
  const _LedgerTile({required this.row, required this.index});
  final LedgerRow row;
  final int index;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final r = row;
    final title = r.broughtForward
        ? l.ledgerBroughtForward(dayLabel(r.date, l.localeName, year: true))
        : [ledgerTypeLabel(l, r.type), if (r.number != null) r.number!].join(' · ');
    return ListTile(
      key: Key('ledger.row.$index'),
      contentPadding: EdgeInsets.zero,
      dense: true,
      title: Text(title, style: r.broughtForward ? const TextStyle(fontStyle: FontStyle.italic) : null),
      subtitle: r.broughtForward ? null : Text([dayLabel(r.date, l.localeName), if (r.detail != null) r.detail!].join(' · ')),
      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
        if (r.debit > 0) Text('+${formatPaise(r.debit)}', style: TextStyle(color: Colors.orange.shade800, fontWeight: FontWeight.w600)),
        if (r.credit > 0) Text('−${formatPaise(r.credit)}', style: TextStyle(color: Colors.green.shade700, fontWeight: FontWeight.w600)),
        Text(runningBalanceText(l, r.balance),
            key: Key('ledger.balance.$index'), style: theme.textTheme.bodySmall?.copyWith(color: sideColor(theme.colorScheme, r.side))),
      ]),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.value, this.valueKey, this.color, this.bold = false});
  final String label;
  final String value;
  final Key? valueKey;
  final Color? color;
  final bool bold;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(children: [
          Expanded(child: Text(label)),
          Text(value, key: valueKey, style: TextStyle(color: color, fontWeight: bold ? FontWeight.bold : FontWeight.w500)),
        ]),
      );
}
