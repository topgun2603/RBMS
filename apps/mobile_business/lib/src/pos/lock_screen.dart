import 'dart:async';

import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import 'pin_pad.dart';
import 'terminal_controller.dart';

/// A paired terminal's lock screen: shop and terminal name, the team (names, who has a PIN), a big PIN pad.
class LockScreen extends StatefulWidget {
  const LockScreen({super.key, required this.terminal});
  final TerminalController terminal;
  DateTime now() => terminal.clock();

  static const unlockButton = Key('lock.unlock');
  static Key digitKey(String d) => Key('lock.digit.$d');
  static const backKey = Key('lock.back');
  static const clearKey = Key('lock.clear');
  static const problemText = Key('lock.problem');

  @override
  State<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<LockScreen> {
  PinPad _pad = const PinPad();
  Timer? _tick;

  TerminalController get _t => widget.terminal;

  @override
  void initState() {
    super.initState();
    _t.addListener(_onTerminal);
    _onTerminal();
  }

  @override
  void dispose() {
    _t.removeListener(_onTerminal);
    _tick?.cancel();
    super.dispose();
  }

  /// A lockout ticks every second until it is over.
  void _onTerminal() {
    final locked = (_t.unlockProblem?.secondsLeft(widget.now()) ?? 0) > 0;
    if (locked && _tick == null) {
      _tick = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted) return;
        if ((_t.unlockProblem?.secondsLeft(widget.now()) ?? 0) == 0) {
          _tick?.cancel();
          _tick = null;
          _t.clearUnlockProblem();
        }
        setState(() {});
      });
    }
  }

  bool get _disabled => padDisabled(_t.unlockProblem, _t.busy, widget.now());

  void _press(PinPad Function(PinPad) f) {
    if (_disabled) return;
    setState(() => _pad = f(_pad));
  }

  Future<void> _submit() async {
    if (!_pad.complete || _disabled) return;
    final digits = _pad.digits;
    setState(() => _pad = _pad.clear());
    await _t.unlock(digits);
  }

  String? _problemText(AppLocalizations l) {
    final p = _t.unlockProblem;
    if (p != null) {
      return switch (p.kind) {
        UnlockKind.invalid => p.remaining == null ? l.pinWrong : l.pinInvalid(p.remaining!),
        UnlockKind.locked => l.pinLocked(formatCountdown(p.secondsLeft(widget.now()))),
        UnlockKind.notAllowed => l.pinNotAllowed,
        UnlockKind.network => l.errorNetwork,
        UnlockKind.unpaired => l.pairRevoked,
        UnlockKind.other => p.message.isNotEmpty ? p.message : l.errorGeneric,
      };
    }
    return switch (_t.notice) {
      TerminalNotice.idle => l.lockedIdle,
      TerminalNotice.expired => l.sessionEnded,
      _ => null,
    };
  }

  Widget _key(String label, VoidCallback onTap, {Key? key, IconData? icon}) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(6),
      child: SizedBox(
        width: 84,
        height: 64,
        child: FilledButton.tonal(
          key: key,
          onPressed: _disabled ? null : onTap,
          child: icon != null ? Icon(icon, semanticLabel: label) : Text(label, style: theme.textTheme.headlineSmall),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: _t,
      builder: (context, _) {
        final d = _t.device;
        final problem = _problemText(l);
        return Scaffold(
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
              children: [
                Text(
                  l.shopAndTerminal(d?.shop.name ?? '', d?.terminal.name ?? ''),
                  key: const Key('lock.header'),
                  textAlign: TextAlign.center,
                  style: theme.textTheme.titleMedium?.copyWith(color: theme.colorScheme.primary),
                ),
                const SizedBox(height: 8),
                Text(l.lockTitle, textAlign: TextAlign.center, style: theme.textTheme.headlineSmall),
                if (_t.staff.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final s in _t.staff)
                        Chip(
                          avatar: Icon(s.hasPin ? Icons.person : Icons.person_off_outlined, size: 18),
                          label: Text(s.hasPin ? (s.name ?? l.teamMember) : '${s.name ?? l.teamMember} · ${l.noPinYet}'),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (var i = 0; i < pinMax; i++)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        child: Icon(
                          i < _pad.length ? Icons.circle : Icons.circle_outlined,
                          size: 16,
                          color: i < pinMin || i < _pad.length ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
                        ),
                      ),
                  ],
                ),
                SizedBox(
                  height: 48,
                  child: Center(
                    child: problem == null
                        ? null
                        : Text(problem, key: LockScreen.problemText, textAlign: TextAlign.center, style: TextStyle(color: theme.colorScheme.error)),
                  ),
                ),
                Center(
                  child: Column(
                    children: [
                      for (final row in const [
                        ['1', '2', '3'],
                        ['4', '5', '6'],
                        ['7', '8', '9'],
                      ])
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [for (final d in row) _key(d, () => _press((p) => p.digit(d)), key: LockScreen.digitKey(d))],
                        ),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _key(l.pinClear, () => _press((p) => p.clear()), key: LockScreen.clearKey, icon: Icons.clear),
                          _key('0', () => _press((p) => p.digit('0')), key: LockScreen.digitKey('0')),
                          _key(l.pinBack, () => _press((p) => p.back()), key: LockScreen.backKey, icon: Icons.backspace_outlined),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  key: LockScreen.unlockButton,
                  onPressed: _pad.complete && !_disabled ? _submit : null,
                  child: _t.busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.unlock),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
