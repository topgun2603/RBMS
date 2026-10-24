import 'package:flutter/material.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../books/books_rules.dart';
import '../books/credit_book_screen.dart';
import '../books/customers_screen.dart';
import '../books/expenses_screen.dart';
import '../config.dart';
import '../errors.dart';
import '../products/product_rules.dart';
import '../products/products_screen.dart';
import '../stock/stock_screen.dart';

/// Shop switcher, language, sign out.
class MoreTab extends StatelessWidget {
  const MoreTab({super.key});

  Future<void> _confirmSignOut(BuildContext context) async {
    final l = AppLocalizations.of(context);
    final c = AppScope.read(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        content: Text(l.signOutConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.cancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.signOut)),
        ],
      ),
    );
    if (ok == true) await c.signOut();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final c = AppScope.of(context);
    final theme = Theme.of(context);
    final shop = c.shop;
    final user = shop?.me.user ?? c.me?.user;
    final access = BooksAccess(GateScope.of(context));
    return ListView(
      children: [
        if (shop != null) ...[
          _Header(l.moreShop),
          ListTile(
            leading: const Icon(Icons.storefront),
            title: Text(shop.tenant.name),
            subtitle: Text(shop.membership.roles.map((r) => roleLabel(l, r)).join(' · ')),
          ),
          if (c.shops.length > 1)
            ListTile(
              key: const Key('more.switchShop'),
              leading: const Icon(Icons.swap_horiz),
              title: Text(l.switchShop),
              onTap: c.switchShop,
            ),
        ],
        // Products and stock live here rather than in the bottom bar: they're managed now and then, while billing and
        // orders are all-day work (four tabs is the most the bar holds comfortably).
        Gate(
          features: const [CatalogKeys.catalogue],
          child: ListTile(
            key: const Key('more.products'),
            leading: const Icon(Icons.inventory_2_outlined),
            title: Text(l.productsTitle),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProductsScreen())),
          ),
        ),
        Gate(
          features: const [CatalogKeys.inventory],
          child: ListTile(
            key: const Key('more.stock'),
            leading: const Icon(Icons.warehouse_outlined),
            title: Text(l.stockTitle),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const StockScreen())),
          ),
        ),
        // Customers, the credit book and expenses sit here too, for the same reason: looked at a few times a day
        // (collect dues, note a cost), never all day like the counter. Each is gated exactly as the server gates its
        // routes (BooksAccess).
        if (access.customers)
          ListTile(
            key: const Key('more.customers'),
            leading: const Icon(Icons.people_outline),
            title: Text(l.customersTitle),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CustomersScreen())),
          ),
        if (access.creditBook)
          ListTile(
            key: const Key('more.creditBook'),
            leading: const Icon(Icons.menu_book_outlined),
            title: Text(l.creditBookTitle),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreditBookScreen())),
          ),
        if (access.expenses)
          ListTile(
            key: const Key('more.expenses'),
            leading: const Icon(Icons.receipt_long_outlined),
            title: Text(l.expensesTitle),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ExpensesScreen())),
          ),
        _Header(l.language),
        RadioGroup<String>(
          groupValue: c.locale.languageCode,
          onChanged: (v) => v == null ? null : c.setLanguage(v),
          child: Column(
            children: [
              RadioListTile<String>(value: 'en', title: Text(l.languageEnglish)),
              RadioListTile<String>(value: 'ta', title: Text(l.languageTamil)),
            ],
          ),
        ),
        const Divider(),
        if (user != null)
          ListTile(
            leading: const Icon(Icons.person_outline),
            title: Text(l.signedInAs(user.name ?? prettyPhone(user.phone ?? user.email ?? ''))),
          ),
        ListTile(
          key: const Key('more.signOut'),
          leading: Icon(Icons.logout, color: theme.colorScheme.error),
          title: Text(l.signOut, style: TextStyle(color: theme.colorScheme.error)),
          onTap: () => _confirmSignOut(context),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(l.appVersion(appVersion), style: theme.textTheme.bodySmall),
        ),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(text, style: Theme.of(context).textTheme.labelLarge?.copyWith(color: Theme.of(context).colorScheme.primary)),
      );
}
