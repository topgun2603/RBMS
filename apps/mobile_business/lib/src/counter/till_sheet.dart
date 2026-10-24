import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../errors.dart';
import 'counter_controller.dart';
import 'counter_text.dart';
import 'tender.dart';

/// The day at this counter (day-dialog.tsx): open with a float; when open, today's X report, cash in / out and close
/// with the counted cash (then the Z summary). Till actions need `pos.till`.
Future<void> showTillSheet(BuildContext context, CounterController c) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => FractionallySizedBox(heightFactor: 0.85, child: TillSheet(controller: c)),
    );

class TillSheet extends StatefulWidget {
  const TillSheet({super.key, required this.controller});
  final CounterController controller;

  @override
  State<TillSheet> createState() => _TillSheetState();
}

class _TillSheetState extends State<TillSheet> {
  TillSessionReport? _closed;

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final l = AppLocalizations.of(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final Widget body;
        if (!c.tillLoaded) {
          body = const Center(child: CircularProgressIndicator());
        } else if (_closed != null) {
          body = _ClosedSummary(report: _closed!);
        } else if (c.tillError != null && c.till == null) {
          body = Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(errorText(l, c.tillError)),
              TextButton(onPressed: c.refreshTill, child: Text(l.retry)),
            ]),
          );
        } else if (!c.canTill) {
          body = Padding(padding: const EdgeInsets.all(16), child: Text(l.tillNoPermission));
        } else if (!c.dayOpen) {
          body = _OpenForm(controller: c);
        } else {
          body = _OpenDay(controller: c, onClosed: (r) => setState(() => _closed = r));
        }
        return Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
          child: body,
        );
      },
    );
  }
}

Widget _errorLine(BuildContext context, String? text) => text == null
    ? const SizedBox.shrink()
    : Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Text(text, style: TextStyle(color: Theme.of(context).colorScheme.error)),
      );

final _money = [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))];

class _OpenForm extends StatefulWidget {
  const _OpenForm({required this.controller});
  final CounterController controller;

  @override
  State<_OpenForm> createState() => _OpenFormState();
}

class _OpenFormState extends State<_OpenForm> {
  late final _register = TextEditingController(text: widget.controller.register);
  final _cash = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _register.dispose();
    _cash.dispose();
    super.dispose();
  }

  Future<void> _open() async {
    final l = AppLocalizations.of(context);
    final amount = parseRupees(_cash.text);
    if (amount == null) {
      setState(() => _error = l.tillOpeningCash);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.controller.openTill(_register.text, amount);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(l.tillNotOpened, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 4),
        Text(l.tillNotOpenedHint),
        const SizedBox(height: 16),
        TextField(key: const Key('till.register'), controller: _register, enabled: !widget.controller.registerFixed, decoration: InputDecoration(labelText: l.tillRegister)),
        const SizedBox(height: 12),
        TextField(
          key: const Key('till.openingCash'),
          controller: _cash,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: _money,
          decoration: InputDecoration(labelText: l.tillOpeningCash),
        ),
        _errorLine(context, _error),
        const SizedBox(height: 16),
        FilledButton(key: const Key('till.open'), onPressed: _busy ? null : _open, child: Text(l.tillOpenDay)),
      ],
    );
  }
}

class _OpenDay extends StatelessWidget {
  const _OpenDay({required this.controller, required this.onClosed});
  final CounterController controller;
  final ValueChanged<TillSessionReport> onClosed;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return DefaultTabController(
      length: 3,
      child: Column(
        children: [
          ListTile(
            title: Text(l.tillOpenSince(clock(controller.till!.openedAt))),
            subtitle: Text(controller.register),
          ),
          TabBar(tabs: [Tab(text: l.tillToday), Tab(text: l.tillCashInOut), Tab(text: l.tillCloseDay)]),
          Expanded(
            child: TabBarView(
              children: [
                _XReport(controller: controller),
                _CashInOut(controller: controller),
                _CloseDay(controller: controller, onClosed: onClosed),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {this.bold = false});
  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = bold ? const TextStyle(fontWeight: FontWeight.w600) : null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(children: [Expanded(child: Text(label, style: style)), Text(value, style: style)]),
    );
  }
}

/// X report rows, as the web's "Today" tab.
List<Widget> reportRows(AppLocalizations l, TillReport r) => [
      _Row(l.tillBills, '${r.billCount}'),
      _Row(l.tillSales, formatPaise(r.billTotal)),
      _Row(l.tillOpening, formatPaise(r.cashOpening)),
      for (final p in r.payments) _Row('${methodLabel(l, p.method)} · ${p.count}', formatPaise(p.amount)),
      if (r.onCredit > 0) _Row(l.tillOnCredit, formatPaise(r.onCredit)),
      for (final p in r.refunds) _Row('${l.tillRefunds} ${methodLabel(l, p.method)} · ${p.count}', formatPaise(-p.amount)),
      _Row(l.tillCashNet, formatPaise(r.cashIn - r.cashOut)),
      _Row(l.tillCashExpected, formatPaise(r.cashExpected), bold: true),
    ];

class _XReport extends StatefulWidget {
  const _XReport({required this.controller});
  final CounterController controller;

  @override
  State<_XReport> createState() => _XReportState();
}

class _XReportState extends State<_XReport> {
  late Future<TillSessionReport> _report = widget.controller.xReport();

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return FutureBuilder<TillSessionReport>(
      future: _report,
      builder: (context, snap) {
        if (snap.hasError) {
          return Center(
            child: TextButton(
              onPressed: () => setState(() => _report = widget.controller.xReport()),
              child: Text('${errorText(l, snap.error)} · ${l.retry}'),
            ),
          );
        }
        if (!snap.hasData) return const Center(child: CircularProgressIndicator());
        return RefreshIndicator(
          onRefresh: () async {
            final f = widget.controller.xReport();
            setState(() => _report = f);
            await f;
          },
          child: ListView(padding: const EdgeInsets.all(16), children: reportRows(l, snap.data!.report)),
        );
      },
    );
  }
}

class _CashInOut extends StatefulWidget {
  const _CashInOut({required this.controller});
  final CounterController controller;

  @override
  State<_CashInOut> createState() => _CashInOutState();
}

class _CashInOutState extends State<_CashInOut> {
  final _amount = TextEditingController();
  final _reason = TextEditingController();
  bool _in = true;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l = AppLocalizations.of(context);
    final a = parseRupees(_amount.text);
    if (a == null || a <= 0) {
      setState(() => _error = l.tillAmount);
      return;
    }
    if (_reason.text.trim().isEmpty) {
      setState(() => _error = l.tillReason);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.controller.cashInOut(_in ? a : -a, _reason.text);
      _amount.clear();
      _reason.clear();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final entries = widget.controller.till?.cashEntries ?? const [];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        SegmentedButton<bool>(
          segments: [ButtonSegment(value: true, label: Text(l.tillCashIn)), ButtonSegment(value: false, label: Text(l.tillCashOut))],
          selected: {_in},
          onSelectionChanged: (v) => setState(() => _in = v.first),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _amount,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: _money,
          decoration: InputDecoration(labelText: l.tillAmount),
        ),
        const SizedBox(height: 8),
        TextField(controller: _reason, maxLength: 120, decoration: InputDecoration(labelText: l.tillReason)),
        _errorLine(context, _error),
        FilledButton(onPressed: _busy ? null : _save, child: Text(l.save)),
        const Divider(height: 32),
        if (entries.isEmpty) Text(l.tillNoEntries),
        for (final e in entries.reversed)
          _Row('${clock(e.at)} · ${e.reason}${e.byName == null ? '' : ' · ${e.byName}'}', formatPaise(e.amount)),
      ],
    );
  }
}

class _CloseDay extends StatefulWidget {
  const _CloseDay({required this.controller, required this.onClosed});
  final CounterController controller;
  final ValueChanged<TillSessionReport> onClosed;

  @override
  State<_CloseDay> createState() => _CloseDayState();
}

class _CloseDayState extends State<_CloseDay> {
  final _counted = TextEditingController();
  final _note = TextEditingController();
  late final Future<TillSessionReport> _x = widget.controller.xReport();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _counted.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _close() async {
    final l = AppLocalizations.of(context);
    final counted = parseRupees(_counted.text);
    if (counted == null || _counted.text.trim().isEmpty) {
      setState(() => _error = l.tillCounted);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      widget.onClosed(await widget.controller.closeTill(counted, _note.text));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return FutureBuilder<TillSessionReport>(
      future: _x,
      builder: (context, snap) {
        final expected = snap.data?.report.cashExpected;
        final counted = parseRupees(_counted.text);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (expected != null) _Row(l.tillCashExpected, formatPaise(expected), bold: true),
            TextField(
              key: const Key('till.counted'),
              controller: _counted,
              onChanged: (_) => setState(() {}),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: _money,
              decoration: InputDecoration(labelText: l.tillCounted),
            ),
            if (expected != null && counted != null && _counted.text.trim().isNotEmpty)
              _Row(l.tillDifference, differenceText(l, counted - expected)),
            const SizedBox(height: 8),
            TextField(controller: _note, maxLength: 300, decoration: InputDecoration(labelText: l.tillNote)),
            _errorLine(context, _error),
            FilledButton(key: const Key('till.close'), onPressed: _busy ? null : _close, child: Text(l.tillCloseDay)),
          ],
        );
      },
    );
  }
}

String differenceText(AppLocalizations l, int d) =>
    d == 0 ? l.tillMatches : (d > 0 ? l.tillExtra(formatPaise(d)) : l.tillShort(formatPaise(-d)));

class _ClosedSummary extends StatelessWidget {
  const _ClosedSummary({required this.report});
  final TillSessionReport report;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final s = report.session;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(l.tillClosed, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        _Row(l.tillBills, '${report.report.billCount}'),
        _Row(l.tillCountedLabel, formatPaise(s.countedCash ?? 0)),
        _Row(l.tillDifference, differenceText(l, s.difference ?? 0), bold: true),
        const Divider(height: 24),
        ...reportRows(l, report.report),
        const SizedBox(height: 16),
        FilledButton(onPressed: () => Navigator.pop(context), child: Text(l.closeLabel)),
      ],
    );
  }
}
