import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:srikit_theme/srikit_theme.dart';

void main() {
  test('defaults come from DEFAULT_BRAND_TOKENS', () {
    expect(srikitDefaultTokens.colors.primary, '#2563eb');
    expect(srikitDefaultTokens.radius, 0.625);
    expect(srikitDefaultTokens.fontSans, 'Inter');
    expect(srikitDefaultTokens.mode, BrandMode.light);
  });

  test('fromJson reads the /v1/branding tokens and ignores bad values', () {
    final t = BrandTokens.fromJson({
      'colors': {'primary': '#B91C1C', 'accent': '#facc15', 'secondary': 'red'},
      'radius': 1,
      'fontSans': 'Mukta Malar',
      'fontHeading': 'Poppins',
      'mode': 'dark',
      'theme': {'header': 'centered'},
    });
    expect(t.colors.primary, '#b91c1c');
    expect(t.colors.accent, '#facc15');
    expect(t.colors.secondary, isNull);
    expect(t.radiusPx, 16);
    expect(t.fontSans, 'Mukta Malar');
    expect(t.fontHeading, 'Poppins');
    expect(t.mode, BrandMode.dark);

    final bad = BrandTokens.fromJson({'colors': {'primary': 'nope'}, 'radius': 9, 'mode': 'neon'});
    expect(bad.colors.primary, '#2563eb');
    expect(bad.radius, 0.625);
    expect(bad.mode, BrandMode.light);
  });

  test('light theme uses the exact brand primary with a readable on-colour', () {
    final t = BrandTokens.fromJson({
      'colors': {'primary': '#facc15', 'secondary': '#1e3a8a'},
      'radius': 0.5,
    });
    final theme = SrikitTheme.light(t);
    expect(theme.useMaterial3, isTrue);
    expect(theme.colorScheme.brightness, Brightness.light);
    expect(theme.colorScheme.primary, const Color(0xFFFACC15));
    expect(theme.colorScheme.onPrimary, nearBlack); // yellow → dark text
    expect(theme.colorScheme.secondary, const Color(0xFF1E3A8A));
    expect(theme.colorScheme.onSecondary, white); // navy → white text
    final shape = theme.cardTheme.shape as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(8));
  });

  test('fonts and backgrounds follow the tokens', () {
    final t = BrandTokens.fromJson({
      'colors': {'primary': '#2563eb', 'background': '#111827', 'foreground': '#f9fafb'},
      'fontSans': 'Noto Sans Tamil',
      'fontHeading': 'Poppins',
    });
    expect(SrikitTheme.themeMode(t), ThemeMode.dark); // a dark page background implies dark
    final dark = SrikitTheme.dark(t);
    expect(dark.colorScheme.surface, const Color(0xFF111827));
    expect(dark.colorScheme.onSurface, const Color(0xFFF9FAFB));
    // The light scheme ignores a dark background.
    expect(SrikitTheme.light(t).colorScheme.surface, isNot(const Color(0xFF111827)));
    expect(dark.textTheme.bodyMedium?.fontFamily, 'Noto Sans Tamil');
    expect(dark.textTheme.titleLarge?.fontFamily, 'Poppins');
  });

  test('readableOn matches the web contrast rule', () {
    expect(readableOn(const Color(0xFFFFFFFF)), nearBlack);
    expect(readableOn(const Color(0xFF000000)), white);
    expect(readableOn(const Color(0xFF2563EB)), white);
  });

  test('mode maps to ThemeMode', () {
    expect(SrikitTheme.themeMode(srikitDefaultTokens), ThemeMode.light);
    expect(SrikitTheme.themeMode(BrandTokens.fromJson({'colors': {'primary': '#000000'}, 'mode': 'system'})), ThemeMode.system);
  });
}
