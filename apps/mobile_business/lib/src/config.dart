import 'package:flutter/foundation.dart';

/// API origin (without /v1). `--dart-define=SRIKIT_API=https://api.example.com`. The default is the host machine as
/// seen from the Android emulator; use `http://localhost:4000` on the iOS simulator and the PC's LAN IP on a phone.
const apiBaseUrl = String.fromEnvironment('SRIKIT_API', defaultValue: 'http://10.0.2.2:4000');

/// Sent in `x-client`. Keep in step with `version:` in pubspec.yaml.
const appVersion = '0.1.0';

/// `android` / `ios` for the `x-client` header and push tokens; null elsewhere (tests, desktop).
String? get clientPlatform => kIsWeb
    ? null
    : switch (defaultTargetPlatform) {
        TargetPlatform.android => 'android',
        TargetPlatform.iOS => 'ios',
        _ => null,
      };

/// Languages the app ships.
const supportedLanguageCodes = ['en', 'ta'];

/// Store page for the update screens. `--dart-define=SRIKIT_STORE_URL=...` overrides it; on iOS there is no default
/// until the App Store id exists (the update screen then hides its button).
String? get storeUrl {
  const override = String.fromEnvironment('SRIKIT_STORE_URL');
  if (override.isNotEmpty) return override;
  return switch (clientPlatform) {
    'android' => 'https://play.google.com/store/apps/details?id=in.srikit.business',
    _ => null,
  };
}

/// The app name in GET /v1/mobile/config `apps` and in `x-client`.
const clientApp = 'business';
