import 'package:flutter/material.dart';

import 'brand_tokens.dart';
import 'srikit_defaults.dart';

/// Builds Material 3 themes from [BrandTokens].
abstract final class SrikitTheme {
  /// The light theme. Uses the platform defaults when [tokens] is null.
  static ThemeData light([BrandTokens? tokens]) => build(tokens ?? srikitDefaultTokens, Brightness.light);

  /// The dark theme. Uses the platform defaults when [tokens] is null.
  static ThemeData dark([BrandTokens? tokens]) => build(tokens ?? srikitDefaultTokens, Brightness.dark);

  /// `mode` → [ThemeMode]. A custom dark page background implies dark even when `mode` says light.
  static ThemeMode themeMode(BrandTokens tokens) {
    final bg = parseHex(tokens.colors.background);
    if (tokens.mode == BrandMode.light && bg != null && _isDark(bg)) return ThemeMode.dark;
    return switch (tokens.mode) {
      BrandMode.light => ThemeMode.light,
      BrandMode.dark => ThemeMode.dark,
      BrandMode.system => ThemeMode.system,
    };
  }

  /// The colour scheme for [brightness]: seeded from `primary`, then the brand's exact colours with readable
  /// on-colours. `background` / `foreground` are used only by the scheme whose brightness they match.
  static ColorScheme colorScheme(BrandTokens tokens, Brightness brightness) {
    final primary = parseHex(tokens.colors.primary) ?? parseHex(srikitDefaultTokens.colors.primary)!;
    var scheme = ColorScheme.fromSeed(seedColor: primary, brightness: brightness);
    // Dark schemes keep the seeded (lighter) primary unless the brand colour itself reads on a dark surface.
    final usePrimary = brightness == Brightness.light || contrastRatio(primary, scheme.surface) >= 3;
    if (usePrimary) scheme = scheme.copyWith(primary: primary, onPrimary: readableOn(primary));

    final secondary = parseHex(tokens.colors.secondary);
    if (secondary != null) scheme = scheme.copyWith(secondary: secondary, onSecondary: readableOn(secondary));
    final accent = parseHex(tokens.colors.accent);
    if (accent != null) scheme = scheme.copyWith(tertiary: accent, onTertiary: readableOn(accent));

    final bg = parseHex(tokens.colors.background);
    if (bg != null && (_isDark(bg) == (brightness == Brightness.dark))) {
      final fg = parseHex(tokens.colors.foreground) ?? readableOn(bg);
      scheme = scheme.copyWith(surface: bg, onSurface: fg);
    }
    return scheme;
  }

  static ThemeData build(BrandTokens tokens, Brightness brightness) {
    final scheme = colorScheme(tokens, brightness);
    final radius = BorderRadius.circular(tokens.radiusPx);
    final shape = RoundedRectangleBorder(borderRadius: radius);
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: tokens.fontSans,
      scaffoldBackgroundColor: scheme.surface,
    );
    final heading = tokens.fontHeading;
    final text = heading == null
        ? base.textTheme
        : base.textTheme.copyWith(
            displayLarge: base.textTheme.displayLarge?.copyWith(fontFamily: heading),
            displayMedium: base.textTheme.displayMedium?.copyWith(fontFamily: heading),
            displaySmall: base.textTheme.displaySmall?.copyWith(fontFamily: heading),
            headlineLarge: base.textTheme.headlineLarge?.copyWith(fontFamily: heading),
            headlineMedium: base.textTheme.headlineMedium?.copyWith(fontFamily: heading),
            headlineSmall: base.textTheme.headlineSmall?.copyWith(fontFamily: heading),
            titleLarge: base.textTheme.titleLarge?.copyWith(fontFamily: heading),
          );
    return base.copyWith(
      textTheme: text,
      cardTheme: CardThemeData(shape: shape, margin: EdgeInsets.zero),
      filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(shape: shape, minimumSize: const Size(64, 48))),
      outlinedButtonTheme:
          OutlinedButtonThemeData(style: OutlinedButton.styleFrom(shape: shape, minimumSize: const Size(64, 48))),
      textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(shape: shape)),
      inputDecorationTheme: InputDecorationTheme(border: OutlineInputBorder(borderRadius: radius)),
      dialogTheme: DialogThemeData(shape: shape),
      bottomSheetTheme: BottomSheetThemeData(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(tokens.radiusPx))),
      ),
      snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, shape: shape),
    );
  }

  static bool _isDark(Color c) => c.computeLuminance() < 0.2;
}
