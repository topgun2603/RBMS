import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import '../counter/bill_tab.dart';
import '../counter/counter_text.dart';
import '../errors.dart';
import 'lock_screen.dart';
import 'pair_screen.dart';
import 'terminal_controller.dart';
import 'weighing_screen.dart';

/// The app in terminal mode: one screen per [TerminalPhase]. Unlocked, a `pos` terminal is the counter (the Bill
/// tab, till register = the terminal's name) and a `weighing` terminal the weighing station.
class TerminalShell extends StatelessWidget {
  const TerminalShell({super.key, required this.terminal});
  final TerminalController terminal;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: terminal,
      builder: (context, _) {
        final t = terminal;
        return switch (t.phase) {
          TerminalPhase.loading => const Scaffold(body: Center(child: CircularProgressIndicator())),
          TerminalPhase.unpaired => PairScreen(terminal: t),
          TerminalPhase.offline => _Problem(terminal: t, offline: true),
          TerminalPhase.locked => t.featureOn ? LockScreen(terminal: t) : _Problem(terminal: t, offline: false),
          TerminalPhase.unlocked => t.featureOn ? _Unlocked(terminal: t) : _Problem(terminal: t, offline: false),
        };
      },
    );
  }
}

Future<void> confirmUnpair(BuildContext context, TerminalController t) async {
  final l = AppLocalizations.of(context);
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(l.unpairTitle),
      content: Text(l.unpairBody(t.terminal?.name ?? '')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.cancel)),
        FilledButton(key: const Key('terminal.unpairConfirm'), onPressed: () => Navigator.pop(ctx, true), child: Text(l.unpair)),
      ],
    ),
  );
  if (ok == true) await t.unpair();
}

class _Problem extends StatelessWidget {
  const _Problem({required this.terminal, required this.offline});
  final TerminalController terminal;
  final bool offline;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(offline ? Icons.cloud_off : Icons.block, size: 48),
                const SizedBox(height: 12),
                Text(offline ? (terminal.error == null ? l.terminalOffline : errorText(l, terminal.error)) : l.terminalFeatureOff,
                    textAlign: TextAlign.center),
                const SizedBox(height: 16),
                FilledButton(onPressed: terminal.loadDevice, child: Text(l.retry)),
                TextButton(onPressed: () => confirmUnpair(context, terminal), child: Text(l.unpairPhone)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Unlocked extends StatefulWidget {
  const _Unlocked({required this.terminal});
  final TerminalController terminal;

  @override
  State<_Unlocked> createState() => _UnlockedState();
}

class _UnlockedState extends State<_Unlocked> {
  late final AppLifecycleListener _life;

  @override
  void initState() {
    super.initState();
    _life = AppLifecycleListener(
      onPause: widget.terminal.idle.paused,
      onHide: widget.terminal.idle.paused,
      onResume: widget.terminal.idle.resumed,
    );
  }

  @override
  void dispose() {
    _life.dispose();
    super.dispose();
  }

  void _settings() {
    final t = widget.terminal;
    final l = AppLocalizations.of(context);
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => ListenableBuilder(
        listenable: t.catalog!,
        builder: (ctx, _) {
          final c = t.catalog!;
          final synced = c.snapshot.syncedAt;
          return SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(Icons.point_of_sale),
                  title: Text(l.shopAndTerminal(t.device!.shop.name, t.device!.terminal.name)),
                  subtitle: Text(l.cashierLabel(t.pin?.userName ?? l.teamMember)),
                ),
                ListTile(
                  key: const Key('terminal.sync'),
                  leading: c.syncing ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.sync),
                  title: Text(l.syncItems),
                  subtitle: Text(c.lastError != null
                      ? l.catalogueSyncFailed(errorText(l, c.lastError))
                      : synced == null
                          ? l.catalogueNotSynced
                          : l.catalogueStatus(c.count, clock(synced))),
                  onTap: c.syncing ? null : c.sync,
                ),
                ListTile(
                  key: const Key('terminal.unpair'),
                  leading: const Icon(Icons.link_off),
                  title: Text(l.unpairPhone),
                  onTap: () {
                    Navigator.pop(ctx);
                    confirmUnpair(context, t);
                  },
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final t = widget.terminal;
    final d = t.device!;
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => t.idle.touch(),
      child: Scaffold(
        appBar: AppBar(
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(t.isWeighing ? l.weighingTitle : d.shop.name, overflow: TextOverflow.ellipsis),
              Text(
                '${d.terminal.name} · ${l.cashierLabel(t.pin?.userName ?? l.teamMember)}',
                key: const Key('terminal.subtitle'),
                style: Theme.of(context).textTheme.bodySmall,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
          actions: [
            IconButton(key: const Key('terminal.settings'), tooltip: l.terminalSettings, icon: const Icon(Icons.tune), onPressed: _settings),
            TextButton.icon(
              key: const Key('terminal.lock'),
              onPressed: () => t.lock(),
              icon: const Icon(Icons.lock_outline),
              label: Text(l.switchCashier),
            ),
          ],
        ),
        body: t.isWeighing ? WeighingScreen(terminal: t) : const BillTab(),
      ),
    );
  }
}

