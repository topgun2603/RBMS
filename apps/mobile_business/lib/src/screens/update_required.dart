import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../config.dart';

/// Opens the store page; false when there is none for this platform or it could not be opened.
Future<bool> openStore() async {
  final url = storeUrl;
  if (url == null) return false;
  try {
    return await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  } catch (_) {
    return false;
  }
}

/// Blocking: this version is below the API's minimum (GET /v1/mobile/config `updateRequired`, or any 426
/// `app_update_required`). Only "Update" and "Check again" are offered.
class UpdateRequiredScreen extends StatelessWidget {
  const UpdateRequiredScreen({super.key});

  static const updateButton = Key('update.open');
  static const checkAgainButton = Key('update.checkAgain');

  @override
  Widget build(BuildContext context) {
    final c = AppScope.of(context);
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final min = c.requiredVersion;
    return PopScope(
      canPop: false,
      child: Scaffold(
        body: SafeArea(
          child: Center(
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.all(24),
              children: [
                Icon(Icons.system_update, size: 64, color: theme.colorScheme.primary),
                const SizedBox(height: 16),
                Text(l.updateRequiredTitle, style: theme.textTheme.headlineSmall, textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Text(l.updateRequiredBody, textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Text(
                  min == null ? l.updateYourVersion(appVersion) : l.updateVersions(appVersion, min),
                  style: theme.textTheme.bodySmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                if (storeUrl != null)
                  FilledButton.icon(
                    key: updateButton,
                    onPressed: openStore,
                    icon: const Icon(Icons.open_in_new),
                    label: Text(l.updateNow),
                  ),
                const SizedBox(height: 8),
                TextButton(key: checkAgainButton, onPressed: c.start, child: Text(l.updateCheckAgain)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Dismissible "a new version is available" banner for Home.
class UpdateAvailableBanner extends StatelessWidget {
  const UpdateAvailableBanner({super.key});

  static const laterButton = Key('updateBanner.later');

  @override
  Widget build(BuildContext context) {
    final c = AppScope.of(context);
    if (!c.showUpdateBanner) return const SizedBox.shrink();
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Card(
      color: theme.colorScheme.secondaryContainer,
      margin: const EdgeInsets.only(bottom: 16),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.system_update, color: theme.colorScheme.onSecondaryContainer),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(l.updateAvailable, style: TextStyle(color: theme.colorScheme.onSecondaryContainer)),
                ),
              ],
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(key: laterButton, onPressed: c.dismissUpdateBanner, child: Text(l.updateLater)),
                if (storeUrl != null) TextButton(onPressed: openStore, child: Text(l.updateNow)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
