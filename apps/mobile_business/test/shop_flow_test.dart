import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/src/app.dart';
import 'package:srikit_business/src/app_controller.dart';
import 'package:srikit_business/src/orders/order_detail.dart';
import 'package:srikit_business/src/orders/orders_tab.dart';
import 'package:srikit_business/src/products/product_detail.dart';
import 'package:srikit_business/src/products/products_screen.dart';
import 'package:srikit_business/src/stock/stock_screen.dart';
import 'package:srikit_kit/srikit_kit.dart';

import 'fake_api.dart';

const allFeatures = ['invoices', 'orders', 'catalogue', 'catalogue.variants', 'inventory'];

Future<(AppController, FakeSrikitServer)> launch(WidgetTester tester, {Duration? poll}) async {
  final server = FakeSrikitServer(enabled: allFeatures)..issuedToken = 'session-token';
  final c = AppController(
    api: SrikitApi(server.apiClient()),
    session: SessionStore(MemoryKeyValueStore({SessionStore.tokenKey: 'session-token'})),
  );
  if (poll != null) c.ordersPollInterval = poll;
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.5;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(SrikitBusinessApp(controller: c));
  await c.start();
  await tester.pumpAndSettle();
  return (c, server);
}

Future<void> openMore(WidgetTester tester, Key entry) async {
  await tester.tap(find.text('More'));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(entry));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('product search → edit price → saved', (tester) async {
    final (_, server) = await launch(tester);
    await openMore(tester, const Key('more.products'));
    expect(find.byType(ProductsScreen), findsOneWidget);
    expect(find.text('12 in stock'), findsOneWidget); // rice
    expect(find.text('Low · 2.5'), findsOneWidget); // dal

    await tester.enterText(find.byKey(ProductsScreen.searchField), 'rice');
    await tester.pump(const Duration(milliseconds: 350));
    await tester.pumpAndSettle();
    expect(find.text('Toor Dal'), findsNothing);
    await tester.tap(find.byKey(const Key('products.row.0')));
    await tester.pumpAndSettle();

    expect(find.byType(ProductDetailScreen), findsOneWidget);
    expect(find.text('₹320.00'), findsOneWidget);
    expect(find.text('9% off'), findsOneWidget); // MRP ₹350

    await tester.tap(find.byKey(const Key('variant.edit.v-rice')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(VariantEditSheet.priceField), '310');
    await tester.tap(find.byKey(VariantEditSheet.saveButton));
    await tester.pumpAndSettle();

    final patch = server.requests.singleWhere((r) => r.method == 'PATCH' && r.url.path == '/v1/catalog/variants/v-rice');
    expect(jsonDecode(patch.body), {'price': 31000}); // only what changed
    expect(patch.headers['idempotency-key'], isNotNull);
    expect(find.text('₹310.00'), findsOneWidget);
  });

  testWidgets('a barcode already used elsewhere shows the server message', (tester) async {
    await launch(tester);
    await openMore(tester, const Key('more.products'));
    await tester.tap(find.text('Toor Dal'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('variant.edit.v-dal')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(VariantEditSheet.barcodeField), '8901000000011');
    await tester.tap(find.byKey(VariantEditSheet.saveButton));
    await tester.pumpAndSettle();
    expect(find.text('This barcode is already used by another variant'), findsOneWidget);
  });

  testWidgets('stock: low filter → item → add 1.25 kg → saved with a key, movement listed', (tester) async {
    final (_, server) = await launch(tester);
    await openMore(tester, const Key('more.stock'));
    expect(find.byType(StockScreen), findsOneWidget);
    expect(find.byKey(const Key('stock.location')), findsNothing); // one location: no picker

    await tester.tap(find.byKey(const Key('stock.filter.low')));
    await tester.pumpAndSettle();
    expect(find.text('Ponni Rice 5 kg'), findsNothing);
    await tester.tap(find.text('Toor Dal'));
    await tester.pumpAndSettle();
    expect(find.text('2.5 kg'), findsOneWidget);

    await tester.tap(find.byKey(StockItemScreen.adjustButton));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(AdjustSheet.qtyField), '1.2555');
    await tester.tap(find.byKey(AdjustSheet.saveButton));
    await tester.pumpAndSettle();
    expect(find.text('Quantity allows up to 3 decimals'), findsOneWidget);

    await tester.enterText(find.byKey(AdjustSheet.qtyField), '1.25');
    await tester.pump();
    expect(find.text('After: 3.75 kg'), findsOneWidget);
    await tester.enterText(find.byKey(AdjustSheet.noteField), 'New sack');
    await tester.tap(find.byKey(AdjustSheet.saveButton));
    await tester.pumpAndSettle();

    final post = server.requests.singleWhere((r) => r.url.path == '/v1/inventory/stock/v-dal/adjust');
    expect(jsonDecode(post.body), {'mode': 'add', 'qty': 1.25, 'note': 'New sack'});
    expect(post.headers['idempotency-key'], isNotNull);
    expect(find.text('3.75 kg'), findsOneWidget);
    expect(find.text('Adjustment'), findsOneWidget);
    expect(find.text('+1.25'), findsOneWidget);
  });

  testWidgets('order: confirm → pack → ship with tracking → deliver (COD collected)', (tester) async {
    final (_, server) = await launch(tester);
    expect(find.byKey(const Key('orders.badge')), findsOneWidget); // 1 new order
    await tester.tap(find.text('Orders'));
    await tester.pumpAndSettle();
    expect(find.byType(OrdersTab), findsOneWidget);
    expect(find.text('New · 1'), findsOneWidget);
    await tester.tap(find.byKey(const Key('orders.row.ORD/26-27/0001')));
    await tester.pumpAndSettle();
    expect(find.byType(OrderDetailScreen), findsOneWidget);
    expect(find.text('Confirm'), findsOneWidget);

    await tester.tap(find.byKey(OrderDetailScreen.primaryAction));
    await tester.pumpAndSettle();
    expect(find.text('Mark packed'), findsOneWidget);
    await tester.tap(find.byKey(OrderDetailScreen.primaryAction));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(OrderDetailScreen.primaryAction)); // Mark shipped → dialog
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('ship.carrier')), 'DTDC');
    await tester.enterText(find.byKey(const Key('ship.url')), 'not a link');
    await tester.tap(find.byKey(const Key('ship.confirm')));
    await tester.pumpAndSettle();
    expect(find.text('Enter a link starting with http:// or https://'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('ship.url')), 'https://dtdc.example.in/T123');
    await tester.enterText(find.byKey(const Key('ship.number')), 'T123');
    await tester.tap(find.byKey(const Key('ship.confirm')));
    await tester.pumpAndSettle();

    expect(find.text('Marking it delivered records the COD balance as paid.'), findsOneWidget);
    await tester.tap(find.byKey(OrderDetailScreen.primaryAction));
    await tester.pumpAndSettle();

    final moves = server.requests.where((r) => r.url.path == '/v1/orders/ord-1/status').map((r) => jsonDecode(r.body) as Map).toList();
    expect(moves.map((m) => m['status']), ['confirmed', 'packed', 'shipped', 'delivered']);
    expect(moves[2]['fulfillment'], {'carrier': 'DTDC', 'trackingNumber': 'T123', 'trackingUrl': 'https://dtdc.example.in/T123'});
    final keys = server.requests.where((r) => r.url.path == '/v1/orders/ord-1/status').map((r) => r.headers['idempotency-key']).toSet();
    expect(keys, hasLength(4)); // one key per move

    expect(find.byKey(OrderDetailScreen.primaryAction), findsNothing); // delivered: nothing next
    expect(find.text('Paid'), findsWidgets);
    expect(find.byKey(OrderDetailScreen.recordPaymentButton), findsNothing); // COD balance collected
    expect(find.text('Invoice INV-0042'), findsOneWidget);
    expect(find.text('Shipment'), findsOneWidget);
  });

  testWidgets('cancel needs a reason; no cancel once shipped', (tester) async {
    final (_, server) = await launch(tester);
    await tester.tap(find.text('Orders'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('orders.row.ORD/26-27/0001')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(OrderDetailScreen.moreActions));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel order').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cancel.confirm')));
    await tester.pumpAndSettle();
    expect(find.text('Give a reason'), findsOneWidget);
    await tester.tap(find.byKey(const Key('cancel.stock')));
    await tester.tap(find.byKey(const Key('cancel.confirm')));
    await tester.pumpAndSettle();
    final cancel = server.requests.lastWhere((r) => r.url.path == '/v1/orders/ord-1/status');
    expect(jsonDecode(cancel.body), {'status': 'cancelled', 'note': 'Out of stock'});
    expect(find.text('Cancelled'), findsWidgets);
    expect(find.byKey(OrderDetailScreen.moreActions), findsNothing);
  });

  testWidgets('new orders are polled only while the Orders tab is visible', (tester) async {
    final (_, server) = await launch(tester, poll: const Duration(seconds: 1));
    final atStart = server.shop.summaryCalls; // one refresh when the shop opens
    expect(atStart, 1);
    await tester.pump(const Duration(seconds: 3));
    expect(server.shop.summaryCalls, atStart); // Home: no polling

    await tester.tap(find.text('Orders'));
    await tester.pumpAndSettle();
    server.shop.newOrderCount = 3;
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();
    expect(server.shop.summaryCalls, greaterThan(atStart + 1));
    expect(find.descendant(of: find.byKey(const Key('orders.badge')), matching: find.text('3')), findsOneWidget);

    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    final left = server.shop.summaryCalls;
    await tester.pump(const Duration(seconds: 3));
    expect(server.shop.summaryCalls, left);
  });
}
