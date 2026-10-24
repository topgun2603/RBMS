import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../counter/scan_screen.dart';
import '../errors.dart';
import 'pairing.dart';
import 'terminal_controller.dart';

/// "Use this phone as a POS terminal": scan the pairing QR (`srikit-pair:1:<apiOrigin>:<code>`) or type the code.
class PairScreen extends StatefulWidget {
  const PairScreen({super.key, required this.terminal});
  final TerminalController terminal;

  static const codeField = Key('pair.code');
  static const pairButton = Key('pair.submit');
  static const scanButton = Key('pair.scan');
  static const backButton = Key('pair.back');

  @override
  State<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends State<PairScreen> {
  final _code = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  String _errorText(AppLocalizations l, Object e) {
    if (e is FormatException) return l.pairErrorFormat;
    return switch (pairErrorOf(e)) {
      PairError.format => l.pairErrorFormat,
      PairError.invalid => l.pairErrorInvalid,
      PairError.tooMany => l.pairErrorTooMany,
      PairError.featureOff => l.pairErrorFeatureOff,
      PairError.network => l.errorNetwork,
      PairError.other => errorText(l, e),
    };
  }

  Future<void> _pair(String input) async {
    final l = AppLocalizations.of(context);
    if (parsePairingQr(input) == null) {
      setState(() => _error = l.pairErrorFormat);
      return;
    }
    setState(() => _error = null);
    try {
      await widget.terminal.pair(input);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = _errorText(l, e));
    } on FormatException catch (e) {
      if (mounted) setState(() => _error = _errorText(l, e));
    }
  }

  Future<void> _scan() async {
    final text = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (text == null || !mounted) return;
    final qr = parsePairingQr(text);
    if (qr != null) _code.text = displayPairingCode(qr.code);
    await _pair(text);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final t = widget.terminal;
    return ListenableBuilder(
      listenable: t,
      builder: (context, _) => Scaffold(
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
            children: [
              Icon(Icons.point_of_sale, size: 48, color: theme.colorScheme.primary),
              const SizedBox(height: 12),
              Text(l.pairTitle, style: theme.textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text(l.pairSubtitle),
              if (t.notice == TerminalNotice.revoked) ...[
                const SizedBox(height: 12),
                Text(l.pairRevoked, key: const Key('pair.revoked'), style: TextStyle(color: theme.colorScheme.error)),
              ],
              const SizedBox(height: 24),
              FilledButton.icon(
                key: PairScreen.scanButton,
                onPressed: t.busy ? null : _scan,
                icon: const Icon(Icons.qr_code_scanner),
                label: Text(l.pairScan),
              ),
              const SizedBox(height: 24),
              TextField(
                key: PairScreen.codeField,
                controller: _code,
                enabled: !t.busy,
                textCapitalization: TextCapitalization.characters,
                autocorrect: false,
                style: theme.textTheme.headlineSmall?.copyWith(letterSpacing: 4),
                inputFormatters: [
                  TextInputFormatter.withFunction((old, next) {
                    final f = formatPairingInput(next.text);
                    return TextEditingValue(text: f, selection: TextSelection.collapsed(offset: f.length));
                  }),
                ],
                decoration: InputDecoration(labelText: l.pairCodeLabel, hintText: 'ABCD-2345'),
                onSubmitted: _pair,
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                key: PairScreen.pairButton,
                onPressed: t.busy ? null : () => _pair(_code.text),
                child: Text(t.busy ? l.pairing : l.pairButton),
              ),
              if (t.busy) const Padding(padding: EdgeInsets.only(top: 16), child: LinearProgressIndicator()),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Text(_error!, key: const Key('pair.error'), style: TextStyle(color: theme.colorScheme.error)),
                ),
              const SizedBox(height: 32),
              TextButton(
                key: PairScreen.backButton,
                onPressed: t.busy ? null : () => AppScope.read(context).leaveTerminalMode(),
                child: Text(l.pairBackToSignIn),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
