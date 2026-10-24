import 'package:flutter/painting.dart';

/// `mode` of the brand tokens.
enum BrandMode { light, dark, system }

/// Brand colours as `#rrggbb` strings (packages/branding/src/tokens.ts `brandTokensSchema.colors`).
class BrandColors {
  const BrandColors({required this.primary, this.secondary, this.accent, this.background, this.foreground});

  final String primary;
  final String? secondary;
  final String? accent;
  final String? background;
  final String? foreground;

  Map<String, String> toJson() => {
        'primary': primary,
        if (secondary != null) 'secondary': secondary!,
        if (accent != null) 'accent': accent!,
        if (background != null) 'background': background!,
        if (foreground != null) 'foreground': foreground!,
      };
}

/// The mobile-relevant part of `BrandTokens` (the storefront `theme` block is web-only and ignored).
class BrandTokens {
  const BrandTokens({
    required this.colors,
    this.radius = defaultRadius,
    this.fontSans = defaultFont,
    this.fontHeading,
    this.mode = BrandMode.light,
  });

  static const defaultRadius = 0.625;
  static const defaultFont = 'Inter';

  final BrandColors colors;

  /// Corner radius in rem (0–1.5). 1rem = 16 logical px.
  final double radius;
  final String fontSans;
  final String? fontHeading;
  final BrandMode mode;

  /// [radius] in logical pixels.
  double get radiusPx => radius * 16;

  /// Parses the `tokens` JSON. Invalid or missing values fall back to [fallback] (or the schema defaults), so a bad
  /// value from the server never breaks the app.
  static BrandTokens fromJson(Map<String, dynamic>? json, {BrandTokens? fallback}) {
    final j = json ?? const <String, dynamic>{};
    final c = j['colors'] is Map ? (j['colors'] as Map).cast<String, dynamic>() : const <String, dynamic>{};
    String? hex(String key) {
      final v = c[key];
      return v is String && parseHex(v) != null ? v.toLowerCase() : null;
    }

    final radius = j['radius'];
    final mode = BrandMode.values.where((m) => m.name == j['mode']).firstOrNull;
    return BrandTokens(
      colors: BrandColors(
        primary: hex('primary') ?? fallback?.colors.primary ?? '#2563eb',
        secondary: hex('secondary'),
        accent: hex('accent'),
        background: hex('background'),
        foreground: hex('foreground'),
      ),
      radius: radius is num && radius >= 0 && radius <= 1.5 ? radius.toDouble() : (fallback?.radius ?? defaultRadius),
      fontSans: j['fontSans'] is String && (j['fontSans'] as String).trim().isNotEmpty
          ? (j['fontSans'] as String).trim()
          : (fallback?.fontSans ?? defaultFont),
      fontHeading: j['fontHeading'] is String ? (j['fontHeading'] as String).trim() : null,
      mode: mode ?? fallback?.mode ?? BrandMode.light,
    );
  }

  Map<String, dynamic> toJson() => {
        'colors': colors.toJson(),
        'radius': radius,
        'fontSans': fontSans,
        if (fontHeading != null) 'fontHeading': fontHeading,
        'mode': mode.name,
      };
}

/// `#rrggbb` → opaque [Color]; null when malformed.
Color? parseHex(String? hex) {
  if (hex == null) return null;
  final m = RegExp(r'^#([0-9a-fA-F]{6})$').firstMatch(hex.trim());
  return m == null ? null : Color(0xFF000000 | int.parse(m.group(1)!, radix: 16));
}

/// The web's near-black (packages/branding/src/color.ts `NEAR_BLACK`).
const nearBlack = Color(0xFF0A0A0A);
const white = Color(0xFFFFFFFF);

/// WCAG contrast ratio of two opaque colours.
double contrastRatio(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final hi = la > lb ? la : lb;
  final lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

/// Near-black or white, whichever reads better on [background] (same rule as the web's `readableForeground`).
Color readableOn(Color background) =>
    contrastRatio(background, nearBlack) >= contrastRatio(background, white) ? nearBlack : white;
