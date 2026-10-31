import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_api/srikit_api.dart';
import 'package:srikit_business/src/app.dart';
import 'package:srikit_business/src/app_controller.dart';
import 'package:srikit_business/src/screens/home_shell.dart';
import 'package:srikit_business/src/screens/update_required.dart';
import 'package:srikit_kit/srikit_kit.dart';

import 'fake_api.dart';

Future<AppController> launch(WidgetTester tester, FakeSrikitServer server, {Map<String, String>? stored}) async {
  final controller = AppController(api: SrikitApi(server.apiClient()), session: SessionStore(MemoryKeyValueStore(stored)));
  await tester.pumpWidget(SrikitBusinessApp(controller: controller));
  await controller.start();
  await tester.pumpAndSettle();
  return controller;
}

void main() {
  testWidgets('mobile config updateRequired blocks before the session is restored', (tester) async {
    final server = FakeSrikitServer(updateRequired: true)..issuedToken = 'session-token';
    final c = await launch(tester, server, stored: {SessionStore.tokenKey: 'session-token'});

    expect(c.stage, AppStage.updateRequired);
    expect(find.text('Update the app'), findsOneWidget);
    expect(find.text('Your version 0.1.0 · needed 0.2.0 or newer'), findsOneWidget);
    expect(find.byKey(UpdateRequiredScreen.checkAgainButton), findsOneWidget);
    // The config call went first and nothing else was asked.
    expect(server.requests.map((r) => r.url.path), ['/v1/mobile/config']);
    expect(server.requests.single.headers['x-client'], 'srikit-business/0.1.0');

    // After updating (the server now accepts this version), "check again" carries on.
    server.updateRequired = false;
    await tester.tap(find.byKey(UpdateRequiredScreen.checkAgainButton));
    await tester.pumpAndSettle();
    expect(c.stage, AppStage.ready);
  });

  testWidgets('the update screen is in Tamil too', (tester) async {
    final server = FakeSrikitServer(updateRequired: true);
    final c = await launch(tester, server, stored: {SessionStore.localeKey: 'ta'});
    expect(c.stage, AppStage.updateRequired);
    expect(find.text('செயலியைப் புதுப்பிக்கவும்'), findsOneWidget);
  });

  testWidgets('a 426 from any request switches to the update screen', (tester) async {
    final server = FakeSrikitServer()..issuedToken = 'session-token';
    final c = await launch(tester, server, stored: {SessionStore.tokenKey: 'session-token'});
    expect(c.stage, AppStage.ready);

    // The minimum moves up while the app is open: the next call (pull to refresh on Home) gets 426.
    server.guard426 = true;
    await tester.fling(find.text('Hello, Anna'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();

    expect(c.stage, AppStage.updateRequired);
    expect(c.requiredVersion, '0.4.0');
    expect(find.text('Update the app'), findsOneWidget);
    expect(find.byType(HomeShell), findsNothing);
  });

  testWidgets('426 while signing in also lands on the update screen and stays there', (tester) async {
    final server = FakeSrikitServer()..guard426 = true;
    final c = await launch(tester, server);
    // /auth/config failed with 426 in the background right after the sign-in screen showed.
    expect(c.stage, AppStage.updateRequired);
    expect(find.text('Update the app'), findsOneWidget);
  });

  testWidgets('updateAvailable shows a dismissible banner on Home', (tester) async {
    final server = FakeSrikitServer(updateAvailable: true)..issuedToken = 'session-token';
    final c = await launch(tester, server, stored: {SessionStore.tokenKey: 'session-token'});
    expect(c.stage, AppStage.ready);
    expect(find.text('A new version of RBMS Business is available.'), findsOneWidget);

    await tester.tap(find.byKey(UpdateAvailableBanner.laterButton));
    await tester.pumpAndSettle();
    expect(find.text('A new version of RBMS Business is available.'), findsNothing);
    expect(c.stage, AppStage.ready);
  });

  testWidgets('no banner when the app is current', (tester) async {
    final server = FakeSrikitServer()..issuedToken = 'session-token';
    await launch(tester, server, stored: {SessionStore.tokenKey: 'session-token'});
    expect(find.byType(UpdateAvailableBanner, skipOffstage: false), findsOneWidget); // present, but renders nothing
    expect(find.text('A new version of RBMS Business is available.'), findsNothing);
  });
}
