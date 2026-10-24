import 'package:flutter/material.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../errors.dart';
import 'home_shell.dart';
import 'update_required.dart';

/// Home: this month's numbers from `GET /v1/invoices/summary` (needs the invoices feature and a staff-level role).
class DashboardTab extends StatefulWidget {
  const DashboardTab({super.key});

  @override
  State<DashboardTab> createState() => _DashboardTabState();
}

class _DashboardTabState extends State<DashboardTab> {
  DashboardSummary? _summary;
  Object? _error;
  bool _loading = false;

  /// The summary route is staff-only on the server (owner, admin, staff).
  static const _staffRoles = ['owner', 'admin', 'staff'];

  bool _canSee(Gates g) => g.feature(TabFeatures.bill) && g.hasRole(_staffRoles);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_summary == null && _error == null && !_loading && _canSee(GateScope.of(context))) _load();
  }

  Future<void> _load() async {
    final api = AppScope.read(context).api;
    setState(() => _loading = true);
    try {
      final s = await api.invoiceSummary();
      if (!mounted) return;
      setState(() {
        _summary = s;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final c = AppScope.of(context);
    final gates = GateScope.of(context);
    final theme = Theme.of(context);
    final name = c.shop?.me.user.name ?? c.me?.user.name;
    final s = _summary;

    final children = <Widget>[
      const UpdateAvailableBanner(),
      if (name != null) Text(l.hello(name), style: theme.textTheme.titleLarge),
      const SizedBox(height: 16),
    ];
    if (!gates.feature(TabFeatures.bill)) {
      children.add(Text(l.dashBillingOff));
    } else if (!gates.hasRole(_staffRoles)) {
      children.add(Text(l.dashNoAccess));
    } else if (_error != null && s == null) {
      children.addAll([
        Text(errorText(l, _error), style: TextStyle(color: theme.colorScheme.error)),
        const SizedBox(height: 8),
        Align(alignment: Alignment.centerLeft, child: OutlinedButton(onPressed: _load, child: Text(l.retry))),
      ]);
    } else if (s == null) {
      children.add(const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator())));
    } else {
      children.addAll([
        Text(l.dashThisMonth, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: 1.6,
          children: [
            _StatCard(
              key: const Key('dash.billed'),
              label: l.dashBilled,
              value: formatPaise(s.month.invoiced, decimals: false),
              note: l.dashLastMonth(formatPaise(s.prevMonth.invoiced, decimals: false)),
            ),
            _StatCard(
              key: const Key('dash.collected'),
              label: l.dashCollected,
              value: formatPaise(s.month.collected, decimals: false),
              note: l.dashLastMonth(formatPaise(s.prevMonth.collected, decimals: false)),
            ),
            _StatCard(key: const Key('dash.bills'), label: l.dashBills, value: '${s.month.count}'),
            _StatCard(
              key: const Key('dash.toCollect'),
              label: l.dashToCollect,
              value: formatPaise(s.outstanding, decimals: false),
              note: l.dashOverdue(s.overdueCount),
              warn: s.overdueCount > 0,
            ),
          ],
        ),
        const SizedBox(height: 24),
        Text(l.dashRecent, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        if (s.recent.isEmpty) Text(l.dashNoBills),
        for (final b in s.recent)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(b.customerName),
            subtitle: Text('${b.number ?? l.dashDraft} · ${b.date}'),
            trailing: Text(formatPaise(b.total), style: theme.textTheme.titleSmall),
          ),
      ]);
    }

    return RefreshIndicator(
      onRefresh: _canSee(gates) ? _load : () async {},
      child: ListView(padding: const EdgeInsets.all(16), children: children),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({super.key, required this.label, required this.value, this.note, this.warn = false});
  final String label;
  final String value;
  final String? note;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: theme.textTheme.labelLarge, maxLines: 1, overflow: TextOverflow.ellipsis),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w600)),
            ),
            if (note != null)
              Text(
                note!,
                style: theme.textTheme.bodySmall?.copyWith(color: warn ? theme.colorScheme.error : null),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
          ],
        ),
      ),
    );
  }
}
