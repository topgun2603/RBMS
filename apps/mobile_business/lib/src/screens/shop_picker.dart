import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../errors.dart';

/// The user's shops (`GET /v1/tenancy/mine`). Skipped when there is exactly one, or the last one is remembered.
class ShopPickerScreen extends StatelessWidget {
  const ShopPickerScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = AppScope.of(context);
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(l.pickShopTitle),
        actions: [IconButton(tooltip: l.signOut, icon: const Icon(Icons.logout), onPressed: c.signOut)],
      ),
      body: RefreshIndicator(
        onRefresh: c.reloadShops,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (c.error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(errorText(l, c.error), style: TextStyle(color: theme.colorScheme.error)),
              ),
            if (c.shops.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 32), child: Text(l.noShops)),
            for (final m in c.shops)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  enabled: m.tenant.status == 'active',
                  leading: CircleAvatar(child: Text(m.tenant.name.isEmpty ? '?' : m.tenant.name.characters.first.toUpperCase())),
                  title: Text(m.tenant.name),
                  subtitle: Text([
                    ...m.roles.map((r) => roleLabel(l, r)),
                    if (m.tenant.status != 'active') l.shopSuspended,
                  ].join(' · ')),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => c.openShop(m),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
