import 'package:flutter/material.dart';
import 'package:srikit_kit/srikit_kit.dart';

import '../../l10n/app_localizations.dart';
import '../app_controller.dart';
import '../counter/bill_tab.dart';
import '../orders/order_actions.dart';
import '../orders/orders_tab.dart';
import 'dashboard.dart';
import 'more.dart';

/// Feature keys behind the tabs (the same keys as the web; see packages/*/src/features.ts).
abstract final class TabFeatures {
  static const bill = 'invoices';

  /// Permission to make bills (the web counter's module gate).
  static const billPermission = 'invoices.create';
  static const orders = 'orders';
}

class _Tab {
  const _Tab(this.icon, this.selectedIcon, this.label, this.body, {this.feature, this.permission});
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final Widget body;
  final String? feature;
  final String? permission;
}

/// Bottom navigation: Home, Bill, Orders, More. Bill and Orders show only when the shop has the feature.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;
  OrdersWatcher? _watcher;
  bool? _polling;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final app = AppScope.read(context);
      if (app.gates.feature(TabFeatures.orders)) {
        _watcher = app.ordersWatcher();
        _watcher!.refresh(); // badge on start, before the tab is opened
        setState(() {});
      }
    });
  }

  @override
  void dispose() {
    _watcher?.stop();
    super.dispose();
  }

  /// Polls for new orders only while the Orders tab is visible (push replaces this later).
  void _syncPolling(bool ordersVisible) {
    final w = _watcher;
    if (w == null || _polling == ordersVisible) return;
    _polling = ordersVisible;
    WidgetsBinding.instance.addPostFrameCallback((_) => ordersVisible ? w.start() : w.stop());
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final c = AppScope.of(context);
    final gates = GateScope.of(context);
    final tabs = [
      _Tab(Icons.home_outlined, Icons.home, l.tabHome, const DashboardTab()),
      _Tab(Icons.receipt_long_outlined, Icons.receipt_long, l.tabBill, const BillTab(),
          feature: TabFeatures.bill, permission: TabFeatures.billPermission),
      _Tab(Icons.shopping_bag_outlined, Icons.shopping_bag, l.tabOrders, const OrdersTab(), feature: TabFeatures.orders),
      _Tab(Icons.more_horiz, Icons.more_horiz, l.tabMore, const MoreTab()),
    ]
        .where((t) => gates.allows(features: [if (t.feature != null) t.feature!], permissions: [if (t.permission != null) t.permission!]))
        .toList();
    final index = _index.clamp(0, tabs.length - 1);
    final tab = tabs[index];
    _syncPolling(tab.feature == TabFeatures.orders);
    return Scaffold(
      appBar: AppBar(title: Text(c.shop?.branding?.appName ?? c.shop?.tenant.name ?? l.appTitle)),
      body: Gate(
        features: [if (tab.feature != null) tab.feature!],
        permissions: [if (tab.permission != null) tab.permission!],
        child: tab.body,
      ),
      bottomNavigationBar: ListenableBuilder(
        listenable: _watcher ?? ValueNotifier(0),
        builder: (context, _) {
          final newOrders = _watcher?.newOrders ?? 0;
          Widget icon(_Tab t, IconData i) => t.feature == TabFeatures.orders && newOrders > 0
              ? Badge(key: const Key('orders.badge'), label: Text('$newOrders'), child: Icon(i))
              : Icon(i);
          return NavigationBar(
            selectedIndex: index,
            onDestinationSelected: (i) => setState(() => _index = i),
            destinations: [
              for (final t in tabs) NavigationDestination(icon: icon(t, t.icon), selectedIcon: icon(t, t.selectedIcon), label: t.label),
            ],
          );
        },
      ),
    );
  }
}
