import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../errors.dart';

/// Phone number (+91 by default), or an email, → 6-digit code → signed in.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key});

  static const phoneField = Key('signIn.phone');
  static const codeField = Key('signIn.code');
  static const sendButton = Key('signIn.send');
  static const verifyButton = Key('signIn.verify');
  static const emailField = Key('signIn.email');
  static const useEmailButton = Key('signIn.useEmail');
  static const terminalButton = Key('signIn.terminal');

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _email = TextEditingController();
  bool _useEmail = false;
  String? _target; // E.164 or the email, once a code was sent
  PhoneSignIn? _method;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = errorText(AppLocalizations.of(context), e));
    } on UnimplementedError {
      if (mounted) setState(() => _error = AppLocalizations.of(context).errorGeneric);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send({bool resend = false}) async {
    final l = AppLocalizations.of(context);
    final target = resend ? _target : (_useEmail ? normalizeEmail(_email.text) : normalizePhone(_phone.text));
    if (target == null) {
      setState(() => _error = _useEmail ? l.emailInvalid : l.phoneInvalid);
      return;
    }
    final c = AppScope.read(context);
    final messenger = ScaffoldMessenger.of(context);
    await _run(() async {
      final method = _useEmail ? EmailOtpSignIn(c.api) : c.phoneSignIn(target);
      await method.sendCode(target);
      _method = method;
      if (!mounted) return;
      setState(() => _target = target);
      if (resend) messenger.showSnackBar(SnackBar(content: Text(l.codeResent)));
    });
  }

  Future<void> _verify() async {
    final l = AppLocalizations.of(context);
    final code = _code.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _error = l.codeInvalid);
      return;
    }
    final c = AppScope.read(context);
    await _run(() async {
      final result = await _method!.verify(_target!, code);
      await c.signedIn(result);
    });
  }

  void _setUseEmail(bool email) => setState(() {
        _useEmail = email;
        _error = null;
      });

  void _changeNumber() => setState(() {
        _target = null;
        _code.clear();
        _error = null;
      });

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final config = AppScope.of(context).authConfig;
    final target = _target;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
          children: [
            Text(l.appTitle, style: theme.textTheme.titleMedium?.copyWith(color: theme.colorScheme.primary)),
            const SizedBox(height: 8),
            Text(l.signInTitle, style: theme.textTheme.headlineMedium),
            const SizedBox(height: 8),
            Text(target == null ? l.signInSubtitle : l.codeSentTo(prettyPhone(target))),
            const SizedBox(height: 24),
            if (target == null && _useEmail) ...[
              TextField(
                key: SignInScreen.emailField,
                controller: _email,
                enabled: !_busy,
                autofocus: true,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                decoration: InputDecoration(labelText: l.emailLabel),
                onSubmitted: (_) => _send(),
              ),
              const SizedBox(height: 16),
              FilledButton(key: SignInScreen.sendButton, onPressed: _busy ? null : _send, child: Text(l.sendCode)),
              TextButton(
                onPressed: _busy ? null : () => _setUseEmail(false),
                child: Text(l.usePhone),
              ),
            ] else if (target == null) ...[
              TextField(
                key: SignInScreen.phoneField,
                controller: _phone,
                enabled: !_busy,
                autofocus: true,
                keyboardType: TextInputType.phone,
                autofillHints: const [AutofillHints.telephoneNumber],
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]')), LengthLimitingTextInputFormatter(16)],
                decoration: InputDecoration(labelText: l.phoneLabel, prefixText: '+91 '),
                onSubmitted: (_) => _send(),
              ),
              const SizedBox(height: 16),
              FilledButton(key: SignInScreen.sendButton, onPressed: _busy ? null : _send, child: Text(l.sendCode)),
              TextButton(
                key: SignInScreen.useEmailButton,
                onPressed: _busy ? null : () => _setUseEmail(true),
                child: Text(l.useEmail),
              ),
            ] else ...[
              TextField(
                key: SignInScreen.codeField,
                controller: _code,
                enabled: !_busy,
                autofocus: true,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                decoration: InputDecoration(labelText: l.codeLabel),
                style: theme.textTheme.headlineSmall?.copyWith(letterSpacing: 8),
                onSubmitted: (_) => _verify(),
              ),
              if (config?.isTestTarget(target) ?? false) ...[
                const SizedBox(height: 8),
                Text(l.testNumberHint, style: theme.textTheme.bodySmall),
              ],
              const SizedBox(height: 16),
              FilledButton(key: SignInScreen.verifyButton, onPressed: _busy ? null : _verify, child: Text(l.verifyCode)),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  TextButton(onPressed: _busy ? null : _changeNumber, child: Text(l.changeNumber)),
                  TextButton(onPressed: _busy ? null : () => _send(resend: true), child: Text(l.resendCode)),
                ],
              ),
            ],
            if (_busy) const Padding(padding: EdgeInsets.only(top: 16), child: LinearProgressIndicator()),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
              ),
            if (target == null) ...[
              const SizedBox(height: 32),
              const Divider(),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                key: SignInScreen.terminalButton,
                onPressed: _busy ? null : () => AppScope.read(context).useAsTerminal(),
                icon: const Icon(Icons.point_of_sale),
                label: Text(l.useAsTerminal),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
