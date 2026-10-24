import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../errors.dart';

/// Launch, restoring the session, opening a shop, or "couldn't reach the server" with a retry.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = AppScope.of(context);
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final failed = c.stage == AppStage.restoreFailed;
    final opening = c.opening;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(l.appTitle, style: theme.textTheme.headlineMedium?.copyWith(color: theme.colorScheme.primary)),
                const SizedBox(height: 24),
                if (failed) ...[
                  Text(l.restoreFailedTitle, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  Text(errorText(l, c.error), textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  FilledButton(onPressed: c.start, child: Text(l.retry)),
                  TextButton(onPressed: c.signOut, child: Text(l.signOut)),
                ] else ...[
                  const CircularProgressIndicator(),
                  const SizedBox(height: 16),
                  Text(opening != null ? l.openingShop(opening.tenant.name) : l.loading),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
