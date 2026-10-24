import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/src/app.dart';
import 'package:srikit_business/src/app_controller.dart';
import 'package:srikit_business/src/screens/sign_in.dart';
import 'package:srikit_kit/srikit_kit.dart';

import 'fake_api.dart';

Future<(AppController, MemoryKeyValueStore)> launch(WidgetTester tester, FakeSrikitServer server,
    {Map<String, String>? stored}) async {
  final store = MemoryKeyValueStore(stored);
  final controller = AppController(api: SrikitApi(server.apiClient()), session: SessionStore(store));
  await tester.pumpWidget(SrikitBusinessApp(controller: controller));
  await controller.start();
  await tester.pumpAndSettle();
  return (controller, store);
}

void main() {
  testWidgets('phone → wrong code shows the API message → right code → home with the shop theme and summary',
      (tester) async {
    final server = FakeSrikitServer();
    final (controller, store) = await launch(tester, server);

    expect(find.text('Sign in'), findsOneWidget);

    // An invalid number is caught on the phone.
    await tester.enterText(find.byKey(SignInScreen.phoneField), '12345');
    await tester.tap(find.byKey(SignInScreen.sendButton));
    await tester.pumpAndSettle();
    expect(find.text('Enter a valid 10-digit mobile number'), findsOneWidget);

    await tester.enterText(find.byKey(SignInScreen.phoneField), '99990 00001');
    await tester.tap(find.byKey(SignInScreen.sendButton));
    await tester.pumpAndSettle();
    final sent = server.requests.lastWhere((r) => r.url.path == '/v1/auth/otp/request');
    expect(sent.body, contains('"target":"+919999000001"'));
    expect(sent.body, contains('"channel":"sms"'));
    expect(find.text('Enter the code sent to +91 99990 00001'), findsOneWidget);
    expect(find.text('This is a test number: use the test code.'), findsOneWidget);

    await tester.enterText(find.byKey(SignInScreen.codeField), '000000');
    await tester.tap(find.byKey(SignInScreen.verifyButton));
    await tester.pumpAndSettle();
    expect(find.text('That code is not right. Check the SMS and try again.'), findsOneWidget);

    await tester.enterText(find.byKey(SignInScreen.codeField), '123456');
    await tester.tap(find.byKey(SignInScreen.verifyButton));
    await tester.pumpAndSettle();

    // One shop: the picker is skipped.
    expect(controller.stage, AppStage.ready);
    expect(store.values[SessionStore.tokenKey], 'session-token');
    expect(store.values[SessionStore.shopKey], 'anna-stores');
    expect(find.text('Anna Stores'), findsOneWidget); // app bar
    expect(find.text('Hello, Anna'), findsOneWidget);
    expect(find.text('₹1,23,457'), findsOneWidget); // billed this month, whole rupees
    expect(find.text('2 overdue bills'), findsOneWidget);

    // Tabs follow the shop's features.
    expect(find.text('Bill'), findsOneWidget);
    expect(find.text('Orders'), findsOneWidget);

    // The shop's brand colour is applied.
    final theme = Theme.of(tester.element(find.text('Hello, Anna')));
    expect(theme.colorScheme.primary, const Color(0xFFB91C1C));

    // Shop requests carry x-tenant.
    final summary = server.requests.lastWhere((r) => r.url.path == '/v1/invoices/summary');
    expect(summary.headers['x-tenant'], 'anna-stores');
    expect(summary.headers['authorization'], 'Bearer session-token');
  });

  testWidgets('email sign-in: invalid address caught, code sent by email, signed in; back to phone', (tester) async {
    final server = FakeSrikitServer();
    final (controller, _) = await launch(tester, server);

    await tester.tap(find.byKey(SignInScreen.useEmailButton));
    await tester.pumpAndSettle();
    expect(find.byKey(SignInScreen.phoneField), findsNothing);

    await tester.enterText(find.byKey(SignInScreen.emailField), 'not-an-email');
    await tester.tap(find.byKey(SignInScreen.sendButton));
    await tester.pumpAndSettle();
    expect(find.text('Enter a valid email'), findsOneWidget);

    await tester.enterText(find.byKey(SignInScreen.emailField), ' Owner@Example.IN ');
    await tester.tap(find.byKey(SignInScreen.sendButton));
    await tester.pumpAndSettle();
    final sent = server.requests.lastWhere((r) => r.url.path == '/v1/auth/otp/request');
    expect(sent.body, contains('"target":"owner@example.in"'));
    expect(sent.body, contains('"channel":"email"'));
    expect(find.text('Enter the code sent to owner@example.in'), findsOneWidget);

    await tester.enterText(find.byKey(SignInScreen.codeField), '123456');
    await tester.tap(find.byKey(SignInScreen.verifyButton));
    await tester.pumpAndSettle();
    expect(controller.stage, AppStage.ready);
    final verify = server.requests.lastWhere((r) => r.url.path == '/v1/auth/otp/verify');
    expect(verify.body, contains('"target":"owner@example.in"'));
  });

  testWidgets('tabs hide when the shop lacks the feature; language switch and sign out', (tester) async {
    final server = FakeSrikitServer(enabled: const ['invoices'])..issuedToken = 'session-token';
    final (controller, store) =
        await launch(tester, server, stored: {SessionStore.tokenKey: 'session-token'});

    expect(controller.stage, AppStage.ready);
    expect(find.text('Bill'), findsOneWidget);
    expect(find.text('Orders'), findsNothing);

    await tester.tap(find.text('More'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('தமிழ்'));
    await tester.pumpAndSettle();
    expect(find.text('மேலும்'), findsOneWidget); // "More" in Tamil
    expect(store.values[SessionStore.localeKey], 'ta');
    expect(server.requests.last.headers['accept-language'], anyOf('ta', 'en'));

    await tester.tap(find.byKey(const Key('more.signOut')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'வெளியேறு'));
    await tester.pumpAndSettle();
    expect(controller.stage, AppStage.signedOut);
    expect(find.text('உள்நுழைக'), findsWidgets);
    expect(store.values.containsKey(SessionStore.tokenKey), isFalse);
    expect(server.requests.any((r) => r.url.path == '/v1/auth/logout'), isTrue);
  });

  testWidgets('several shops show the picker', (tester) async {
    final server = FakeSrikitServer(shops: [
      {
        'tenant': {'id': 't1', 'slug': 'anna-stores', 'name': 'Anna Stores', 'appId': 'shop', 'status': 'active'},
        'roles': ['owner'],
      },
      {
        'tenant': {'id': 't2', 'slug': 'ravi-mobiles', 'name': 'Ravi Mobiles', 'appId': 'shop', 'status': 'active'},
        'roles': ['staff'],
      },
    ])
      ..issuedToken = 'session-token';
    final (controller, _) = await launch(tester, server, stored: {SessionStore.tokenKey: 'session-token'});
    expect(controller.stage, AppStage.pickingShop);
    expect(find.text('Choose a shop'), findsOneWidget);
    await tester.tap(find.text('Ravi Mobiles'));
    await tester.pumpAndSettle();
    expect(controller.shop?.tenant.slug, 'ravi-mobiles');
  });
}
