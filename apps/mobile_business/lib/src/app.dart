import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:srikit_kit/srikit_kit.dart';
import 'package:srikit_theme/srikit_theme.dart';

import '../l10n/app_localizations.dart';
import 'app_controller.dart';
import 'pos/terminal_shell.dart';
import 'screens/home_shell.dart';
import 'screens/shop_picker.dart';
import 'screens/sign_in.dart';
import 'screens/splash.dart';
import 'screens/update_required.dart';

/// Root widget. Navigation follows [AppController.stage] (no router yet: the flow is linear, see README).
class SrikitBusinessApp extends StatelessWidget {
  const SrikitBusinessApp({super.key, required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      controller: controller,
      child: ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final tokens = controller.stage == AppStage.terminal && controller.terminal != null ? controller.terminal!.tokens : controller.tokens;
          return MaterialApp(
            onGenerateTitle: (c) => AppLocalizations.of(c).appTitle,
            debugShowCheckedModeBanner: false,
            theme: SrikitTheme.light(tokens),
            darkTheme: SrikitTheme.dark(tokens),
            themeMode: SrikitTheme.themeMode(tokens),
            locale: controller.locale,
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            // Above the Navigator, so pushed screens (product, order, stock) see the shop's gates too.
            builder: (context, child) => GateScope(gates: controller.gates, child: child ?? const SizedBox.shrink()),
            home: _screenFor(controller),
          );
        },
      ),
    );
  }

  Widget _screenFor(AppController c) => switch (c.stage) {
        AppStage.starting || AppStage.restoreFailed || AppStage.openingShop => const SplashScreen(),
        AppStage.updateRequired => const UpdateRequiredScreen(),
        AppStage.signedOut => const SignInScreen(),
        AppStage.pickingShop => const ShopPickerScreen(),
        AppStage.ready => HomeShell(key: ValueKey(c.shop?.tenant.id)),
        AppStage.terminal => TerminalShell(terminal: c.terminal!),
      };
}
